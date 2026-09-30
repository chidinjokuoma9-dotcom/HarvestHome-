(() => {
"use strict";
const C = window.HARVESTHOME_CONFIG || { APP_NAME:"HarvestHome", VERSION:"V8", SUPPORTED_COUNTRIES:[{name:"Nigeria",code:"NG",currency:"NGN",symbol:"₦"}], CATEGORIES:["All categories","Houses","Land","Equipment","Farm Produce"], MODES:["All","Sale","Lease"], LOCATIONS:{Nigeria:["All locations"]}, DEFAULT_COUNTRY:"Nigeria", DEFAULT_CURRENCY:"NGN", MAX_IMAGE_FILES:6, MAX_VIDEO_MB:25 };
const SUPPORT_EMAIL = "harvesthcn@gmail.com";
const sb = (window.supabase && C.SUPABASE_URL && C.SUPABASE_ANON_KEY && C.SUPABASE_URL.startsWith("http")) ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
let authUser = null, authProfile = null;
const KEYS = {users:"hh_v4_users",session:"hh_v4_session",favourites:"hh_v4_favourites",enquiries:"hh_v4_enquiries",sellerListings:"hh_v4_seller_listings",country:"hh_v4_country",currency:"hh_v4_currency",reset:"hh_v6_reset_tokens",payments:"hh_v6_payments",notifications:"hh_v8_notifications",notificationReads:"hh_v8_notification_reads",rewards:"hh_v9_rewards",recommendations:"hh_v9_recommendations"};
const DEMO_ADMIN={email:"admin@harvesthome.app",name:"HarvestHome Admin",password:"Admin123!",role:"Admin"};
const V5 = {maxImages:6,maxVideoMB:25};
const mapURL=l=>`https://www.openstreetmap.org/search?query=${encodeURIComponent(`${l.location||""}, ${l.country||""}`)}`;
const readFiles=files=>Promise.all([...files].map(file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({name:file.name,type:file.type,data:r.result});r.onerror=reject;r.readAsDataURL(file)})));

const seed = [];

const state={view:"marketplace",search:"",country:localStorage.getItem(KEYS.country)||C.DEFAULT_COUNTRY,location:"All locations",category:"All categories",mode:"All",dashboardTab:"overview",authMode:"login",payments:[],transactionFilterSeller:{status:"all",range:"all",search:""},transactionFilterAdmin:{status:"all",range:"all",search:""}};
let chatTimer=null;
state.rewardAdmin=[];state.sellerPerformance={listings:0,approved:0,pending:0,rejected:0,views:0,chats:0,uniqueBuyers:0,recommendations:0};state.listingPerformance=[];
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const json=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}};
const put=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const users=()=>{let us=json(KEYS.users,[]);if(!us.some(u=>u.email===DEMO_ADMIN.email)){us.push({...DEMO_ADMIN});put(KEYS.users,us)}return us};
const session=()=>json(KEYS.session,null);
const user=()=> authUser ? ({...authUser,...(authProfile||{}), email:authUser.email, id:authUser.id, name:(authProfile&&authProfile.full_name)||authUser.user_metadata?.full_name||authUser.email, role:(authProfile&&authProfile.role)||authUser.user_metadata?.role||"Buyer"}) : (session()?users().find(u=>u.email===session().email):null);
const countryInfo=()=>C.SUPPORTED_COUNTRIES.find(x=>x.name===state.country)||C.SUPPORTED_COUNTRIES[0];
const listings=()=>json(KEYS.sellerListings,[]).filter(l=>l&&l.seller_id&&l.status!=="deleted");
async function syncListings(){
  if(!sb)return;
  try{
    const {data,error}=await sb.from('listings').select('*, profiles: seller_id(full_name,verified)').order('created_at',{ascending:false});
    if(error)throw error;

    const base=(data||[]).filter(l=>l&&l.seller_id&&l.status!=='deleted').map(l=>({
      ...l,id:l.id,
      ownerEmail:authUser?.id===l.seller_id?(authUser.email||''):undefined,
      seller:l.profiles?.full_name||l.seller_name||'HarvestHome Seller',
      sellerVerified:!!l.profiles?.verified,
      images:l.cover_url?[{data:l.cover_url}]:[],
      video:l.video_url?{data:l.video_url}:null,
      views:l.views||0
    }));

    if(base.length){
      const mediaResult=await sb.from('listing_media')
        .select('listing_id,media_type,storage_path')
        .in('listing_id',base.map(l=>l.id));

      if(!mediaResult.error){
        const byListing={};
        (mediaResult.data||[]).forEach(m=>{
          if(!byListing[m.listing_id])byListing[m.listing_id]={images:[],video:null};
          const publicUrl=sb.storage.from('listing-media').getPublicUrl(m.storage_path).data.publicUrl;
          if(m.media_type==='image'){
            if(!byListing[m.listing_id].images.some(x=>x.data===publicUrl)){
              byListing[m.listing_id].images.push({data:publicUrl});
            }
          }else if(m.media_type==='video'){
            byListing[m.listing_id].video={data:publicUrl};
          }
        });
        base.forEach(l=>{
          const media=byListing[l.id];
          if(!media)return;
          const fallback=l.cover_url?[{data:l.cover_url}]:[];
          l.images=media.images.length?media.images:fallback;
          if(l.cover_url&&!l.images.some(x=>x.data===l.cover_url))l.images=[{data:l.cover_url},...l.images];
          if(media.video)l.video=media.video;
        });
      }
    }

    const cached=json(KEYS.sellerListings,[]);
    const remoteIds=new Set(base.map(x=>String(x.id)));
    const mineCached=cached.filter(x=>x&&x.seller_id===authUser?.id&&!remoteIds.has(String(x.id))&&x.status!=='deleted');
    put(KEYS.sellerListings,[...base,...mineCached]);
  }catch(e){console.warn('Supabase listings sync failed',e.message)}
}
function rewardDefaults(){return {points:0,participation:0,recommendations:0,referralPoints:0,buyers:0}}
function localReward(email,field,points=0){
  if(!email)return;
  const all=json(KEYS.rewards,{});
  const r={...rewardDefaults(),...(all[email]||{})};
  r[field]=(Number(r[field])||0)+Number(points||0);
  r.points=(Number(r.participation)||0)+(Number(r.recommendations)||0)+(Number(r.referralPoints)||0);
  all[email]=r;put(KEYS.rewards,all);
}
function getReward(email){return {...rewardDefaults(),...(json(KEYS.rewards,{})[email]||{})}}
async function syncRewards(){
  if(!sb||!authUser)return;
  try{
    const {data,error}=await sb.from("seller_rewards").select("*").eq("user_id",authUser.id).maybeSingle();
    if(!error&&data){
      const all=json(KEYS.rewards,{});
      all[authUser.email]={points:data.points||0,participation:data.participation_points||0,recommendations:data.recommendation_points||0,referralPoints:data.buyer_referral_points||0,buyers:data.buyer_count||0,recommendationCount:data.recommendation_count||0};
      put(KEYS.rewards,all);
    }
  }catch(e){console.warn("Rewards sync failed",e.message)}
}
async function syncAdminRewards(){
  if(!sb||!authUser||!['Admin','Moderator'].includes(user()?.role)){state.rewardAdmin=[];return}
  try{const {data,error}=await sb.rpc('get_reward_eligibility');if(error)throw error;state.rewardAdmin=data||[]}
  catch(e){console.warn('Admin reward eligibility sync failed',e.message);state.rewardAdmin=[]}
}
async function syncSellerPerformance(){
  state.sellerPerformance={listings:0,approved:0,pending:0,rejected:0,views:0,chats:0,uniqueBuyers:0,recommendations:0};
  if(!authUser||!sb)return;
  try{
    const {data,error}=await sb.from('listings').select('id,status,views').eq('seller_id',authUser.id);
    if(error)throw error;
    const rows=data||[],perf=state.sellerPerformance;
    perf.listings=rows.length;
    perf.approved=rows.filter(x=>x.status==='approved').length;
    perf.pending=rows.filter(x=>x.status==='pending').length;
    perf.rejected=rows.filter(x=>x.status==='rejected').length;
    perf.views=rows.reduce((sum,x)=>sum+(Number(x.views)||0),0);
    const {count,error:chatError}=await sb.from('conversations').select('id',{count:'exact',head:true}).eq('seller_id',authUser.id);
    if(!chatError)perf.chats=count||0;
    const r=getReward(authUser.email);
    perf.uniqueBuyers=Number(r.buyers)||0;
    perf.recommendations=Number(r.recommendationCount)||0;
  }catch(e){console.warn('Seller performance sync failed',e.message)}
}
async function syncListingPerformance(){
  state.listingPerformance=[];
  if(!sb||!authUser)return;
  try{
    const {data,error}=await sb.rpc('get_seller_listing_performance',{p_seller_id:authUser.id});
    if(error)throw error;
    state.listingPerformance=data||[];
  }catch(e){console.warn('Listing performance sync failed',e.message)}
}
async function recordListingView(listingId){
  if(!sb||!authUser||!listingId)return;
  const key='hh_v10_listing_views';
  const seen=json(key,{});
  const now=Date.now(),last=Number(seen[String(listingId)]||0);
  if(now-last<30*60*1000)return;
  seen[String(listingId)]=now;put(key,seen);
  try{await sb.rpc('record_listing_view',{p_listing_id:listingId});await syncListingPerformance()}catch(e){console.warn('Listing view could not be recorded:',e.message)}
}
async function awardParticipation(points,reason){
  const u=user();if(!u)return;
  if(sb&&authUser){
    const {error}=await sb.rpc("award_participation_points",{p_user_id:authUser.id,p_points:Number(points),p_reason:reason||"participation"});
    if(!error){localReward(u.email,"participation",points);await syncRewards();return}
  }
  localReward(u.email,"participation",points);
}
async function awardListingParticipation(listingId){
  if(!sb||!authUser||!listingId)return;
  try{
    const {error}=await sb.rpc("award_participation_points",{p_user_id:authUser.id,p_points:10,p_reason:"listing_created"});
    if(error)throw error;
    await syncRewards();
  }catch(e){console.warn("Listing participation reward could not be recorded:",e.message)}
}
async function recommendSeller(listingId){
  const u=user();
  if(!u){auth("login");toast("Log in to recommend a seller.",true);return}
  const l=listings().find(x=>String(x.id)===String(listingId));
  if(!l||!l.seller_id){toast("This listing is not connected to a seller account yet.",true);return}
  if(l.seller_id===u.id){toast("You cannot recommend yourself.",true);return}
  try{
    if(sb&&authUser){
      const {error}=await sb.rpc("recommend_seller",{p_seller_id:l.seller_id,p_listing_id:l.id});
      if(error)throw error;
      await syncListingPerformance();
    }else{
      const all=json(KEYS.recommendations,[]);
      const key=`${u.email}:${l.seller_id}:${l.id}`;
      if(all.some(x=>x.key===key)){toast("You already recommended this seller.",true);return}
      all.push({key,buyerEmail:u.email,seller_id:l.seller_id,listing_id:l.id,date:new Date().toISOString()});
      put(KEYS.recommendations,all);
    }
    try{await createNotification(l.seller_id,'reward','Seller recommendation received','A buyer recommended your seller profile through your approved listing. You earned recommendation points.',l.id)}catch(e){console.warn('Reward notification could not be created:',e.message)}
    toast("Seller recommended. Thank you!");
  }catch(err){toast(err.message||"Recommendation could not be saved.",true)}
}

