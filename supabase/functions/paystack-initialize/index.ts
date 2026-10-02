import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Content-Type":"application/json"
};

const PRICES:Record<string,number>={featured:200000,featured_7:200000,featured_14:400000,featured_30:800000,verification:500000,pro:1000000,verified_pro:25000000};

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
    let listing:any=null;
    if(service.startsWith('featured')){
      if(!listingId)throw new Error('Select the exact listing this Featured payment is for');
      const {data,error:listingError}=await userClient
        .from('listings')
        .select('id,title,seller_id,status,currency')
        .eq('id',listingId)
        .maybeSingle();
      if(listingError)throw listingError;
      if(!data)throw new Error('Listing not found');
      listing=data;
      if(listing.seller_id!==user.id)throw new Error('You can only pay for your own listing');
      if(listing.status==='deleted')throw new Error('This listing is no longer available');
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
          listing_id:listing?.id||null,
          seller_id:listing?.seller_id||null,
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
      seller_id:listing?.seller_id||null,
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