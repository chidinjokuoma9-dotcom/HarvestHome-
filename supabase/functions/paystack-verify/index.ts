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

    const {data:payment,error:paymentError}=await serviceClient
      .from('payments')
      .select('id,user_id,listing_id,seller_id,service,amount,currency,reference,status')
      .eq('reference',ref)
      .eq('user_id',user.id)
      .maybeSingle();
    if(paymentError)throw paymentError;
    if(!payment)throw new Error('Payment record not found');

    const response=await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`,
      {headers:{Authorization:`Bearer ${secret}`}}
    );
    const result=await response.json();
    if(!response.ok||!result.status)throw new Error(result.message||'Verification failed');

    const transaction=result.data;
    const transactionAmount=Number(transaction.amount||0);
    const expectedAmount=Number(payment.amount||0);
    if(transactionAmount!==expectedAmount)throw new Error('Payment amount does not match the HarvestHome payment request');
    if(String(transaction.currency||'').toUpperCase()!==String(payment.currency||'NGN').toUpperCase())throw new Error('Payment currency does not match the HarvestHome payment request');

    const status=transaction.status||'failed';
    const paidAt=status==='success'?(transaction.paid_at||new Date().toISOString()):null;

    const {error:updateError}=await serviceClient
      .from('payments')
      .update({status,paid_at:paidAt})
      .eq('id',payment.id);
    if(updateError)throw updateError;

    if(status==='success'){
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
      listing_id:payment.listing_id||null
    }),{headers:cors});
  }catch(e){
    return new Response(JSON.stringify({error:e instanceof Error?e.message:'Verification failed'}),{status:400,headers:cors});
  }
});