async function fav(id){
  const u=user();
  if(!u||!authUser){auth("login");toast("Log in to save a favourite.",true);return}
  if(!sb){toast("Favourites are unavailable right now.",true);return}
  try{
    const f=json(KEYS.favourites,{});
    const current=f[u.email]||[];
    if(current.includes(id)){
      const {error}=await sb.from('favourites').delete().eq('user_id',authUser.id).eq('listing_id',id);
      if(error)throw error;
      f[u.email]=current.filter(x=>x!==id);
      toast("Removed from favourites.");
    }else{
      const {error}=await sb.from('favourites').insert({user_id:authUser.id,listing_id:id});
      if(error)throw error;
      f[u.email]=[...current,id];
      toast("Saved to favourites.");
    }
    put(KEYS.favourites,f);
    render();
  }catch(e){toast(e.message||"Favourite could not be saved.",true)}
}

function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function money(n,cur){try{return new Intl.NumberFormat("en",{style:"currency",currency:cur,maximumFractionDigits:0}).format(Number(n))}catch{return `${cur} ${n}`}}
function slug(v){return String(v).toLowerCase().replace(/\s+/g,"-")}
function toast(m,error=false){let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";document.body.append(t)}t.textContent=m;t.className="toast "+(error?"error ":"");requestAnimationFrame(()=>t.classList.add("show"));setTimeout(()=>t.classList.remove("show"),2800)}
function options(a,s){return a.map(x=>`<option ${x===s?"selected":""}>${esc(x)}</option>`).join("")}

function render(){document.body.innerHTML=`<div id="app">${state.view==="marketplace"?marketplace():dashboard()}</div><div id="modalRoot"></div><div id="toast"></div>`;bind()}
async function createNotification(userId,type,title,message,listingId=null){if(!userId)return false;const item={id:'local-'+Date.now()+'-'+Math.random().toString(36).slice(2),user_id:userId,type,title,message,listing_id:listingId,is_read:false,created_at:new Date().toISOString()};const n=json(KEYS.notifications,{});n[userId]=[item,...(n[userId]||[])];put(KEYS.notifications,n);if(sb){try{const {data,error}=await sb.from('notifications').insert({user_id:userId,type,title,message,listing_id:listingId}).select().single();if(error)throw error;const latest=json(KEYS.notifications,{});latest[userId]=[data,...(latest[userId]||[]).filter(x=>x.id!==item.id)];put(KEYS.notifications,latest);return true}catch(e){console.warn('Supabase notification could not be created:',e.message)}}return false}
async function syncNotifications(){if(!sb||!authUser)return;try{const {data,error}=await sb.from('notifications').select('*').eq('user_id',authUser.id).order('created_at',{ascending:false});if(error)throw error;const n=json(KEYS.notifications,{});const local=(n[authUser.id]||[]).filter(x=>String(x.id||'').startsWith('local-'));const remote=data||[];n[authUser.id]=[...local.filter(x=>!remote.some(r=>r.listing_id===x.listing_id&&r.type===x.type&&r.title===x.title)),...remote];put(KEYS.notifications,n)}catch(e){console.warn('Supabase notifications sync failed',e.message)}}
async function uploadProfilePhoto(file){if(!sb||!authUser){toast('Please log in first.',true);return}if(!file)return;if(!file.type.startsWith('image/')){toast('Please choose an image file.',true);return}if(file.size>5*1024*1024){toast('Profile photo must be 5 MB or smaller.',true);return}try{const ext=(file.name.split('.').pop()||'jpg').replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||'jpg';const path=authUser.id+'/avatar.'+ext;const up=await sb.storage.from('profile-media').upload(path,file,{upsert:true,contentType:file.type});if(up.error)throw up.error;const url=sb.storage.from('profile-media').getPublicUrl(path).data.publicUrl+'?v='+Date.now();const {error}=await sb.from('profiles').update({avatar_url:url,updated_at:new Date().toISOString()}).eq('id',authUser.id);if(error)throw error;await loadProfile();render();toast('Profile photo updated.')}catch(e){toast(e.message||'Profile photo could not be uploaded.',true)}}
async function markNotificationRead(id){
  if(!authUser)return;
  try{
    if(String(id).startsWith("listing-status:")){
      const r=json(KEYS.notificationReads,{}); r[authUser.id]=r[authUser.id]||{}; r[authUser.id][id]=true; put(KEYS.notificationReads,r); render(); return;
    }
    if(!sb)throw new Error("Notification service is unavailable.");
    const {error}=await sb.from("notifications").update({is_read:true}).eq("id",id).eq("user_id",authUser.id);
    if(error)throw error; await syncNotifications(); render();
  }catch(e){toast(e.message||"Notification could not be updated.",true)}
}
async function markAllNotificationsRead(){
  if(!authUser)return;
  try{
    const r=json(KEYS.notificationReads,{}); r[authUser.id]=r[authUser.id]||{};
    const mine=json(KEYS.sellerListings,[]).filter(x=>String(x.seller_id)===String(authUser.id));
    notificationFeed(mine).filter(n=>String(n.id).startsWith("listing-status:")).forEach(n=>{r[authUser.id][n.id]=true});
    put(KEYS.notificationReads,r);
    if(sb){const {error}=await sb.from("notifications").update({is_read:true}).eq("user_id",authUser.id).eq("is_read",false);if(error)throw error;await syncNotifications()}
    render(); toast("All notifications marked as read.")
  }catch(e){toast(e.message||"Notifications could not be updated.",true)}
}
async function syncFavourites(){
  if(!sb||!authUser)return;
  try{
    const {data,error}=await sb.from('favourites').select('listing_id').eq('user_id',authUser.id);
    if(error)throw error;
    const f=json(KEYS.favourites,{});
    f[authUser.email]=(data||[]).map(x=>x.listing_id);
    put(KEYS.favourites,f);
  }catch(e){console.warn('Supabase favourites sync failed',e.message)}
}
async function loadProfile(){if(!sb||!authUser){authProfile=null;return}const {data}=await sb.from('profiles').select('*').eq('id',authUser.id).maybeSingle();authProfile=data||null}
async function loadAuth(){if(!sb){render();return}const {data}=await sb.auth.getSession();authUser=data.session?.user||null;await loadProfile();await syncListings();await syncFavourites();await syncNotifications();await syncPayments();await syncRewards();await syncSellerPerformance();await syncListingPerformance();await syncAdminRewards();render();}
async function syncPayments(){
  if(!sb||!authUser)return;
  try{
    const {data,error}=await sb.from("payments").select("*, listings(title, seller_id), profiles:user_id(full_name)").order("created_at",{ascending:false}).limit(100);
    if(error)throw error;
    state.payments=data||[];
  }catch(e){console.warn("Supabase payments sync failed",e.message)}
}
function header(){let u=user();return `<header class="site-header"><div class="container nav-wrap"><button class="brand" data-a="home"><span class="brand-mark">🌿</span><span><strong>HarvestHome</strong><small>International marketplace</small></span></button><nav class="desktop-nav"><button data-a="home">Marketplace</button><button data-scroll="categories">Categories</button><button data-scroll="how">How it works</button><button data-scroll="about">About</button></nav><div class="nav-actions"><select id="countryTop" aria-label="Country">${options(C.SUPPORTED_COUNTRIES.map(x=>x.name),state.country)}</select>${u?`<button class="ghost-btn account-btn" data-a="dashboard">${u.avatar_url?`<img class="nav-avatar" src="${esc(u.avatar_url)}" alt="">`:``}My account</button>${(u.role==="Admin"||u.role==="Moderator")?`<button class="ghost-btn" data-a="admin">Moderation</button>`:""}<button class="primary-btn small" data-a="logout">Logout</button>`:`<button class="ghost-btn" data-a="login">Login</button><button class="primary-btn small" data-a="signup">Join</button>`}</div></div></header>`}
function marketplace(){let ls=filtered();return `${header()}<section class="hero"><div class="container hero-grid"><div class="hero-copy"><span class="eyebrow">🌍 Global marketplace</span><h1>Buy, sell & lease <span>what matters.</span></h1><p>Discover houses, land, equipment and farm produce across markets around the world.</p><div class="hero-search"><input id="searchInput" value="${esc(state.search)}" placeholder="Search property, land, tractors, produce..."><button class="primary-btn" data-a="search">Search</button></div><div class="quick-stats"><span><b>${C.SUPPORTED_COUNTRIES.length}</b> launch markets</span><span><b>7+</b> categories</span><span><b>1</b> global platform</span></div></div><div class="hero-card"><div class="hero-card-icon">🌎</div><h3>One marketplace. Many markets.</h3><p>Start in Nigeria and discover opportunities across international markets.</p><button class="outline-btn" data-scroll="categories">Browse categories →</button></div></div></section>
<section class="filters-section"><div class="container filter-bar"><select id="countryFilter">${options(C.SUPPORTED_COUNTRIES.map(x=>x.name),state.country)}</select><select id="locationFilter">${options(C.LOCATIONS[state.country]||["All locations"],state.location)}</select><select id="categoryFilter">${options(C.CATEGORIES,state.category)}</select><select id="modeFilter">${options(C.MODES,state.mode)}</select><button class="clear-btn" data-a="clear">Clear</button></div></section>
<section class="section" id="categories"><div class="container"><div class="section-heading"><div><span class="eyebrow">Explore</span><h2>Browse categories</h2></div><span class="result-count">${ls.length} results in ${esc(state.country)}</span></div><div class="category-grid">${cat("🏠","Houses","Homes, apartments & property","Houses")}${cat("🌍","Land","Residential & agricultural land","Land")}${cat("🚜","Equipment","Tractors, machinery & tools","Equipment")}${cat("🌾","Farm Produce","Crops & fresh produce","Farm Produce")}</div></div></section>
<section class="section listings-section"><div class="container"><div class="section-heading"><div><span class="eyebrow">Marketplace</span><h2>Featured listings</h2></div><span class="result-count">${ls.length} available</span></div><div class="listing-grid">${ls.map(card).join("")||empty()}</div></div></section>
<section class="country-strip"><div class="container"><span class="eyebrow">Explore markets</span><h2>HarvestHome around the world</h2><div class="country-grid">${C.SUPPORTED_COUNTRIES.map(x=>`<button data-country="${esc(x.name)}"><b>${flag(x.code)}</b><span>${esc(x.name)}</span><small>${esc(x.currency)} · ${esc(x.symbol)}</small></button>`).join("")}</div></div></section>
<section class="section" id="about"><div class="container"><div class="section-heading"><div><span class="eyebrow">About HarvestHome</span><h2>Why HarvestHome exists</h2></div></div><div class="trust-grid"><div><h3>Our purpose</h3><p>HarvestHome is a marketplace built to help people discover, sell, buy and lease property, land, equipment and farm produce in one trusted place.</p><p>We want sellers to reach more genuine buyers while giving buyers a simpler way to compare opportunities by market, location and currency.</p></div><div><h3>Our goals</h3><ul><li>Connect buyers and sellers across local and international markets.</li><li>Give sellers practical tools to publish and manage listings.</li><li>Use moderation and seller identity information to improve marketplace trust.</li><li>Reward useful seller participation, recommendations and new buyer referrals.</li><li>Build sustainable revenue through optional seller services, payments and advertising.</li></ul></div></div><div class="dashboard-callout" style="margin-top:24px"><b>🏆 HarvestHome reward programme</b><p>Participation earns points. A buyer recommendation gives the seller 5 recommendation points. A verified unique buyer referral gives the seller 10 referral points and counts as one buyer.</p><p><b>Qualification guide:</b> 100 total points or 10 unique buyer referrals = Reward Qualified. 250 total points or 25 unique buyer referrals = Gold level. Rewards are issued according to the active HarvestHome reward campaign and budget.</p></div></div></section><section class="trust-section" id="how"><div class="container trust-grid"><div><span class="eyebrow">Built to scale</span><h2>One trusted marketplace for local and international opportunities.</h2><p>HarvestHome keeps the same simple experience while making countries, currencies and locations part of the marketplace from the start.</p></div><div class="trust-items"><div><span>✓</span><b>Multi-country search</b><small>Switch markets without leaving HarvestHome.</small></div><div><span>✓</span><b>Multi-currency listings</b><small>Display prices in the currency of each market.</small></div><div><span>✓</span><b>Local account tools</b><small>Buyers and sellers can manage activity from one account.</small></div></div></div></section>${footer()}`}
function cat(i,t,d,v){return `<button class="category-card" data-cat="${esc(v)}"><span>${i}</span><div><h3>${t}</h3><p>${d}</p></div><b>→</b></button>`}
function flag(c){return ({NG:"🇳🇬",GH:"🇬🇭",KE:"🇰🇪",ZA:"🇿🇦",GB:"🇬🇧",US:"🇺🇸",CA:"🇨🇦",AE:"🇦🇪"}[c]||"🌍")}
function filtered(){let q=state.search.toLowerCase().trim();return listings().filter(l=>(l.status||"approved")==="approved"&&(l.country||"Nigeria")===state.country&&(!q||`${l.title} ${l.category} ${l.location} ${l.description} ${l.seller}`.toLowerCase().includes(q))&&(state.location==="All locations"||l.location===state.location)&&(state.category==="All categories"||l.category===state.category)&&(state.mode==="All"||l.mode===state.mode))}
function card(l){
  let u=user(),f=json(KEYS.favourites,{}),fav=u&&(f[u.email]||[]).includes(l.id);
  const imgs=(l.images||[]).filter(x=>x&&x.data);
  const img=imgs[0]?.data;
  const thumbs=imgs.slice(1).map((x,i)=>`<img src="${esc(x.data)}" alt="${esc(l.title)} photo ${i+2}" style="width:72px;height:56px;object-fit:cover;border:2px solid #fff;border-radius:8px;box-shadow:0 1px 5px rgba(0,0,0,.18);background:#eee">`).join("");
  const mediaCount=imgs.length+(l.video?1:0);
  return `<article class="listing-card" data-view-listing="${esc(l.id)}">
    <div class="listing-image ${slug(l.category)}" style="padding:0;overflow:hidden;position:relative">
      ${img?`<img src="${esc(img)}" alt="${esc(l.title)}" style="width:100%;height:220px;object-fit:cover;display:block">`:`<span>${l.emoji||"📦"}</span>`}
      <button class="heart ${fav?"active":""}" data-fav="${l.id}">${fav?"♥":"♡"}</button>
      <span class="mode-pill">${esc(l.mode)}</span>
    </div>
    ${thumbs?`<div style="display:flex;gap:8px;padding:10px 12px 0;overflow-x:auto;background:#fff;border-bottom:1px solid #eee">${thumbs}</div>`:""}
    <div class="listing-body">
      <span class="listing-category">${esc(l.category)}</span>
      <h3>${esc(l.title)}</h3>
      <p class="location">📍 ${esc(l.location)} · ${esc(l.country)}</p>
      <p class="seller-line">👤 ${esc(l.seller||'HarvestHome Seller')}${l.sellerVerified?' · ✓ Verified seller':''}</p>
      <p class="description">${esc(l.description)}</p>
      <div class="listing-bottom"><strong>${money(l.price,l.currency||countryInfo().currency)}</strong><span>${l.views||0} views</span></div>
      ${l.video?`<div style="margin:12px 0;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#000">
        <video controls playsinline preload="metadata" src="${esc(l.video.data)}" style="width:100%;max-height:260px;display:block"></video>
        <div style="padding:7px 10px;background:#fff;font-size:12px;font-weight:600">🎥 Listing video</div>
      </div>`:""}
      ${mediaCount>1?`<small style="display:block;margin:6px 0;color:#667085">${imgs.length} photos${l.video?" + 1 video":""}</small>`:""}
      <div class="listing-actions"><button class="outline-btn full" data-contact="${l.id}">Contact seller</button><button class="ghost-btn full" data-recommend="${l.id}">⭐ Recommend seller</button><div class="media-links"><a target="_blank" rel="noopener" href="${mapURL(l)}">📍 Map</a></div></div>
    </div>
  </article>`;
}
function empty(){return `<div class="empty-state"><div>🔎</div><h3>No matching listings</h3><p>Try another market, location or search.</p><button class="primary-btn" data-a="clear">Clear filters</button></div>`}
function footer(){return `<footer><div class="container footer-grid"><div><div class="footer-brand">🌿 HarvestHome</div><p>The international marketplace for property, equipment and farm produce.</p></div><div><b>Markets</b>${C.SUPPORTED_COUNTRIES.slice(0,4).map(x=>`<button data-country="${esc(x.name)}">${flag(x.code)} ${esc(x.name)}</button>`).join("")}</div><div><b>HarvestHome</b><button data-scroll="about">About & rewards</button><button data-scroll="how">How it works</button><button data-terms>Terms & Conditions</button></div><div><b>Support</b><a href="mailto:${SUPPORT_EMAIL}?subject=HarvestHome%20Complaint%20or%20Enquiry">Complaints & enquiries</a><small>${esc(SUPPORT_EMAIL)}</small></div><div><b>Account</b><button data-a="login">Login</button><button data-a="signup">Create account</button></div></div><div class="container footer-bottom">© ${new Date().getFullYear()} HarvestHome · International marketplace · <a href="mailto:${SUPPORT_EMAIL}?subject=HarvestHome%20Complaint%20or%20Enquiry">Complaints & enquiries</a></div></footer>`}

function adminPanel(){
  if(!user()||!['Admin','Moderator'].includes(user().role))return '<div class="empty-state"><h3>Access denied</h3></div>';
  let ls=json(KEYS.sellerListings,[]),allPs=state.payments||[],f=state.transactionFilterAdmin,ps=filterTransactions(allPs,f);
  return '<div class="panel-heading"><div><span class="eyebrow">Admin workspace</span><h2>Moderation & Payments</h2></div><span class="result-count">'+ls.length+' seller listings · '+allPs.length+' payments</span></div>'+
  '<div class="panel-heading"><div><span class="eyebrow">Listing moderation</span><h3>Seller listings</h3></div></div>'+
  '<div class="table-wrap"><table><thead><tr><th>Listing</th><th>Seller</th><th>Status</th><th>Action</th></tr></thead><tbody>'+(ls.length?ls.map(l=>'<tr><td><b>'+esc(l.title)+'</b><small>'+esc(l.country)+' · '+esc(l.location)+'</small></td><td>'+esc(l.seller||l.ownerEmail||'')+'</td><td><span class="status-pill '+slug(l.status||'approved')+'">'+esc(l.status||'approved')+'</span></td><td><button class="ghost-btn" data-mod="approve:'+esc(l.id)+'">Approve</button> <button class="ghost-btn" data-mod="reject:'+esc(l.id)+'">Reject</button> <button class="danger-text" data-mod="delete:'+esc(l.id)+'">Delete</button></td></tr>').join(''):'<tr><td colspan="4">No seller listings to moderate.</td></tr>')+'</tbody></table></div>'+
  '<div class="panel-heading"><div><span class="eyebrow">Automatic reward review</span><h3>Seller reward qualification</h3></div><span class="result-count">'+state.rewardAdmin.length+' sellers tracked</span></div><div class="table-wrap"><table><thead><tr><th>Seller</th><th>Total points</th><th>Participation</th><th>Unique buyers</th><th>Buyer points</th><th>Recommendations</th><th>Status</th></tr></thead><tbody>'+(state.rewardAdmin.length?state.rewardAdmin.map(r=>'<tr><td><b>'+esc(r.full_name||r.email||'Seller')+'</b><small>'+esc(r.email||'')+'</small></td><td><b>'+Number(r.points||0)+'</b></td><td>'+Number(r.participation_points||0)+'</td><td>'+Number(r.buyer_count||0)+'</td><td>'+Number(r.buyer_referral_points||0)+'</td><td>'+Number(r.recommendation_count||0)+'</td><td><span class="status-pill '+(r.reward_status==="Qualified"?"approved":"pending")+'">'+esc(r.reward_tier||"Standard")+' · '+esc(r.reward_status||"Building")+'</span></td></tr>').join(''):'<tr><td colspan="7">No reward records yet.</td></tr>')+'</tbody></table></div>'+
  '<div class="panel-heading"><div><span class="eyebrow">Payment monitoring</span><h3>Transaction history</h3></div></div>'+
  '<div class="dashboard-callout"><b>Manage a large payment history</b><p>Filter by date, status or search. Clear filters only resets your current view; payment records remain safely stored for reconciliation and enquiries.</p></div>'+
  transactionFilters(f,"admin")+
  '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Payer</th><th>Transaction</th><th>Listing</th><th>Service</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>'+(ps.length?ps.map(p=>{const sellerListings=ls.filter(l=>String(l.seller_id||'')===String(p.seller_id||p.user_id||'')&&l.status!=='deleted');const canLink=p.status==='success'&&!p.listing_id&&sellerListings.length;const opts=sellerListings.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.title)+' — '+esc(l.location||l.country||'')+'</option>').join('');return '<tr><td>'+(p.created_at?new Date(p.created_at).toLocaleString():'—')+'</td><td><b>'+esc(p.profiles?.full_name||p.user_id||'Customer')+'</b></td><td><code>'+esc(p.reference||'—')+'</code></td><td><b>'+esc(p.listings?.title||'No listing linked')+'</b></td><td>'+esc(p.service||'Marketplace')+'</td><td>'+money((Number(p.amount)||0)/100,p.currency||'NGN')+'</td><td><span class="status-pill '+slug(p.status||'initialized')+'">'+esc(p.status||'initialized')+'</span></td><td>'+(canLink?'<select data-link-select="'+esc(p.id)+'"><option value="">Select exact listing</option>'+opts+'</select><button class="ghost-btn" data-link-payment="'+esc(p.id)+'">Link payment</button>':'—')+'</td></tr>'}).join(''):'<tr><td colspan="8">No matching payments.</td></tr>')+'</tbody></table></div>'+
  '<div class="dashboard-callout"><b>Payment records are protected</b><p>Filtering does not delete Paystack records. Successful unlinked payments can still be matched to the seller&apos;s exact listing.</p></div>';
}
function dashboard(){let u=user();if(!u){state.view="marketplace";return marketplace()}let favs=json(KEYS.favourites,{})[u.email]||[], mine=json(KEYS.sellerListings,[]).filter(x=>authUser&&String(x.seller_id)===String(authUser.id)), enq=json(KEYS.enquiries,[]).filter(x=>x.buyerEmail===u.email), notifications=authUser?notificationFeed(mine):[], unread=notifications.filter(n=>!n.is_read).length;return `${header()}<section class="dashboard-hero"><div class="container"><button class="back-btn" data-a="home">← Marketplace</button><span class="eyebrow">My account</span><h1>Welcome, ${esc(u.name.split(" ")[0])}.</h1><p>Manage your favourites, enquiries and seller listings across your selected market.</p></div></section><section class="dashboard-section"><div class="container dashboard-layout"><aside class="dashboard-nav"><button class="${state.dashboardTab==="overview"?"active":""}" data-tab="overview">Overview</button><button class="${state.dashboardTab==="profile"?"active":""}" data-tab="profile">Profile</button><button class="${state.dashboardTab==="favourites"?"active":""}" data-tab="favourites">Favourites (${favs.length})</button><button class="${state.dashboardTab==="listings"?"active":""}" data-tab="listings">My listings (${mine.length})</button><button class="${state.dashboardTab==="listingPerformance"?"active":""}" data-tab="listingPerformance">📊 Listing performance</button><button class="${state.dashboardTab==="rewards"?"active":""}" data-tab="rewards">🏆 Rewards</button><button class="${state.dashboardTab==="notifications"?"active":""}" data-tab="notifications">🔔 Notifications${unread?` (${unread})`:``}</button><button class="${state.dashboardTab==="enquiries"?"active":""}" data-tab="enquiries">Enquiries (${enq.length})</button><button class="${state.dashboardTab==="chats"?"active":""}" data-tab="chats">💬 Chats</button>${(u.role==="Admin"||u.role==="Moderator")?`<button class="${state.dashboardTab==="moderation"?"active":""}" data-tab="moderation">Moderation</button>`:""}<button class="${state.dashboardTab==="payments"?"active":""}" data-tab="payments">Payments</button><button data-a="logout">Logout</button></aside><div class="dashboard-content">${dashTab(u,favs,mine,enq)}</div></div></section>${footer()}`}
function notificationFeed(mine=[]){
  if(!authUser)return [];
  const remote=json(KEYS.notifications,{})[authUser.id]||[];
  const reads=json(KEYS.notificationReads,{})[authUser.id]||{};
  const synthetic=mine.filter(l=>l.status==="approved"||l.status==="rejected"||l.status==="deleted").map(l=>{
    const id="listing-status:"+l.id+":"+l.status+":"+(l.updated_at||"");
    const approved=l.status==="approved", deleted=l.status==="deleted";
    const title=approved?"Listing approved":deleted?"Listing removed":"Listing not approved";
    const message=approved?("Your listing \""+l.title+"\" has been approved and is now visible on HarvestHome."):deleted?("Your listing \""+l.title+"\" was removed by a moderator."):("Your listing \""+l.title+"\" was not approved. Please review the listing details and submit an updated listing if needed.");
    return {id,user_id:authUser.id,type:"listing_review",title,message,listing_id:l.id,is_read:!!reads[id],created_at:l.updated_at||l.created_at||new Date().toISOString(),synthetic:true};
  }).filter(x=>!remote.some(r=>r.listing_id===x.listing_id&&r.type===x.type&&r.title===x.title));
  return [...remote,...synthetic].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
}

