import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
serve(async(req)=>{ if(req.method==='OPTIONS') return new Response('ok',{headers:cors}); try{
 const auth=req.headers.get('Authorization')||''; const supabase=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}});
 const {data:{user}}=await supabase.auth.getUser(); if(!user) return new Response(JSON.stringify({error:'Sign in required.'}),{status:401,headers:cors});
 const body=await req.json(); const amount=Number(body.amount); if(!Number.isFinite(amount)||amount<=0) throw new Error('Invalid amount');
 const secret=Deno.env.get('PAYSTACK_SECRET_KEY'); if(!secret) throw new Error('PAYSTACK_SECRET_KEY is not configured');
 const r=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,amount:Math.round(amount),currency:body.currency||'NGN',callback_url:body.callback_url,metadata:{service:body.service||'marketplace',user_id:user.id}})});
 const j=await r.json(); if(!r.ok||!j.status) throw new Error(j.message||'Paystack initialization failed');
 await supabase.from('payments').insert({user_id:user.id,reference:j.data.reference,service:body.service||'marketplace',amount:Math.round(amount),currency:body.currency||'NGN',status:'initialized'});
 return new Response(JSON.stringify({authorization_url:j.data.authorization_url,reference:j.data.reference}),{headers:cors});
 }catch(e){return new Response(JSON.stringify({error:e.message||'Payment setup failed'}),{status:400,headers:cors});} });
