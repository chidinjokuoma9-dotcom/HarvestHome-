import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Content-Type":"application/json"
};

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return new Response(JSON.stringify({error:"POST requests only"}),{status:405,headers:cors});
  try{
    const body=await req.json();
    const requestId=String(body.request_id||"").trim();
    const email=String(body.email||"").trim().toLowerCase();
    if(!requestId||!email) throw new Error("Advertising request ID and advertiser email are required.");

    const url=Deno.env.get("SUPABASE_URL")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret=Deno.env.get("PAYSTACK_SECRET_KEY");
    if(!serviceKey||!secret) throw new Error("Payment service is not configured.");

    const db=createClient(url,serviceKey);
    const {data:request,error:requestError}=await db.from("advertising_requests")
      .select("id,business_name,email,status,approved_amount,payment_status")
      .eq("id",requestId).maybeSingle();
    if(requestError) throw requestError;
    if(!request) throw new Error("Advertising request not found.");
    if(String(request.email||"").trim().toLowerCase()!==email) throw new Error("The email does not match this advertising request.");
    if(request.status!=="approved") throw new Error("This advertising request has not been approved for payment yet.");
    if(!Number(request.approved_amount)||Number(request.approved_amount)<=0) throw new Error("HarvestHome has not set the advertising amount yet.");
    if(request.payment_status==="success") throw new Error("This advertising request has already been paid.");

    const amountKobo=Math.round(Number(request.approved_amount)*100);
    const reference="hh-ad-"+request.id.replaceAll("-","").slice(0,16)+"-"+Date.now();

    const paystack=await fetch("https://api.paystack.co/transaction/initialize",{
      method:"POST",
      headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},
      body:JSON.stringify({
        email,
        amount:amountKobo,
        currency:"NGN",
        callback_url:body.callback_url||"",
        metadata:{
          advertising_request_id:request.id,
          business_name:request.business_name,
          service:"advertising",
          custom_fields:[
            {display_name:"HarvestHome Advertising Request",variable_name:"advertising_request_id",value:request.id},
            {display_name:"Business",variable_name:"business_name",value:request.business_name}
          ]
        },
        reference
      })
    });
    const pj=await paystack.json();
    if(!paystack.ok||!pj.status) throw new Error(pj.message||"Paystack initialization failed.");

    const {error:insertError}=await db.from("advertising_payments").insert({
      request_id:request.id,
      advertiser_email:email,
      reference:pj.data.reference,
      amount:amountKobo,
      currency:"NGN",
      status:"initialized"
    });
    if(insertError) throw insertError;

    const {error:updateError}=await db.from("advertising_requests").update({
      payment_status:"pending",
      payment_reference:pj.data.reference
    }).eq("id",request.id);
    if(updateError) throw updateError;

    return new Response(JSON.stringify({
      authorization_url:pj.data.authorization_url,
      reference:pj.data.reference,
      amount:amountKobo,
      request_id:request.id
    }),{status:200,headers:cors});
  }catch(e){
    return new Response(JSON.stringify({error:e instanceof Error?e.message:"Advertising payment setup failed."}),{status:400,headers:cors});
  }
});