function profileTab(u){
  const avatar=u.avatar_url||"";
  return "<div class=\"panel-heading\"><div><span class=\"eyebrow\">Account</span><h2>My profile</h2></div></div>"+
    "<div class=\"profile-card\"><div class=\"profile-avatar-wrap\">"+
    (avatar?"<img class=\"profile-avatar\" src=\""+esc(avatar)+"\" alt=\"Profile photo\">":"<div class=\"profile-avatar profile-placeholder\">"+esc((u.name||u.email||"U").charAt(0).toUpperCase())+"</div>")+
    "<label class=\"outline-btn profile-upload\">Change photo<input id=\"profilePhotoInput\" type=\"file\" accept=\"image/*\" hidden></label>"+
    "</div><div class=\"profile-details\"><form id=\"profileForm\">"+
    "<label>Full name<input name=\"full_name\" value=\""+esc(u.name||"")+"\" required maxlength=\"100\"></label>"+
    "<label>Email<input value=\""+esc(u.email||"")+" \" disabled></label>"+
    "<label>Account type<input value=\""+esc(u.role||"Buyer")+" \" disabled></label>"+
    "<button class=\"primary-btn\" type=\"submit\">Save profile</button></form>"+
    "<p class=\"demo-note\">Your profile photo and name are used across your HarvestHome account.</p></div></div>";
}
async function saveProfile(e){
  e.preventDefault();
  if(!sb||!authUser){toast("Please log in again.",true);return}
  const name=String(new FormData(e.target).get("full_name")||"").trim();
  if(name.length<2){toast("Please enter your full name.",true);return}
  try{
    const {error}=await sb.from("profiles").update({full_name:name,updated_at:new Date().toISOString()}).eq("id",authUser.id);
    if(error)throw error;
    await sb.auth.updateUser({data:{full_name:name}});
    await loadProfile();
    render();
    toast("Profile updated successfully.");
  }catch(err){toast(err.message||"Profile could not be updated.",true)}
}

