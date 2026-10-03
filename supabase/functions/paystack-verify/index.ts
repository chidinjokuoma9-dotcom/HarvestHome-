import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Content-Type":"application/json"
};

serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const url=new URL(req.url);
    const ref=url.searchParams.get('reference')||url.searchParams.get('trxref')||'';
    if(!ref)throw new Error('Reference is required');

    const auth=req.headers.get('Authorization')||'';
    const userClient=createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {global:{headers:{Authorization:auth}}}
    );
    const {data:{user}}=await userClient.auth.getUser();
    if(!user)return new Response(JSON.stringify({error:'Sign in required.'}),{status:401,headers:cors});

    const secret=Deno.env.get('PAYSTACK_SECRET_KEY');
    if(!secret)throw new Error('PAYSTACK_SECRET_KEY is not configured');

    const serviceClient=createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify with Paystack first. This lets us use Paystack's canonical
    // transaction reference even if the browser returned trxref/reference differently.
    const response=await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`,
      {headers:{Authorization:`Bearer ${secret}`}}
    );
    const result=await response.json();
    if(!response.ok||!result.status)throw new Error(result.message||'Verification failed');

    const transaction=result.data;
    const canonicalRef=String(transaction.reference||ref);
    const transactionAmount=Number(transaction.amount||0);
    const transactionCurrency=String(transaction.currency||'NGN').toUpperCase();

    if(transaction.metadata?.user_id&&String(transaction.metadata.user_id)!==String(user.id)){
      throw new Error('This payment belongs to a different HarvestHome account');
    }

    let {data:payment,error:paymentError}=await serviceClient
      .from('payments')
      .select('id,user_id,listing_id,seller_id,service,amount,currency,reference,status,created_at')
      .eq('reference',canonicalRef)
      .eq('user_id',user.id)
      .maybeSingle();
    if(paymentError)throw paymentError;

    // If the callback reference was valid at Paystack but the local record
    // used a different reference, safely recover only when there is exactly
    // one recent matching initialized/success payment for this account.
    if(!payment){
      const {data:candidates,error:candidateError}=await serviceClient
        .from('payments')
        .select('id,user_id,listing_id,seller_id,service,amount,currency,reference,status,created_at')
        .eq('user_id',user.id)
        .in('status',['initialized','success'])
        .eq('amount',transactionAmount)
        .eq('currency',transactionCurrency)
        .gte('created_at',new Date(Date.now()-24*60*60*1000).toISOString())
        .order('created_at',{ascending:false})
        .limit(2);
      if(candidateError)throw candidateError;
      if((candidates||[]).length===1)payment=candidates[0];
    }
    if(!payment){
      const service=String(transaction.metadata?.service||'');
      const metadataUserId=String(transaction.metadata?.user_id||'');
      const metadataListingId=transaction.metadata?.listing_id?String(transaction.metadata.listing_id):null;
      const fixedPrices:Record<string,number>={featured:200000,verification:500000,pro:1000000};
      if(metadataUserId!==String(user.id))throw new Error('This payment is not linked to your HarvestHome account');
      if(!fixedPrices[service]||fixedPrices[service]!==transactionAmount)throw new Error('This Paystack transaction does not match a valid HarvestHome service');
      if(!metadataListingId)throw new Error('This payment is missing its HarvestHome listing reference');
      const {data:listing,error:listingError}=await serviceClient.from('listings')
        .select('id,seller_id,status,title').eq('id',metadataListingId).eq('seller_id',user.id).maybeSingle();
      if(listingError)throw listingError;
      if(!listing)throw new Error('The listing linked to this payment could not be verified');
      const {data:created,error:insertError}=await serviceClient.from('payments').insert({
        user_id:user.id,
        listing_id:listing.id,
        seller_id:listing.seller_id,
        reference:canonicalRef,
        service,
        amount:transactionAmount,
        currency:transactionCurrency,
        status:'initialized'
      }).select('id,user_id,listing_id,seller_id,service,amount,currency,reference,status,created_at').single();
      if(insertError)throw insertError;
      payment=created;
    }

    const expectedAmount=Number(payment.amount||0);
    if(transactionAmount!==expectedAmount)throw new Error('Payment amount does not match the HarvestHome payment request');
    if(transactionCurrency!==String(payment.currency||'NGN').toUpperCase())throw new Error('Payment currency does not match the HarvestHome payment request');

    const status=transaction.status||'failed';
    const paidAt=status==='success'?(transaction.paid_at||new Date().toISOString()):null;

    const {error:updateError}=await serviceClient
      .from('payments')
      .update({status,paid_at:paidAt})
      .eq('id',payment.id);
    if(updateError)throw updateError;

    let activation:any=null;
    let activationError:string|null=null;
    if(status==='success'){
      // Complete the paid-service activation on the server as part of verification.
      // This prevents a successful Paystack payment from being left as an unactivated record
      // when the browser callback is interrupted, closed, or opened in another tab.
      try{
        if(String(payment.service||'').startsWith('featured')){
          const a=await userClient.rpc('activate_paid_featured_payment',{p_reference:canonicalRef});
          if(a.error)throw a.error;
          activation=a.data;
        }else if(payment.service==='pro'){
          const a=await userClient.rpc('activate_paid_professional_seller',{p_reference:canonicalRef});
          if(a.error)throw a.error;
          activation=a.data;
        }else if(payment.service==='verified_pro'){
          const a=await userClient.rpc('activate_paid_verified_professional_seller',{p_reference:canonicalRef});
          if(a.error)throw a.error;
          activation=a.data;
        }else if(payment.service==='verification'){
          const a=await userClient.rpc('submit_paid_seller_verification',{p_reference:canonicalRef});
          if(a.error)throw a.error;
          activation=a.data;
        }
      }catch(e){
        activationError=e instanceof Error?e.message:String(e);
        console.warn('Paid service activation retry failed:',activationError);
      }

      const listingTitle=transaction.metadata?.listing_title||null;
      const listingText=listingTitle?` for "${listingTitle}"`:'';
      const message=`Payment successful${listingText}. Amount: ${transactionAmount/100} ${transaction.currency||payment.currency||'NGN'}. Reference: ${transaction.reference}.`;
      const {error:notificationError}=await serviceClient.from('notifications').insert({
        user_id:payment.seller_id||payment.user_id,
        type:'payment_success',
        title:'Payment successful',
        message,
        listing_id:payment.listing_id||null
      });
      if(notificationError)console.warn('Payment notification failed',notificationError.message);
    }

    return new Response(JSON.stringify({
      success:status==='success',
      status,
      reference:transaction.reference,
      amount:transactionAmount,
      currency:transaction.currency||payment.currency,
      service:payment.service,
      listing_id:payment.listing_id||null,
      activation,
      activation_error:activationError
    }),{headers:cors});
  }catch(e){
    return new Response(JSON.stringify({error:e instanceof Error?e.message:'Verification failed'}),{status:400,headers:cors});
  }
});