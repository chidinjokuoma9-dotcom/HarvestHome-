import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Content-Type":"application/json"
};

const PRICES:Record<string,number>={featured:115000,featured_7:115000,featured_14:215000,featured_30:415000,lifetime_listing:815000,verification:500000,pro:1000000,verified_pro:25000000,partner_store_annual:1500000};

serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const auth=req.headers.get('Authorization')||'';
    const userClient=createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {global:{headers:{Authorization:auth}}}
    );
    const {data:{user}}=await userClient.auth.getUser();
    if(!user)return new Response(JSON.stringify({error:'Sign in required.'}),{status:401,headers:cors});

    const body=await req.json();
    const service=String(body.service||'');
    const amount=PRICES[service];
    if(!amount)throw new Error('Invalid HarvestHome service');

    const listingId=body.listing_id?String(body.listing_id):null;
    const partnerStoreId=body.partner_store_id?String(body.partner_store_id):null;
    let partnerStore:any=null;
    if(service==='partner_store_annual'){
      if(!partnerStoreId)throw new Error('Your Partner Store could not be identified.');
      const {data,error:storeError}=await userClient.from('partner_storefronts')
        .select('id,seller_id,business_name,is_published,agreement_confirmed,partner_submission_status,removed_at')
        .eq('id',partnerStoreId).eq('seller_id',user.id).maybeSingle();
      if(storeError)throw storeError;
      if(!data||!data.is_published||!data.agreement_confirmed||data.partner_submission_status!=='published'||data.removed_at)
        throw new Error('Only an active, approved Partner Store can purchase this subscription.');
      partnerStore=data;
      const {data:pending,error:pendingError}=await userClient.from('payments')
        .select('id,status,created_at').eq('partner_store_id',partnerStoreId).eq('service','partner_store_annual')
        .in('status',['initialized','pending','processing']).order('created_at',{ascending:false}).limit(5);
      if(pendingError)throw pendingError;
      if((pending||[]).some(p=>Date.now()-new Date(p.created_at).getTime()<30*60*1000))
        throw new Error('A Partner Store payment is already being processed. Please wait before trying again.');
    }
    let listing:any=null;
    if(service.startsWith('featured')||service==='lifetime_listing'){
      if(!listingId)throw new Error('Select the exact listing this Featured payment is for');
      const {data,error:listingError}=await userClient
        .from('listings')
        .select('id,title,seller_id,status,currency,publication_plan')
        .eq('id',listingId)
        .maybeSingle();
      if(listingError)throw listingError;
      if(!data)throw new Error('Listing not found');
      listing=data;
      if(listing.seller_id!==user.id)throw new Error('You can only pay for your own listing');
      if(listing.status==='deleted')throw new Error('This listing is no longer available');
      if(service==='lifetime_listing'&&listing.status!=='approved')throw new Error('Only an approved listing can be upgraded to Lifetime Listing');
      if(service==='lifetime_listing'&&String(listing.publication_plan||'').toLowerCase()==='lifetime')throw new Error('This listing already has Lifetime Listing status');
      if(service==='lifetime_listing'){
        const {data:existingPayments,error:existingPaymentError}=await userClient.from('payments')
          .select('id,status,created_at').eq('listing_id',listingId).eq('service','lifetime_listing')
          .in('status',['initialized','pending','processing','success']).order('created_at',{ascending:false}).limit(5);
        if(existingPaymentError)throw existingPaymentError;
        const recentOrSuccessful=(existingPayments||[]).find(p=>String(p.status).toLowerCase()==='success'||Date.now()-new Date(p.created_at).getTime()<30*60*1000);
        if(recentOrSuccessful)throw new Error(String(recentOrSuccessful.status).toLowerCase()==='success'?'A successful Lifetime Listing payment is already recorded for this listing. Refresh My Listings.':'A Lifetime Listing payment is already being processed for this listing. Please wait before trying again.');
      }
    }

    const secret=Deno.env.get('PAYSTACK_SECRET_KEY');
    if(!secret)throw new Error('PAYSTACK_SECRET_KEY is not configured');

    const r=await fetch('https://api.paystack.co/transaction/initialize',{
      method:'POST',
      headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        email:user.email,
        amount,
        currency:'NGN',
        callback_url:body.callback_url||'',
        metadata:{
          service,
          user_id:user.id,
          partner_store_id:partnerStore?.id||null,
          listing_id:listing?.id||null,
          seller_id:listing?.seller_id||partnerStore?.seller_id||null,
          listing_title:listing?.title||null
        }
      })
    });
    const j=await r.json();
    if(!r.ok||!j.status)throw new Error(j.message||'Paystack initialization failed');

    const serviceClient=createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const {error:paymentError}=await serviceClient.from('payments').insert({
      user_id:user.id,
      listing_id:listing?.id||null,
      seller_id:listing?.seller_id||partnerStore?.seller_id||null,
      partner_store_id:partnerStore?.id||null,
      reference:j.data.reference,
      service,
      amount,
      currency:'NGN',
      status:'initialized'
    });
    if(paymentError)throw paymentError;

    return new Response(JSON.stringify({
      authorization_url:j.data.authorization_url,
      reference:j.data.reference
    }),{headers:cors});
  }catch(e){
    return new Response(JSON.stringify({error:e instanceof Error?e.message:'Payment setup failed'}),{status:400,headers:cors});
  }
});