function transactionCutoff(range){const days=range==="7"?7:range==="30"?30:range==="90"?90:0;return days?Date.now()-days*86400000:0}
function filterTransactions(rows,filter){const q=String(filter.search||"").trim().toLowerCase(),cut=transactionCutoff(filter.range);return rows.filter(p=>{const status=String(p.status||"initialized").toLowerCase();if(filter.status!=="all"&&status!==filter.status)return false;if(cut&&new Date(p.created_at||0).getTime()<cut)return false;if(q){const hay=[p.reference,p.service,p.listings?.title,p.profiles?.full_name,p.user_id].map(x=>String(x||"").toLowerCase()).join(" ");if(!hay.includes(q))return false}return true})}
function transactionFilters(filter,prefix){return '<div class="filter-bar transaction-filters"><input id="'+prefix+'TransactionSearch" value="'+esc(filter.search||"")+'" placeholder="Search reference, listing or payer"><select id="'+prefix+'TransactionStatus"><option value="all" '+(filter.status==="all"?"selected":"")+' >All statuses</option><option value="success" '+(filter.status==="success"?"selected":"")+' >Successful</option><option value="initialized" '+(filter.status==="initialized"?"selected":"")+' >Pending</option><option value="failed" '+(filter.status==="failed"?"selected":"")+' >Failed</option><option value="reversed" '+(filter.status==="reversed"?"selected":"")+' >Reversed</option></select><select id="'+prefix+'TransactionRange"><option value="all" '+(filter.range==="all"?"selected":"")+' >All dates</option><option value="7" '+(filter.range==="7"?"selected":"")+' >Last 7 days</option><option value="30" '+(filter.range==="30"?"selected":"")+' >Last 30 days</option><option value="90" '+(filter.range==="90"?"selected":"")+' >Last 90 days</option></select><button class="clear-btn" data-a="'+prefix+'ClearTransactions">Clear filters</button></div>'}
function dashTab(u,favs,mine,enq){
  if(state.dashboardTab==="profile")return profileTab(u);
  if(state.dashboardTab==="chats")return chatTab(u);
  if(state.dashboardTab==="notifications"){
    const ns=notificationFeed(mine);
    let html="<div class=\"panel-heading\"><div><span class=\"eyebrow\">Updates</span><h2>Notifications</h2></div>";
    if(ns.some(n=>!n.is_read))html+="<button class=\"outline-btn\" data-a=\"markAllNotifications\">Mark all as read</button>";
    html+="</div>";
    if(ns.length){
      html+="<div class=\"notification-list\">";
      html+=ns.map(n=>"<button class=\"notification-item "+(n.is_read?"read":"unread")+" \" data-notification=\""+esc(n.id)+"\"><span class=\"notification-icon\">"+(n.type==="listing_review"?"📋":"🔔")+"</span><span><b>"+esc(n.title)+"</b><p>"+esc(n.message)+"</p><small>"+new Date(n.created_at).toLocaleString()+"</small></span></button>").join("");
      html+="</div>";
    }else{html+="<div class=\"empty-state compact\"><div>🔔</div><h3>No notifications</h3><p>You will see listing review and account updates here.</p></div>";}
    return html;
  }
  if(state.dashboardTab==="favourites"){
    const ls=listings().filter(x=>favs.includes(x.id));
    return "<div class=\"panel-heading\"><div><span class=\"eyebrow\">Saved</span><h2>Your favourites</h2></div></div>"+(ls.length?"<div class=\"listing-grid\">"+ls.map(card).join("")+"</div>":"<div class=\"empty-state compact\"><div>♡</div><h3>No favourites yet</h3><p>Save listings from any market.</p></div>");
  }
  if(state.dashboardTab==="rewards"){const r=getReward(u.email);const qualified=Number(r.points)>=100||Number(r.buyers)>=10;const gold=Number(r.points)>=250||Number(r.buyers)>=25;const nextPoints=gold?250:qualified?250:100;const nextBuyers=gold?25:qualified?25:10;return `<div class="panel-heading"><div><span class="eyebrow">Seller rewards</span><h2>Participation & referrals</h2></div><span class="status-pill ${gold?"approved":qualified?"approved":"pending"}">${gold?"Gold level":qualified?"Reward qualified":"Building points"}</span></div><div class="stat-grid"><div class="stat"><span>Total points</span><strong>${r.points}</strong></div><div class="stat"><span>Participation points</span><strong>${r.participation}</strong></div><div class="stat"><span>Recommendation points</span><strong>${r.recommendations}</strong></div><div class="stat"><span>Buyer referral points</span><strong>${r.referralPoints||0}</strong></div><div class="stat"><span>Unique buyers</span><strong>${r.buyers}</strong></div></div><div class="dashboard-callout"><b>How you earn</b><p>Creating a listing earns participation points. An approved listing earns an approval reward. Buyer recommendations and new unique buyers add referral rewards. Duplicate recommendations and repeat buyers do not count twice.</p></div><div class="dashboard-callout"><b>Next milestone</b><p>${gold?"You have reached Gold level. Keep participating to maintain momentum.":"Reach "+nextPoints+" total points or "+nextBuyers+" unique buyers to reach the next reward level."}</p></div>`;}if(state.dashboardTab==="listingPerformance"){
    const rows=state.listingPerformance||[];
    const activity=r=>{const score=Number(r.views||0)+Number(r.conversations||0)*5+Number(r.recommendations||0)*3;return score>=25?"High activity":score>=8?"Active":"Starting"};
    return "<div class=\"panel-heading\"><div><span class=\"eyebrow\">Seller analytics</span><h2>Listing performance</h2></div><span class=\"result-count\">"+rows.length+" listings tracked</span></div>"+
      "<div class=\"dashboard-callout\"><b>See what is attracting buyers</b><p>Each approved listing now has its own activity picture. Views, buyer conversations and recommendations help you understand which listings are getting attention.</p></div>"+
      (rows.length?"<div class=\"table-wrap\"><table><thead><tr><th>Listing</th><th>Status</th><th>Views</th><th>Buyer conversations</th><th>Unique interested buyers</th><th>Recommendations</th><th>Activity</th></tr></thead><tbody>"+rows.map(r=>"<tr><td><b>"+esc(r.title||"HarvestHome listing")+"</b><small>"+esc(r.location||"")+" · "+esc(r.country||"")+"</small></td><td><span class=\"status-pill "+slug(r.status||"pending")+"\">"+esc(r.status||"pending")+"</span></td><td>"+Number(r.views||0)+"</td><td>"+Number(r.conversations||0)+"</td><td>"+Number(r.unique_buyers||0)+"</td><td>"+Number(r.recommendations||0)+"</td><td><b>"+activity(r)+"</b></td></tr>").join("")+"</tbody></table></div>":"<div class=\"empty-state compact\"><div>📊</div><h3>No listing performance yet</h3><p>Create and publish a listing. Once buyers start viewing or contacting it, the activity will appear here.</p></div>");
  }
  if(state.dashboardTab==="listings"){
    return "<div class=\"panel-heading\"><div><span class=\"eyebrow\">Seller workspace</span><h2>My listings</h2></div><button class=\"primary-btn\" data-a=\"newListing\">+ Create listing</button></div>"+(mine.length?"<div class=\"table-wrap\"><table><thead><tr><th>Listing</th><th>Market</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><tbody>"+mine.map(l=>"<tr><td><b>"+esc(l.title)+"</b></td><td>"+esc(l.country)+" · "+esc(l.location)+"</td><td>"+money(l.price,l.currency)+"</td><td><span class=\"status-pill "+slug(l.status||"pending")+"\">"+(l.status==="pending"?"Under review":l.status==="approved"?"Approved":l.status==="rejected"?"Not approved":esc(l.status||""))+"</span></td><td><button class=\"danger-text\" data-del=\""+esc(l.id)+"\">Delete</button></td></tr>").join("")+"</tbody></table></div>":"<div class=\"empty-state compact\"><div>＋</div><h3>No listings yet</h3><button class=\"primary-btn\" data-a=\"newListing\">Create listing</button></div>");
  }
  if(state.dashboardTab==="payments"){
  const allPs=(state.payments||[]).filter(p=>!authUser||String(p.user_id||"")===String(authUser.id)),f=state.transactionFilterSeller,ps=filterTransactions(allPs,f);
  const successful=allPs.filter(p=>p.status==="success").length,pending=allPs.filter(p=>p.status==="initialized").length,failed=allPs.filter(p=>["failed","abandoned","reversed"].includes(String(p.status||"").toLowerCase())).length;
  return '<div class="panel-heading"><div><span class="eyebrow">Billing & transactions</span><h2>Transaction history</h2></div><button class="primary-btn" data-a="pay">Make a payment</button></div>'+
    '<div class="dashboard-callout"><b>Keep your history under control</b><p>Filter by date or status, or search a reference/listing. Clear filters only resets the view; it never deletes payment records.</p></div>'+
    '<div class="stat-grid"><div class="stat"><span>Total transactions</span><strong>'+allPs.length+'</strong></div><div class="stat"><span>Successful</span><strong>'+successful+'</strong></div><div class="stat"><span>Pending</span><strong>'+pending+'</strong></div><div class="stat"><span>Failed / reversed</span><strong>'+failed+'</strong></div></div>'+
    transactionFilters(f,"seller")+
    (ps.length?'<div class="table-wrap"><table><thead><tr><th>Date</th><th>Transaction</th><th>Listing</th><th>Service</th><th>Amount</th><th>Status</th></tr></thead><tbody>'+
      ps.map(p=>'<tr><td>'+(p.created_at?new Date(p.created_at).toLocaleString():"—")+'</td><td><code>'+esc(p.reference||"—")+'</code></td><td><b>'+esc(p.listings?.title||"No listing linked")+'</b></td><td>'+esc(p.service||"Marketplace")+'</td><td>'+money((Number(p.amount)||0)/100,p.currency||"NGN")+'</td><td><span class="status-pill '+slug(p.status||"initialized")+'">'+esc(p.status||"initialized")+'</span></td></tr>').join("")+
    '</tbody></table></div>':'<div class="empty-state compact"><div>🔎</div><h3>No matching transactions</h3><p>Change the filters to see more transactions.</p></div>');
}
  if(state.dashboardTab==="moderation")return adminPanel();
  if(state.dashboardTab==="enquiries")return "<div class=\"panel-heading\"><div><span class=\"eyebrow\">Messages</span><h2>My enquiries</h2></div></div>"+(enq.length?enq.map(e=>"<div class=\"enquiry\"><div><b>"+esc(e.listingTitle)+"</b><p>"+esc(e.message)+"</p></div><small>"+esc(e.date)+"</small></div>").join(""):"<div class=\"empty-state compact\"><div>💬</div><h3>No enquiries yet</h3></div>");
  const p=state.sellerPerformance||{},isSeller=mine.length>0||u.role==="Seller";
  return `<div class="panel-heading"><div><span class="eyebrow">Account overview</span><h2>Your global workspace</h2></div></div><div class="stat-grid"><div class="stat"><span>Favourites</span><strong>${favs.length}</strong></div><div class="stat"><span>My listings</span><strong>${mine.length}</strong></div><div class="stat"><span>Enquiries</span><strong>${enq.length}</strong></div></div>${isSeller?`<div class="panel-heading" style="margin-top:24px"><div><span class="eyebrow">Seller performance</span><h2>Marketplace activity</h2></div></div><div class="stat-grid"><div class="stat"><span>Approved listings</span><strong>${p.approved||0}</strong></div><div class="stat"><span>Under review</span><strong>${p.pending||0}</strong></div><div class="stat"><span>Listing views</span><strong>${p.views||0}</strong></div><div class="stat"><span>Buyer conversations</span><strong>${p.chats||0}</strong></div><div class="stat"><span>Unique buyers</span><strong>${p.uniqueBuyers||0}</strong></div><div class="stat"><span>Recommendations</span><strong>${p.recommendations||0}</strong></div></div><div class="dashboard-callout"><b>Build genuine marketplace activity</b><p>Keep approved listings current, respond to buyer conversations and earn recommendations from real buyers. Your reward progress is based on verified participation.</p><button class="primary-btn" data-tab="listings">Manage listings</button></div>`:""}<div class="dashboard-callout"><b>Ready to sell internationally?</b><p>Create a listing and choose its country, location and currency.</p><button class="primary-btn" data-a="newListing">Create listing</button></div>`;

}
async function getChatConversations(){
  if(!sb||!authUser)return [];
  const {data,error}=await sb.from('conversations').select('*').or(`buyer_id.eq.${authUser.id},seller_id.eq.${authUser.id}`).order('updated_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
function chatTab(u){if(!sb||!authUser)return `<div class="empty-state compact"><div>💬</div><h3>Chat is unavailable</h3><p>Connect your Supabase project to use buyer-seller chat.</p></div>`;setTimeout(loadChatsPanel,0);return `<div class="panel-heading"><div><span class="eyebrow">Buyer ↔ Seller</span><h2>Your chats</h2></div></div><div id="chatListPanel"><div class="empty-state compact"><div>⏳</div><h3>Loading chats…</h3></div></div>`}
async function loadChatsPanel(){const root=$("#chatListPanel");if(!root||!sb||!authUser)return;try{const cs=await getChatConversations();if(!cs.length){root.innerHTML=`<div class="empty-state compact"><div>💬</div><h3>No chats yet</h3><p>Open an approved listing and tap Contact seller to start a private conversation.</p></div>`;return}const ids=cs.map(c=>c.listing_id).filter(Boolean);const {data:ls,error}=await sb.from('listings').select('id,title,location,country,seller_id').in('id',ids);if(error)throw error;const map=Object.fromEntries((ls||[]).map(x=>[x.id,x]));root.innerHTML=`<div class="chat-list">${cs.map(c=>{const l=map[c.listing_id]||{};const other=c.buyer_id===authUser.id?"Seller":"Buyer";return `<button class="chat-row" data-chat="${esc(c.id)}" data-listing="${esc(c.listing_id||"")}"><span class="chat-avatar">💬</span><span><b>${esc(l.title||"HarvestHome listing")}</b><small>${esc(other)} · ${esc(l.location||"")}, ${esc(l.country||"")}</small></span><span class="chat-arrow">→</span></button>`}).join("")}</div>`;$$("[data-chat]",root).forEach(e=>e.onclick=async()=>{const l=listings().find(x=>String(x.id)===String(e.dataset.listing));if(l)await openChat(e.dataset.chat,l)})}catch(e){root.innerHTML=`<div class="empty-state compact"><div>⚠️</div><h3>Chats could not be loaded</h3><p>${esc(e.message||"Please try again.")}</p></div>`}}
async function contact(id){const u=user();if(!u){auth("login");toast("Log in to contact the seller.",true);return}const l=listings().find(x=>String(x.id)===String(id));if(!l){toast("Listing not found.",true);return}if(!sb||!authUser||!l.seller_id){toast("This listing is not connected to a seller account yet.",true);return}if(l.seller_id===authUser.id){toast("You cannot contact yourself about your own listing.",true);return}try{let {data:c,error}=await sb.from('conversations').select('*').eq('listing_id',l.id).eq('buyer_id',authUser.id).eq('seller_id',l.seller_id).maybeSingle();if(error)throw error;if(!c){const r=await sb.from('conversations').insert({listing_id:l.id,buyer_id:authUser.id,seller_id:l.seller_id}).select().single();if(r.error)throw r.error;c=r.data;sb.rpc('record_buyer_referral',{p_seller_id:l.seller_id,p_buyer_id:authUser.id,p_listing_id:l.id}).catch(err=>console.warn('Buyer referral could not be recorded:',err.message))}await syncListingPerformance();openChat(c.id,l)}catch(e){toast(e.message||"Could not start the chat.",true)}}
async function openChat(conversationId,listing){clearInterval(chatTimer);await renderChatModal(conversationId,listing);chatTimer=setInterval(()=>renderChatModal(conversationId,listing,true),5000)}
async function renderChatModal(conversationId,listing,silent=false){if(!sb||!authUser)return;try{const {data:msgs,error}=await sb.from('messages').select('id,sender_id,body,created_at').eq('conversation_id',conversationId).order('created_at',{ascending:true});if(error)throw error;if(!silent)$('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal wide chat-modal"><button class="modal-close" data-chat-close>×</button><span class="eyebrow">Private buyer ↔ seller chat</span><h2>${esc(listing?.title||"HarvestHome listing")}</h2><div id="chatMessages" class="chat-messages"></div><form id="chatForm" class="chat-form"><textarea name="message" rows="2" maxlength="2000" placeholder="Write a message to the seller…" required></textarea><button class="primary-btn">Send message</button></form><small class="demo-note">Messages are stored securely in Supabase and only the buyer and seller can access this conversation.</small></div></div>`;const box=$("#chatMessages");if(!box)return;box.innerHTML=(msgs||[]).map(m=>`<div class="chat-bubble ${m.sender_id===authUser.id?"mine":"theirs"}"><p>${esc(m.body)}</p><small>${new Date(m.created_at).toLocaleString()}</small>${m.sender_id===authUser.id?`<div class="chat-actions"><button type="button" class="chat-action" data-msg-edit="${esc(m.id)}">Edit</button><button type="button" class="chat-action danger" data-msg-delete="${esc(m.id)}">Delete</button></div>`:""}</div>`).join("")||'<div class="chat-empty">Start the conversation with the seller.</div>';box.scrollTop=box.scrollHeight;if(!silent){$$("[data-msg-edit]",box).forEach(btn=>btn.addEventListener("click",()=>editChatMessage(btn.dataset.msgEdit,conversationId,listing)));$$("[data-msg-delete]",box).forEach(btn=>btn.addEventListener("click",()=>deleteChatMessage(btn.dataset.msgDelete,conversationId,listing)));$("[data-chat-close]")?.addEventListener("click",()=>{clearInterval(chatTimer);chatTimer=null;close()});$("#chatForm")?.addEventListener("submit",e=>sendChatMessage(e,conversationId,listing))}}catch(e){if(!silent)toast(e.message||"Could not load chat.",true)}}
async function editChatMessage(messageId,conversationId,listing){if(!sb||!authUser)return;try{const {data:m,error}=await sb.from('messages').select('id,sender_id,body').eq('id',messageId).maybeSingle();if(error)throw error;if(!m||m.sender_id!==authUser.id)throw new Error("You can only edit your own messages.");const next=window.prompt("Edit your message:",m.body);if(next===null)return;const body=String(next).trim();if(!body){toast("Message cannot be empty.",true);return}if(body.length>2000){toast("Message must be 2000 characters or less.",true);return}const {error:updateError}=await sb.from('messages').update({body}).eq('id',messageId).eq('sender_id',authUser.id);if(updateError)throw updateError;await renderChatModal(conversationId,listing,true)}catch(err){toast(err.message||"Message could not be edited.",true)}}
async function deleteChatMessage(messageId,conversationId,listing){if(!sb||!authUser)return;if(!window.confirm("Delete this message? This cannot be undone."))return;try{const {error}=await sb.from('messages').delete().eq('id',messageId).eq('sender_id',authUser.id);if(error)throw error;await renderChatModal(conversationId,listing,true)}catch(err){toast(err.message||"Message could not be deleted.",true)}}
async function sendChatMessage(e,conversationId,listing){
  e.preventDefault();
  const message=String(new FormData(e.target).get('message')||"").trim();
  if(!message||!sb||!authUser)return;
  try{
    const {data:conversation,error:conversationError}=await sb.from('conversations').select('id,buyer_id,seller_id,listing_id').eq('id',conversationId).maybeSingle();
    if(conversationError)throw conversationError;
    if(!conversation)throw new Error("Chat conversation no longer exists.");
    if(conversation.buyer_id!==authUser.id&&conversation.seller_id!==authUser.id)throw new Error("You are not a participant in this chat.");
    const {error}=await sb.from('messages').insert({conversation_id:conversationId,sender_id:authUser.id,body:message});
    if(error)throw error;
    const {error:updateError}=await sb.from('conversations').update({updated_at:new Date().toISOString()}).eq('id',conversationId);
    if(updateError)throw updateError;
    if(conversation.buyer_id===authUser.id&&listing?.id)await sb.from('enquiries').insert({listing_id:listing.id,buyer_id:authUser.id,message});
    if(conversation.buyer_id===authUser.id&&conversation.seller_id){
      await createNotification(conversation.seller_id,'chat_message','New buyer message',`A buyer sent you a new message about "${listing?.title||"your listing"}".`,listing?.id||conversation.listing_id||null);
    }
    e.target.reset();
    await renderChatModal(conversationId,listing,true);
  }catch(err){toast(err.message||"Message could not be sent.",true)}
}
function paymentModal(preselectedListingId=""){
  let u=user();if(!u){auth("login");return}
  const mine=json(KEYS.sellerListings,[]).filter(l=>authUser&&String(l.seller_id)===String(authUser.id)&&l.status!=="deleted");
  const selected=mine.find(l=>String(l.id)===String(preselectedListingId))||mine.find(l=>l.status==="approved")||mine[0];
  const listingOptions=mine.map(l=>'<option value="'+esc(l.id)+'" '+(selected&&String(selected.id)===String(l.id)?"selected":"")+'>'+esc(l.title)+' — '+esc(l.location||l.country||"")+'</option>').join("");
  const listingField='<label>Listing<select name="listing_id" '+(mine.length?"":"disabled")+' required><option value="">Select the listing this payment is for</option>'+listingOptions+'</select></label>';
  const emptyNote=mine.length?"":"<small class=\"demo-note\">Create a listing first. Every seller payment must be linked to a specific listing.</small>";
  $('#modalRoot').innerHTML='<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-close>×</button><span class="eyebrow">Secure payment</span><h2>Pay for a HarvestHome service</h2><p>Payments are processed by Paystack. Your Paystack secret key stays in the Supabase Edge Function.</p><form id="paymentForm"><label>Email<input name="email" type="email" value="'+esc(u.email)+'" required></label><label>Service<select name="service"><option value="featured">Featured listing — ₦2,000</option><option value="verification">Seller verification — ₦5,000</option><option value="pro">Professional seller — ₦10,000</option></select></label>'+listingField+emptyNote+'<button class="primary-btn full">Continue to Paystack</button></form><small class="demo-note">After payment, HarvestHome records the amount, listing and Paystack reference.</small></div></div>';
  $('[data-close]')?.addEventListener('click',close);$('#paymentForm')?.addEventListener('submit',paymentSubmit);
}
async function paymentSubmit(e){
  e.preventDefault();const d=Object.fromEntries(new FormData(e.target));const amounts={featured:200000,verification:500000,pro:1000000};
  if(!sb){toast("Connect Supabase first.",true);return}
  if(!d.listing_id){toast("Select the exact listing this payment is for.",true);return}
  try{
    const {data,error}=await sb.functions.invoke('paystack-initialize',{body:{amount:amounts[d.service],service:d.service,listing_id:d.listing_id||null,currency:'NGN',callback_url:location.origin+'/payment-success.html'}});
    if(error){let detail=error.message||'Payment initialization failed';try{if(error.context?.json)detail=(await error.context.json()).error||detail}catch{}throw new Error(detail)}
    if(!data?.authorization_url)throw new Error(data?.error||'Payment service unavailable');
    location.href=data.authorization_url
  }catch(err){toast(err.message||'Payment setup is not connected yet.',true)}
}
function bind(){
$$("[data-a]").forEach(e=>e.onclick=()=>act(e.dataset.a));$$("[data-terms]").forEach(e=>e.onclick=termsModal);$$("[data-pay-listing]").forEach(e=>e.onclick=()=>paymentModal(e.dataset.payListing));$$("[data-scroll]").forEach(e=>e.onclick=()=>document.getElementById(e.dataset.scroll)?.scrollIntoView({behavior:"smooth"}));
$("#countryTop")?.addEventListener("change",e=>switchCountry(e.target.value));$("#profilePhotoInput")?.addEventListener("change",e=>uploadProfilePhoto(e.target.files[0]));$("#profileForm")?.addEventListener("submit",saveProfile);$("#countryFilter")?.addEventListener("change",e=>switchCountry(e.target.value));$("#locationFilter")?.addEventListener("change",e=>{state.location=e.target.value;render()});$("#categoryFilter")?.addEventListener("change",e=>{state.category=e.target.value;render()});$("#modeFilter")?.addEventListener("change",e=>{state.mode=e.target.value;render()});
$("#searchInput")?.addEventListener("keydown",e=>{if(e.key==="Enter"){state.search=e.target.value;render()}});$$("[data-cat]").forEach(e=>e.onclick=()=>{state.category=e.dataset.cat;render()});$$("[data-view-listing]").forEach(e=>recordListingView(e.dataset.viewListing));$$("[data-country]").forEach(e=>e.onclick=()=>switchCountry(e.dataset.country));$$("[data-fav]").forEach(e=>e.onclick=x=>{x.stopPropagation();fav(e.dataset.fav)});$$("[data-contact]").forEach(e=>e.onclick=()=>contact(e.dataset.contact));$$("[data-recommend]").forEach(e=>e.onclick=()=>recommendSeller(e.dataset.recommend));$$("[data-chat]").forEach(e=>e.onclick=async()=>{const l=listings().find(x=>String(x.id)===String(e.dataset.listing));if(l)await openChat(e.dataset.chat,l)});$$("[data-tab]").forEach(e=>e.onclick=()=>{state.dashboardTab=e.dataset.tab;render()});$$("[data-notification]").forEach(e=>e.onclick=()=>markNotificationRead(e.dataset.notification));$$("[data-del]").forEach(e=>e.onclick=()=>del(e.dataset.del));$$("[data-mod]").forEach(e=>e.onclick=()=>moderate(e.dataset.mod));$$("[data-link-payment]").forEach(e=>e.onclick=()=>linkSuccessfulPayment(e.dataset.linkPayment));$("#sellerTransactionSearch")?.addEventListener("input",e=>{state.transactionFilterSeller.search=e.target.value;render()});$("#sellerTransactionStatus")?.addEventListener("change",e=>{state.transactionFilterSeller.status=e.target.value;render()});$("#sellerTransactionRange")?.addEventListener("change",e=>{state.transactionFilterSeller.range=e.target.value;render()});$("#adminTransactionSearch")?.addEventListener("input",e=>{state.transactionFilterAdmin.search=e.target.value;render()});$("#adminTransactionStatus")?.addEventListener("change",e=>{state.transactionFilterAdmin.status=e.target.value;render()});$("#adminTransactionRange")?.addEventListener("change",e=>{state.transactionFilterAdmin.range=e.target.value;render()})
}
function switchCountry(c){state.country=c;state.location="All locations";state.category="All categories";localStorage.setItem(KEYS.country,c);render()}
async function act(a){if(a==="home"){state.view="marketplace";render();scrollTo(0,0)}if(a==="login")auth("login");if(a==="signup")auth("signup");if(a==="logout"){if(sb) await sb.auth.signOut();localStorage.removeItem(KEYS.session);authUser=null;authProfile=null;state.view="marketplace";render();toast("Logged out.")}if(a==="dashboard"){state.view="dashboard";render()}if(a==="admin"){state.view="dashboard";state.dashboardTab="moderation";render()}if(a==="search"){state.search=$("#searchInput")?.value||"";render()}if(a==="clear"){state.search="";state.location="All locations";state.category="All categories";state.mode="All";render()}if(a==="newListing")listingModal();if(a==="pay")paymentModal();if(a==="markAllNotifications")markAllNotificationsRead();if(a==="sellerClearTransactions"){state.transactionFilterSeller={status:"all",range:"all",search:""};render()}if(a==="adminClearTransactions"){state.transactionFilterAdmin={status:"all",range:"all",search:""};render()}}
function auth(mode){state.authMode=mode;$("#modalRoot").innerHTML=`<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-close>×</button><span class="eyebrow">${mode==="login"?"Account login":"Join HarvestHome"}</span><h2>${mode==="login"?"Welcome back":"Create your account"}</h2><p>Use your HarvestHome account.</p><form id="authForm">${mode==="signup"?`<label>Full name<input name="name" required></label>`:""}<label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="6" required></label>${mode==="signup"?`<label>Account type<select name="role"><option>Buyer</option><option>Seller</option></select></label><label class="terms-check"><input name="terms" type="checkbox" required> I agree to the <button type="button" class="link-btn" data-terms>HarvestHome Terms & Conditions</button>.</label>`:""}<button class="primary-btn full"> ${mode==="login"?"Login":"Create account"} </button></form>${mode==="login"?`<button class="link-btn" id="forgot">Forgot password?</button>`:""}<small class="demo-note">Your account is secured by Supabase Auth.</small></div></div>`;bindModal()}
function bindModal(){$("[data-close]")?.addEventListener("click",close);$("#authForm")?.addEventListener("submit",authSubmit);$("#forgot")?.addEventListener("click",showForgot);$("#listingForm")?.addEventListener("submit",listingSubmit)}
function showForgot(){close();$('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-close>×</button><span class="eyebrow">Account recovery</span><h2>Reset your password</h2><p>Enter your email and Supabase will send a secure password-reset link.</p><form id="forgotForm"><label>Email<input name="email" type="email" required autocomplete="email"></label><button class="primary-btn full">Send reset link</button></form><small class="demo-note">Check your inbox and spam folder. The link returns to HarvestHome.</small></div></div>`;$('[data-close]')?.addEventListener('click',close);$('#forgotForm')?.addEventListener('submit',forgotSubmit)}
async function forgotSubmit(e){e.preventDefault();const email=String(new FormData(e.target).get('email')||'').toLowerCase().trim();if(!sb){toast('Add your Supabase settings in Config.js first.',true);return}try{const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;close();toast('If the account exists, a reset link has been sent.')}catch(err){toast(err.message||'Password reset failed.',true)}}
function showReset(){ $('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-close>×</button><span class="eyebrow">Password reset</span><h2>Create a new password</h2><form id="resetForm"><label>New password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><label>Confirm password<input name="confirm" type="password" minlength="8" required autocomplete="new-password"></label><button class="primary-btn full">Update password</button></form></div></div>`;$('[data-close]')?.addEventListener('click',close);$('#resetForm')?.addEventListener('submit',resetSubmit)}
async function resetSubmit(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));if(d.password!==d.confirm){toast('Passwords do not match.',true);return}try{const {error}=await sb.auth.updateUser({password:d.password});if(error)throw error;close();history.replaceState({},document.title,location.pathname);toast('Password updated successfully. You can now log in.')}catch(err){toast(err.message||'Reset failed.',true)}}
function termsModal(){const email=SUPPORT_EMAIL;$('#modalRoot').innerHTML='<div class="modal-backdrop"><div class="modal wide" style="max-height:88vh;overflow:auto"><button class="modal-close" data-close>×</button><span class="eyebrow">HarvestHome</span><h2>Terms & Conditions</h2><p><b>Last updated:</b> 29 September 2026</p><p>These Terms & Conditions govern your use of HarvestHome, an online marketplace for houses and other property, land, equipment and farm produce. By creating an account, publishing a listing, contacting another user or using a HarvestHome service, you agree to these terms.</p><h3>1. What HarvestHome provides</h3><p>HarvestHome provides an online platform that helps users discover listings, publish offers, communicate with other users and purchase optional marketplace services. HarvestHome is generally a marketplace facilitator, not the owner, seller, landlord, agent or manufacturer of the property, land, equipment or produce listed by users.</p><h3>2. Accounts</h3><p>You must provide accurate information and keep your login details secure. You are responsible for activity carried out through your account. One person must not create or operate fake accounts to manipulate listings, recommendations, rewards, reviews or payments. HarvestHome may suspend or close accounts involved in fraud, abuse, impersonation or other serious violations.</p><h3>3. Seller responsibilities</h3><p>Sellers must provide truthful, current and complete listing information, including title, price, location, category, condition, availability and material restrictions. A seller must have the legal authority and any required permission, licence or approval to offer the property, land, equipment or produce. Sellers must not upload fraudulent, stolen, unlawful, dangerous or misleading content.</p><h3>4. Houses, land and property</h3><p>For property and land, buyers should independently verify ownership, title, survey, boundaries, planning status, permitted use, encumbrances, taxes, physical condition and other relevant records with appropriate authorities and qualified professionals before paying or signing an agreement. A HarvestHome listing, seller profile, verification status or moderator approval is not a guarantee of ownership, title, value, legality or suitability.</p><h3>5. Equipment and farm produce</h3><p>Sellers must accurately describe equipment specifications, condition, defects, quantity and availability. Farm-produce sellers should provide truthful information about type, quantity, freshness, processing, expiry or other material characteristics where applicable. Buyers should inspect goods and confirm suitability before completing a transaction.</p><h3>6. Buyer responsibilities</h3><p>Buyers must use truthful account information, communicate respectfully, carry out appropriate due diligence and keep their own receipts, agreements and payment records. Buyers should not send money to another user merely because a listing appears on HarvestHome. Where HarvestHome provides a specific payment flow, use the disclosed payment process and retain the payment reference.</p><h3>7. Payments and HarvestHome services</h3><p>HarvestHome may offer optional paid services such as featured listings, seller verification and professional seller services. Payment amounts and service descriptions are shown before payment. Payments may be processed by Paystack or another disclosed provider. A payment for a HarvestHome service does not by itself complete a property sale, lease, equipment sale or produce transaction between users. Refunds, cancellations and service-specific conditions are subject to the applicable service terms and applicable law.</p><h3>8. Listing approval and moderation</h3><p>New listings may remain pending until reviewed by an authorised HarvestHome Admin or Moderator. HarvestHome may reject, suspend, hide or remove a listing where it appears inaccurate, unlawful, unsafe, fraudulent, duplicated, prohibited or inconsistent with marketplace standards. Approval is a marketplace moderation decision only; it is not a guarantee that the seller or listing is genuine or legally transferable.</p><h3>9. Photos, videos and listing content</h3><p>You must only upload photos, videos, descriptions, logos and other content that you own or are authorised to use. Content must not infringe copyright, trademarks, privacy, publicity or other rights. You grant HarvestHome permission to host, display and reasonably promote your listing content for operating and marketing the marketplace while your listing is available.</p><h3>10. Recommendations, referrals and rewards</h3><p>HarvestHome may reward legitimate seller participation, buyer recommendations and unique buyer referrals. Reward thresholds, points, tiers, campaigns and available rewards may change. Rewards are not guaranteed cash payments unless a particular campaign expressly says so. Fake accounts, self-referrals, repeated recommendations, automated activity or other attempts to manipulate the programme may result in reversal of points or loss of eligibility.</p><h3>11. Communication and enquiries</h3><p>Users may contact sellers through HarvestHome features. Do not use messaging, enquiries or contact information for harassment, spam, threats, scams or unlawful activity. HarvestHome may investigate reported abuse and may restrict accounts where necessary to protect users or the platform.</p><h3>12. Prohibited conduct</h3><p>You must not use HarvestHome for fraud, impersonation, scams, money laundering, unlawful property transactions, stolen goods, prohibited goods, harassment, threats, spam, malicious code, fake reviews, price manipulation, payment abuse or any activity that violates applicable law.</p><h3>13. Complaints and suspected fraud</h3><p>Report suspected fraud, misleading listings, payment problems, safety concerns or other complaints promptly to <a href="mailto:'+email+'?subject=HarvestHome%20Complaint%20or%20Enquiry">'+email+'</a>. Please include the listing, seller, payment reference or other relevant details where available. We may request supporting information while investigating a complaint.</p><h3>14. Privacy and personal information</h3><p>HarvestHome uses account, listing, payment and communication information to operate the marketplace and provide requested services. Personal information will be handled in accordance with applicable Nigerian data-protection requirements and any privacy notice or policy published by HarvestHome. Users should avoid posting unnecessary sensitive personal information in public listing descriptions.</p><h3>15. Availability and security</h3><p>We aim to keep HarvestHome available and secure, but websites and online services can experience maintenance, outages, network failures or other interruptions. Keep your own copies of important contracts, receipts, title documents and payment records. Never share your password, one-time authentication codes or payment credentials with another user.</p><h3>16. Transactions between users</h3><p>Unless HarvestHome expressly states otherwise for a particular service, the actual sale, lease or supply agreement is between the relevant buyer and seller. Users are responsible for negotiating and completing their transaction lawfully, including inspection, documentation, taxes, delivery, possession and other obligations that apply to them.</p><h3>17. Limitation of marketplace role</h3><p>HarvestHome does not promise that every listing is accurate, available, genuine, profitable, suitable or legally transferable, and users should carry out their own due diligence. Nothing in these terms excludes a legal right or protection that cannot lawfully be excluded.</p><h3>18. Changes and termination</h3><p>HarvestHome may update these terms as features, business practices or legal requirements change. The current version and update date will be published on the platform. HarvestHome may suspend or terminate access where necessary to enforce these terms, protect users or comply with law. Accrued payment obligations and other provisions that reasonably need to continue will survive account closure.</p><h3>19. Applicable law and disputes</h3><p>These terms are intended to operate consistently with applicable Nigerian law. Where a dispute concerns a transaction between users, the parties should first attempt good-faith resolution and may use applicable regulatory, mediation or judicial remedies. Nothing here prevents a person from exercising a legal right that cannot lawfully be waived.</p><h3>20. Contact</h3><p>HarvestHome complaints and enquiries: <a href="mailto:'+email+'?subject=HarvestHome%20Complaint%20or%20Enquiry">'+email+'</a>.</p><div class="dashboard-callout"><b>Important</b><p>These terms are drafted around the current HarvestHome marketplace features. They are general platform terms, not legal advice. Before a full commercial launch, especially for property/land transactions, privacy, consumer protection, payments, refunds and seller verification, have a Nigerian-qualified lawyer review the final terms and any separate Privacy Policy, Refund Policy and Seller Policy.</p></div></div></div>';$("#modalRoot [data-close]")?.addEventListener('click',close);}
function close(){$("#modalRoot").innerHTML=""}
async function authSubmit(e){e.preventDefault();let d=Object.fromEntries(new FormData(e.target));if(state.authMode==="signup"&&!d.terms){toast("Please accept the HarvestHome Terms & Conditions.",true);return}if(!sb){toast("Add your Supabase URL and anon key in Config.js first.",true);return}try{if(state.authMode==="signup"){const {data,error}=await sb.auth.signUp({email:d.email,password:d.password,options:{data:{full_name:d.name,role:d.role}}});if(error)throw error;close();toast(data.session?"Account created and signed in.":"Account created. Check your email to confirm.");if(data.session){await loadAuth();state.view="dashboard";render();}}else{const {data,error}=await sb.auth.signInWithPassword({email:d.email,password:d.password});if(error)throw error;authUser=data.user;await loadProfile();close();state.view="marketplace";render();toast("Welcome back.")}}catch(err){toast(err.message||"Authentication failed.",true)}}
function listingModal(){if(!user()){auth("login");toast("Log in to create a listing.",true);return}$("#modalRoot").innerHTML=`<div class="modal-backdrop"><div class="modal wide"><button class="modal-close" data-close>×</button><span class="eyebrow">Seller workspace</span><h2>Create international listing</h2><form id="listingForm" class="form-grid"><label>Title<input name="title" required></label><label>Country<select name="country">${options(C.SUPPORTED_COUNTRIES.map(x=>x.name),state.country)}</select></label><label>Category<select name="category">${options(C.CATEGORIES.slice(1),"Houses")}</select></label><label>Location<input name="location" placeholder="City / state / area" required></label><label>Currency<select name="currency">${options(C.SUPPORTED_COUNTRIES.map(x=>x.currency),countryInfo().currency)}</select></label><label>Price<input name="price" type="number" min="0" required></label><label>Type<select name="mode"><option>Sale</option><option>Lease</option></select></label><label class="span-2">Description<textarea name="description" rows="4" required></textarea></label><label class="span-2">Photos (up to ${V5.maxImages})<input name="images" type="file" accept="image/*" multiple></label><label class="span-2">Video (1 file, max ${V5.maxVideoMB} MB)<input name="video" type="file" accept="video/*"></label><button class="primary-btn span-2">Publish listing</button></form><small class="demo-note">Your listing is saved securely in Supabase and stays pending until an Admin or Moderator approves it.</small></div></div>`;bindModal()}
function showListingSubmittedConfirmation(title,listingId){
  $("#modalRoot").innerHTML=`<div class="modal-backdrop"><div class="modal">
    <span class="eyebrow">Listing received</span>
    <h2>Your listing has been submitted</h2>
    <p><strong>${esc(title)}</strong> is now <b>Pending moderator approval</b>.</p>
    <div class="dashboard-callout">
      <b>Please wait for approval.</b>
      <p>Your listing has reached the HarvestHome moderation team. It will not appear publicly until an Admin or Moderator approves it.</p>
    </div>
    <p>You can safely log out now. We have also saved a notification in your account.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="outline-btn" id="submittedListings">View My Listing</button>
      <button class="primary-btn" id="submittedLogout">Log out</button>
    </div>
  </div></div>`;
  $("#submittedListings")?.addEventListener("click",()=>{close();state.dashboardTab="listings";state.view="dashboard";render()});
  $("#submittedLogout")?.addEventListener("click",()=>act("logout"));
}

async function listingSubmit(e){e.preventDefault();const fd=new FormData(e.target),d=Object.fromEntries(fd);const images=[...e.target.querySelector('[name=images]').files],video=e.target.querySelector('[name=video]').files[0];if(images.length>C.MAX_IMAGE_FILES){toast('Please select no more than '+C.MAX_IMAGE_FILES+' photos.',true);return}if(video&&video.size>C.MAX_VIDEO_MB*1024*1024){toast('Video must be '+C.MAX_VIDEO_MB+' MB or smaller.',true);return}try{if(!sb||!authUser)throw new Error('Seller listing service is unavailable. Please sign in again.');const payload={seller_id:authUser.id,country:d.country,location:d.location,category:d.category,title:d.title,description:d.description,price:Number(d.price),currency:d.currency,mode:d.mode,status:'pending'};const {data:row,error}=await sb.from('listings').insert(payload).select().single();if(error)throw error;const cached=json(KEYS.sellerListings,[]).filter(x=>String(x.id)!==String(row.id));put(KEYS.sellerListings,[{...row,seller:authUser.user_metadata?.full_name||authUser.email||'HarvestHome Seller',images:[],video:null},...cached]);awardListingParticipation(row.id);close();state.view='dashboard';state.dashboardTab='listings';render();showListingSubmittedConfirmation(d.title,row.id);toast('Listing saved immediately. Media is uploading in the background.');const notificationPromise=createNotification(authUser.id,'listing_review','Listing submitted for review','Your listing "'+d.title+'" has been submitted and is under review. It will appear publicly after a moderator approves it.',row.id);(async()=>{try{let cover_url=null,video_url=null;for(let i=0;i<images.length;i++){const file=images[i],mediaPath=authUser.id+'/'+row.id+'/images/'+Date.now()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const up=await sb.storage.from('listing-media').upload(mediaPath,file,{upsert:false});if(up.error)throw up.error;const pub=sb.storage.from('listing-media').getPublicUrl(mediaPath).data.publicUrl;if(i===0)cover_url=pub;const mr=await sb.from('listing_media').insert({listing_id:row.id,media_type:'image',storage_path:mediaPath});if(mr.error)throw mr.error}if(video){const mediaPath=authUser.id+'/'+row.id+'/video/'+Date.now()+'-'+video.name.replace(/[^a-zA-Z0-9._-]/g,'_');const up=await sb.storage.from('listing-media').upload(mediaPath,video,{upsert:false});if(up.error)throw up.error;video_url=sb.storage.from('listing-media').getPublicUrl(mediaPath).data.publicUrl;const mr=await sb.from('listing_media').insert({listing_id:row.id,media_type:'video',storage_path:mediaPath});if(mr.error)throw mr.error}if(cover_url||video_url){const ur=await sb.from('listings').update({cover_url,video_url}).eq('id',row.id);if(ur.error)throw ur.error}await syncListings();}catch(mediaErr){console.warn('Listing media upload failed:',mediaErr.message)}})();notificationPromise.then(async saved=>{if(saved)await syncNotifications()});return}catch(err){toast(err.message||'The listing could not be saved.',true)}}
async function linkSuccessfulPayment(paymentId){
  const select=document.querySelector('[data-link-select="'+paymentId+'"]');
  const listingId=select?.value||'';
  if(!listingId){toast('Select the exact listing this successful payment is for.',true);return}
  try{
    const {data,error}=await sb.rpc('link_successful_payment_to_listing',{p_payment_id:paymentId,p_listing_id:listingId});
    if(error)throw error;
    if(!data?.linked)throw new Error(data?.reason||'Payment could not be linked.');
    toast('Successful payment linked to the selected listing. You can now approve it.');
    await syncPayments();
    render();
  }catch(e){toast(e.message||'Payment could not be linked.',true)}
}
async function moderate(cmd){
 const [action,id]=cmd.split(':');
 const clicked=document.querySelector('[data-mod="'+cmd+'"]');
 if(clicked){clicked.disabled=true;clicked.textContent=action==='approve'?'Checking…':action==='reject'?'Rejecting…':'Deleting…';clicked.style.opacity='0.65';}
 if(action==='approve')toast('Checking payment for this listing…');
 if(sb&&authUser){
  try{
   const {data:listing,error:fetchError}=await sb.from('listings').select('id,title,seller_id,status').eq('id',id).maybeSingle();
   if(fetchError)throw fetchError;
   if(!listing)throw new Error('Listing not found.');

   if(action==='approve'){
    const {data:result,error:approvalError}=await sb.rpc('approve_paid_listing',{p_listing_id:id});
    if(approvalError)throw approvalError;
    if(!result?.approved){
      toast('Approval blocked: no successful payment is linked to this exact listing.',true);
      await createNotification(authUser.id,'payment_required','Payment required before approval',`Listing "${listing.title}" cannot be approved because no successful payment is linked to this exact listing.`,listing.id);
      render();
      return;
    }
   }else if(action==='delete'){
    const {error}=await sb.from('listings').update({status:'deleted'}).eq('id',id);
    if(error)throw error;
    await createNotification(listing.seller_id,'listing_review','Listing removed',`Your listing "${listing.title}" was removed by a moderator.`,listing.id);
   }else{
    const status='rejected';
    const {data:updatedListing,error}=await sb.from('listings').update({status}).eq('id',id).select('id,status').maybeSingle();
    if(error)throw error;
    if(!updatedListing||updatedListing.status!==status)throw new Error('The listing status could not be updated in Supabase. Please check the moderator permissions for listings.');
    await createNotification(listing.seller_id,'listing_review','Listing not approved',`Your listing "${listing.title}" was not approved. Please review the listing details and submit an updated listing if needed.`,listing.id);
   }

   const status=action==='approve'?'approved':action==='reject'?'rejected':'deleted';
   const cachedListings=json(KEYS.sellerListings,[]);
   const cachedListing=cachedListings.find(x=>String(x.id)===String(id));
   if(cachedListing){cachedListing.status=status;cachedListing.updated_at=new Date().toISOString();put(KEYS.sellerListings,cachedListings);}
   if(action==='approve'){
    toast('Listing approved immediately.');
    try{await sb.rpc('award_listing_approval_reward',{p_listing_id:id})}catch(e){console.warn('Approval reward could not be recorded:',e.message)}
    await createNotification(listing.seller_id,'listing_review','Listing approved',`Your listing "${listing.title}" has been approved and is now visible on HarvestHome.`,listing.id);
   }
   await syncListings();await syncAdminRewards();
   toast(action==='delete'?'Listing removed.':`Listing ${action==='approve'?'approved':'rejected'} and seller notified.`);
   render();
   return;
  }catch(e){toast(e.message||'Moderation action failed.',true);return}
 }
 let ls=json(KEYS.sellerListings,[]);
 if(action==='delete'){
  ls=ls.filter(x=>x.id!==id);
  toast('Listing removed.');
 }else{
  let l=ls.find(x=>x.id===id);
  if(!l)return;
  l.status=action==='approve'?'approved':'rejected';
  toast(`Listing ${l.status}.`);
 }
 put(KEYS.sellerListings,ls);
 render()
}
async function del(id){
  if(sb&&authUser){
    try{
      const {error}=await sb.from('listings').delete().eq('id',id);
      if(error)throw error;
      await syncListings();
      render();
      toast("Listing deleted.");
      return;
    }catch(err){toast(err.message||"Listing could not be deleted.",true);return}
  }
  put(KEYS.sellerListings,json(KEYS.sellerListings,[]).filter(x=>x.id!==id));
  render();
  toast("Listing deleted.")
}
if(sb){sb.auth.onAuthStateChange(async (event,session)=>{authUser=session?.user||null; if(authUser){await loadProfile();await syncListings();await syncFavourites();await syncNotifications();await syncRewards();await syncSellerPerformance();await syncListingPerformance();await syncAdminRewards();} else {authProfile=null;state.rewardAdmin=[];state.sellerPerformance={listings:0,approved:0,pending:0,rejected:0,views:0,chats:0,uniqueBuyers:0,recommendations:0};state.listingPerformance=[];} render(); if(event==='PASSWORD_RECOVERY') setTimeout(showReset,0);}); loadAuth();}else{render();}

})();
// HarvestHome responsive publish/moderation patch marker
