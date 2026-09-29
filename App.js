(() => {
"use strict";
const C = window.HARVESTHOME_CONFIG || { APP_NAME:"HarvestHome", VERSION:"V8", SUPPORTED_COUNTRIES:[{name:"Nigeria",code:"NG",currency:"NGN",symbol:"₦"}], CATEGORIES:["All categories","Houses","Land","Equipment","Farm Produce"], MODES:["All","Sale","Lease"], LOCATIONS:{Nigeria:["All locations"]}, DEFAULT_COUNTRY:"Nigeria", DEFAULT_CURRENCY:"NGN", MAX_IMAGE_FILES:6, MAX_VIDEO_MB:25 };
const sb = (window.supabase && C.SUPABASE_URL && C.SUPABASE_ANON_KEY && C.SUPABASE_URL.startsWith("http")) ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
let authUser = null, authProfile = null;
const KEYS = {users:"hh_v4_users",session:"hh_v4_session",favourites:"hh_v4_favourites",enquiries:"hh_v4_enquiries",sellerListings:"hh_v4_seller_listings",country:"hh_v4_country",currency:"hh_v4_currency",reset:"hh_v6_reset_tokens",payments:"hh_v6_payments",notifications:"hh_v8_notifications",notificationReads:"hh_v8_notification_reads",rewards:"hh_v9_rewards",recommendations:"hh_v9_recommendations"};
const DEMO_ADMIN={email:"admin@harvesthome.app",name:"HarvestHome Admin",password:"Admin123!",role:"Admin"};
const V5 = {maxImages:6,maxVideoMB:25};
const mapURL=l=>`https://www.openstreetmap.org/search?query=${encodeURIComponent(`${l.location||""}, ${l.country||""}`)}`;
const readFiles=files=>Promise.all([...files].map(file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({name:file.name,type:file.type,data:r.result});r.onerror=reject;r.readAsDataURL(file)})));

const seed = [];

const state={view:"marketplace",search:"",country:localStorage.getItem(KEYS.country)||C.DEFAULT_COUNTRY,location:"All locations",category:"All categories",mode:"All",dashboardTab:"overview",authMode:"login",payments:[]};
let chatTimer=null;
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
    const remote=(data||[]).filter(l=>l&&l.seller_id&&l.status!=="deleted").map(l=>({...l,id:l.id,ownerEmail:authUser?.id===l.seller_id?(authUser.email||''):undefined,seller:l.profiles?.full_name||l.seller_name||'HarvestHome Seller',sellerVerified:!!l.profiles?.verified,images:l.cover_url?[{data:l.cover_url}]:[],video:l.video_url?{data:l.video_url}:null,views:l.views||0}));
    const cached=json(KEYS.sellerListings,[]);
    const remoteIds=new Set(remote.map(x=>String(x.id)));
    const mineCached=cached.filter(x=>x&&x.seller_id===authUser?.id&&!remoteIds.has(String(x.id))&&x.status!=="deleted");
    put(KEYS.sellerListings,[...remote,...mineCached]);
  }catch(e){console.warn('Supabase listings sync failed',e.message)}
}

function rewardDefaults(){return {points:0,participation:0,recommendations:0,buyers:0}}
function localReward(email,field,points=0){
  if(!email)return;
  const all=json(KEYS.rewards,{});
  const r={...rewardDefaults(),...(all[email]||{})};
  r[field]=(Number(r[field])||0)+Number(points||0);
  r.points=(Number(r.participation)||0)+(Number(r.recommendations)||0)+(Number(r.buyers)||0);
  all[email]=r;put(KEYS.rewards,all);
}
function getReward(email){return {...rewardDefaults(),...(json(KEYS.rewards,{})[email]||{})}}
async function syncRewards(){
  if(!sb||!authUser)return;
  try{
    const {data,error}=await sb.from("seller_rewards").select("*").eq("user_id",authUser.id).maybeSingle();
    if(!error&&data){
      const all=json(KEYS.rewards,{});
      all[authUser.email]={points:data.points||0,participation:data.participation_points||0,recommendations:data.recommendation_points||0,buyers:data.buyer_count||0};
      put(KEYS.rewards,all);
    }
  }catch(e){console.warn("Rewards sync failed",e.message)}
}
async function awardParticipation(points,reason){
  const u=user();if(!u)return;
  if(sb&&authUser){
    const {error}=await sb.rpc("award_participation_points",{p_user_id:authUser.id,p_points:Number(points),p_reason:reason||"participation"});
    if(!error){localReward(u.email,"participation",points);await syncRewards();return}
  }
  localReward(u.email,"participation",points);
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
    }else{
      const all=json(KEYS.recommendations,[]);
      const key=`${u.email}:${l.seller_id}:${l.id}`;
      if(all.some(x=>x.key===key)){toast("You already recommended this seller.",true);return}
      all.push({key,buyerEmail:u.email,seller_id:l.seller_id,listing_id:l.id,date:new Date().toISOString()});
      put(KEYS.recommendations,all);
    }
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
async function loadAuth(){if(!sb){render();return}const {data}=await sb.auth.getSession();authUser=data.session?.user||null;await loadProfile();await syncListings();await syncFavourites();await syncNotifications();await syncPayments();await syncRewards();render();}
async function syncPayments(){
  if(!sb||!authUser)return;
  try{
    const {data,error}=await sb.from("payments").select("*, listings(title, seller_id), profiles:user_id(full_name)").order("created_at",{ascending:false}).limit(100);
    if(error)throw error;
    state.payments=data||[];
  }catch(e){console.warn("Supabase payments sync failed",e.message)}
}
function header(){let u=user();return `<header class="site-header"><div class="container nav-wrap"><button class="brand" data-a="home"><span class="brand-mark">🌿</span><span><strong>HarvestHome</strong><small>International marketplace</small></span></button><nav class="desktop-nav"><button data-a="home">Marketplace</button><button data-scroll="categories">Categories</button><button data-scroll="how">How it works</button></nav><div class="nav-actions"><select id="countryTop" aria-label="Country">${options(C.SUPPORTED_COUNTRIES.map(x=>x.name),state.country)}</select>${u?`<button class="ghost-btn account-btn" data-a="dashboard">${u.avatar_url?`<img class="nav-avatar" src="${esc(u.avatar_url)}" alt="">`:``}My account</button>${(u.role==="Admin"||u.role==="Moderator")?`<button class="ghost-btn" data-a="admin">Moderation</button>`:""}<button class="primary-btn small" data-a="logout">Logout</button>`:`<button class="ghost-btn" data-a="login">Login</button><button class="primary-btn small" data-a="signup">Join</button>`}</div></div></header>`}
function marketplace(){let ls=filtered();return `${header()}<section class="hero"><div class="container hero-grid"><div class="hero-copy"><span class="eyebrow">🌍 Global marketplace</span><h1>Buy, sell & lease <span>what matters.</span></h1><p>Discover houses, land, equipment and farm produce across markets around the world.</p><div class="hero-search"><input id="searchInput" value="${esc(state.search)}" placeholder="Search property, land, tractors, produce..."><button class="primary-btn" data-a="search">Search</button></div><div class="quick-stats"><span><b>${C.SUPPORTED_COUNTRIES.length}</b> launch markets</span><span><b>7+</b> categories</span><span><b>1</b> global platform</span></div></div><div class="hero-card"><div class="hero-card-icon">🌎</div><h3>One marketplace. Many markets.</h3><p>Start in Nigeria and discover opportunities across international markets.</p><button class="outline-btn" data-scroll="categories">Browse categories →</button></div></div></section>
<section class="filters-section"><div class="container filter-bar"><select id="countryFilter">${options(C.SUPPORTED_COUNTRIES.map(x=>x.name),state.country)}</select><select id="locationFilter">${options(C.LOCATIONS[state.country]||["All locations"],state.location)}</select><select id="categoryFilter">${options(C.CATEGORIES,state.category)}</select><select id="modeFilter">${options(C.MODES,state.mode)}</select><button class="clear-btn" data-a="clear">Clear</button></div></section>
<section class="section" id="categories"><div class="container"><div class="section-heading"><div><span class="eyebrow">Explore</span><h2>Browse categories</h2></div><span class="result-count">${ls.length} results in ${esc(state.country)}</span></div><div class="category-grid">${cat("🏠","Houses","Homes, apartments & property","Houses")}${cat("🌍","Land","Residential & agricultural land","Land")}${cat("🚜","Equipment","Tractors, machinery & tools","Equipment")}${cat("🌾","Farm Produce","Crops & fresh produce","Farm Produce")}</div></div></section>
<section class="section listings-section"><div class="container"><div class="section-heading"><div><span class="eyebrow">Marketplace</span><h2>Featured listings</h2></div><span class="result-count">${ls.length} available</span></div><div class="listing-grid">${ls.map(card).join("")||empty()}</div></div></section>
<section class="country-strip"><div class="container"><span class="eyebrow">Explore markets</span><h2>HarvestHome around the world</h2><div class="country-grid">${C.SUPPORTED_COUNTRIES.map(x=>`<button data-country="${esc(x.name)}"><b>${flag(x.code)}</b><span>${esc(x.name)}</span><small>${esc(x.currency)} · ${esc(x.symbol)}</small></button>`).join("")}</div></div></section>
<section class="trust-section" id="how"><div class="container trust-grid"><div><span class="eyebrow">Built to scale</span><h2>One trusted marketplace for local and international opportunities.</h2><p>HarvestHome keeps the same simple experience while making countries, currencies and locations part of the marketplace from the start.</p></div><div class="trust-items"><div><span>✓</span><b>Multi-country search</b><small>Switch markets without leaving HarvestHome.</small></div><div><span>✓</span><b>Multi-currency listings</b><small>Display prices in the currency of each market.</small></div><div><span>✓</span><b>Local account tools</b><small>Buyers and sellers can manage activity from one account.</small></div></div></div></section>${footer()}`}
function cat(i,t,d,v){return `<button class="category-card" data-cat="${esc(v)}"><span>${i}</span><div><h3>${t}</h3><p>${d}</p></div><b>→</b></button>`}
function flag(c){return ({NG:"🇳🇬",GH:"🇬🇭",KE:"🇰🇪",ZA:"🇿🇦",GB:"🇬🇧",US:"🇺🇸",CA:"🇨🇦",AE:"🇦🇪"}[c]||"🌍")}
function filtered(){let q=state.search.toLowerCase().trim();return listings().filter(l=>(l.status||"approved")==="approved"&&(l.country||"Nigeria")===state.country&&(!q||`${l.title} ${l.category} ${l.location} ${l.description} ${l.seller}`.toLowerCase().includes(q))&&(state.location==="All locations"||l.location===state.location)&&(state.category==="All categories"||l.category===state.category)&&(state.mode==="All"||l.mode===state.mode))}
function card(l){let u=user(),f=json(KEYS.favourites,{}),fav=u&&(f[u.email]||[]).includes(l.id);let img=l.images&&l.images[0]&&l.images[0].data;return `<article class="listing-card"><div class="listing-image ${slug(l.category)}">${img?`<img src="${img}" alt="${esc(l.title)}">`:`<span>${l.emoji||"📦"}</span>`}<button class="heart ${fav?"active":""}" data-fav="${l.id}">${fav?"♥":"♡"}</button><span class="mode-pill">${esc(l.mode)}</span></div><div class="listing-body"><span class="listing-category">${esc(l.category)}</span><h3>${esc(l.title)}</h3><p class="location">📍 \${esc(l.location)} · \${esc(l.country)}</p><p class="seller-line">👤 \${esc(l.seller||'HarvestHome Seller')}\${l.sellerVerified?' · ✓ Verified seller':''}</p><p class="description">\${esc(l.description)}</p><div class="listing-bottom"><strong>${money(l.price,l.currency||countryInfo().currency)}</strong><span>${l.views||0} views</span></div><div class="listing-actions"><button class="outline-btn full" data-contact="${l.id}">Contact seller</button><button class="ghost-btn full" data-recommend="${l.id}">⭐ Recommend seller</button><div class="media-links"><a target="_blank" rel="noopener" href="${mapURL(l)}">📍 Map</a>${l.video?`<span>🎥 Video</span>`:""}</div></div></div></article>`}
function empty(){return `<div class="empty-state"><div>🔎</div><h3>No matching listings</h3><p>Try another market, location or search.</p><button class="primary-btn" data-a="clear">Clear filters</button></div>`}
function footer(){return `<footer><div class="container footer-grid"><div><div class="footer-brand">🌿 HarvestHome</div><p>The international marketplace for property, equipment and farm produce.</p></div><div><b>Markets</b>${C.SUPPORTED_COUNTRIES.slice(0,4).map(x=>`<button data-country="${esc(x.name)}">${flag(x.code)} ${esc(x.name)}</button>`).join("")}</div><div><b>Account</b><button data-a="login">Login</button><button data-a="signup">Create account</button></div></div><div class="container footer-bottom">© ${new Date().getFullYear()} HarvestHome · International marketplace</div></footer>`}

function adminPanel(){
  if(!user()||!['Admin','Moderator'].includes(user().role))return `<div class="empty-state"><h3>Access denied</h3></div>`;
  let ls=json(KEYS.sellerListings,[]);
  const ps=state.payments||[];
  return `<div class="panel-heading"><div><span class="eyebrow">Admin workspace</span><h2>Moderation & Payments</h2></div><span class="result-count">${ls.length} seller listings · ${ps.length} payments</span></div>
  <div class="panel-heading"><div><span class="eyebrow">Listing moderation</span><h3>Seller listings</h3></div></div>
  <div class="table-wrap"><table><thead><tr><th>Listing</th><th>Seller</th><th>Status</th><th>Action</th></tr></thead><tbody>${ls.length?ls.map(l=>`<tr><td><b>${esc(l.title)}</b><small>${esc(l.country)} · ${esc(l.location)}</small></td><td>${esc(l.seller||l.ownerEmail||'')}</td><td><span class="status-pill ${slug(l.status||'approved')}">${esc(l.status||'approved')}</span></td><td><button class="ghost-btn" data-mod="approve:${esc(l.id)}">Approve</button> <button class="ghost-btn" data-mod="reject:${esc(l.id)}">Reject</button> <button class="danger-text" data-mod="delete:${esc(l.id)}">Delete</button></td></tr>`).join(''):`<tr><td colspan="4">No seller listings to moderate.</td></tr>`}</tbody></table></div>
  <div class="panel-heading"><div><span class="eyebrow">Payment monitoring</span><h3>Recent payments</h3></div></div>
  <div class="table-wrap"><table><thead><tr><th>Payer</th><th>Listing / Service</th><th>Amount</th><th>Status</th><th>Reference</th><th>Date</th></tr></thead><tbody>${ps.length?ps.map(p=>`<tr><td><b>${esc(p.profiles?.full_name||p.user_id||'Customer')}</b></td><td><b>${esc(p.listings?.title||'No listing linked')}</b><small>${esc(p.service||'Marketplace')}</small></td><td>${money((Number(p.amount)||0)/100,p.currency||'NGN')}</td><td><span class="status-pill ${slug(p.status||'initialized')}">${esc(p.status||'initialized')}</span></td><td><code>${esc(p.reference||'—')}</code></td><td>${p.created_at?new Date(p.created_at).toLocaleString():'—'}</td></tr>`).join(''):`<tr><td colspan="6">No payments recorded yet.</td></tr>`}</tbody></table></div>
  <div class="dashboard-callout"><b>Payment records</b><p>Moderators can see who paid, which listing or service was paid for, the amount, status and Paystack reference.</p></div>`;
}
function dashboard(){let u=user();if(!u){state.view="marketplace";return marketplace()}let favs=json(KEYS.favourites,{})[u.email]||[], mine=json(KEYS.sellerListings,[]).filter(x=>authUser&&String(x.seller_id)===String(authUser.id)), enq=json(KEYS.enquiries,[]).filter(x=>x.buyerEmail===u.email), notifications=authUser?notificationFeed(mine):[], unread=notifications.filter(n=>!n.is_read).length;return `${header()}<section class="dashboard-hero"><div class="container"><button class="back-btn" data-a="home">← Marketplace</button><span class="eyebrow">My account</span><h1>Welcome, ${esc(u.name.split(" ")[0])}.</h1><p>Manage your favourites, enquiries and seller listings across your selected market.</p></div></section><section class="dashboard-section"><div class="container dashboard-layout"><aside class="dashboard-nav"><button class="${state.dashboardTab==="overview"?"active":""}" data-tab="overview">Overview</button><button class="${state.dashboardTab==="profile"?"active":""}" data-tab="profile">Profile</button><button class="${state.dashboardTab==="favourites"?"active":""}" data-tab="favourites">Favourites (${favs.length})</button><button class="${state.dashboardTab==="listings"?"active":""}" data-tab="listings">My listings (${mine.length})</button><button class="${state.dashboardTab==="rewards"?"active":""}" data-tab="rewards">🏆 Rewards</button><button class="${state.dashboardTab==="notifications"?"active":""}" data-tab="notifications">🔔 Notifications${unread?` (${unread})`:``}</button><button class="${state.dashboardTab==="enquiries"?"active":""}" data-tab="enquiries">Enquiries (${enq.length})</button><button class="${state.dashboardTab==="chats"?"active":""}" data-tab="chats">💬 Chats</button>${(u.role==="Admin"||u.role==="Moderator")?`<button class="${state.dashboardTab==="moderation"?"active":""}" data-tab="moderation">Moderation</button>`:""}<button class="${state.dashboardTab==="payments"?"active":""}" data-tab="payments">Payments</button><button data-a="logout">Logout</button></aside><div class="dashboard-content">${dashTab(u,favs,mine,enq)}</div></div></section>${footer()}`}
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
  if(state.dashboardTab==="rewards"){const r=getReward(u.email);return `<div class="panel-heading"><div><span class="eyebrow">Seller rewards</span><h2>Participation & recommendations</h2></div></div><div class="stat-grid"><div class="stat"><span>Total points</span><strong>${r.points}</strong></div><div class="stat"><span>Participation points</span><strong>${r.participation}</strong></div><div class="stat"><span>Recommendation points</span><strong>${r.recommendations}</strong></div><div class="stat"><span>Buyer referrals</span><strong>${r.buyers}</strong></div></div><div class="dashboard-callout"><b>How rewards work</b><p>Publish listings and stay active to earn participation points. Buyers who recommend your listings add recommendation points, and new buyers brought to your listings add buyer-referral points.</p></div>`;}if(state.dashboardTab==="listings"){
    return "<div class=\"panel-heading\"><div><span class=\"eyebrow\">Seller workspace</span><h2>My listings</h2></div><button class=\"primary-btn\" data-a=\"newListing\">+ Create listing</button></div>"+(mine.length?"<div class=\"table-wrap\"><table><thead><tr><th>Listing</th><th>Market</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><tbody>"+mine.map(l=>"<tr><td><b>"+esc(l.title)+"</b></td><td>"+esc(l.country)+" · "+esc(l.location)+"</td><td>"+money(l.price,l.currency)+"</td><td><span class=\"status-pill "+slug(l.status||"pending")+"\">"+(l.status==="pending"?"Under review":l.status==="approved"?"Approved":l.status==="rejected"?"Not approved":esc(l.status||""))+"</span></td><td><button class=\"danger-text\" data-del=\""+esc(l.id)+"\">Delete</button></td></tr>").join("")+"</tbody></table></div>":"<div class=\"empty-state compact\"><div>＋</div><h3>No listings yet</h3><button class=\"primary-btn\" data-a=\"newListing\">Create listing</button></div>");
  }
  if(state.dashboardTab==="payments"){
  const ps=state.payments||[];
  return "<div class=\"panel-heading\"><div><span class=\"eyebrow\">Billing</span><h2>Payments</h2></div><button class=\"primary-btn\" data-a=\"pay\">Make a payment</button></div>"+
    "<div class=\"dashboard-callout\"><b>Paystack payment history</b><p>Every successful payment is recorded with its listing, amount, status and transaction reference.</p></div>"+
    (ps.length?"<div class=\"table-wrap\"><table><thead><tr><th>Service / Listing</th><th>Amount</th><th>Status</th><th>Reference</th><th>Date</th></tr></thead><tbody>"+
      ps.map(p=>"<tr><td><b>"+esc(p.service||"Marketplace")+"</b><small>"+esc(p.listings?.title||"No listing linked")+"</small></td><td>"+money((Number(p.amount)||0)/100,p.currency||"NGN")+"</td><td><span class=\"status-pill "+slug(p.status||"initialized")+"\">"+esc(p.status||"initialized")+"</span></td><td><code>"+esc(p.reference||"—")+"</code></td><td>"+new Date(p.created_at).toLocaleString()+"</td></tr>").join("")+
    "</tbody></table></div>":"<div class=\"empty-state compact\"><div>₦</div><h3>No payments yet</h3><p>Your Paystack transactions will appear here with their references.</p></div>");
}
  if(state.dashboardTab==="moderation")return adminPanel();
  if(state.dashboardTab==="enquiries")return "<div class=\"panel-heading\"><div><span class=\"eyebrow\">Messages</span><h2>My enquiries</h2></div></div>"+(enq.length?enq.map(e=>"<div class=\"enquiry\"><div><b>"+esc(e.listingTitle)+"</b><p>"+esc(e.message)+"</p></div><small>"+esc(e.date)+"</small></div>").join(""):"<div class=\"empty-state compact\"><div>💬</div><h3>No enquiries yet</h3></div>");
  return "<div class=\"panel-heading\"><div><span class=\"eyebrow\">Account overview</span><h2>Your global workspace</h2></div></div><div class=\"stat-grid\"><div class=\"stat\"><span>Favourites</span><strong>"+favs.length+"</strong></div><div class=\"stat\"><span>My listings</span><strong>"+mine.length+"</strong></div><div class=\"stat\"><span>Enquiries</span><strong>"+enq.length+"</strong></div></div><div class=\"dashboard-callout\"><b>Ready to sell internationally?</b><p>Create a listing and choose its country, location and currency.</p><button class=\"primary-btn\" data-a=\"newListing\">Create listing</button></div>";
}
async function getChatConversations(){
  if(!sb||!authUser)return [];
  const {data,error}=await sb.from('conversations').select('*').or(`buyer_id.eq.${authUser.id},seller_id.eq.${authUser.id}`).order('updated_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
function chatTab(u){if(!sb||!authUser)return `<div class="empty-state compact"><div>💬</div><h3>Chat is unavailable</h3><p>Connect your Supabase project to use buyer-seller chat.</p></div>`;setTimeout(loadChatsPanel,0);return `<div class="panel-heading"><div><span class="eyebrow">Buyer ↔ Seller</span><h2>Your chats</h2></div></div><div id="chatListPanel"><div class="empty-state compact"><div>⏳</div><h3>Loading chats…</h3></div></div>`}
async function loadChatsPanel(){const root=$("#chatListPanel");if(!root||!sb||!authUser)return;try{const cs=await getChatConversations();if(!cs.length){root.innerHTML=`<div class="empty-state compact"><div>💬</div><h3>No chats yet</h3><p>Open an approved listing and tap Contact seller to start a private conversation.</p></div>`;return}const ids=cs.map(c=>c.listing_id).filter(Boolean);const {data:ls,error}=await sb.from('listings').select('id,title,location,country,seller_id').in('id',ids);if(error)throw error;const map=Object.fromEntries((ls||[]).map(x=>[x.id,x]));root.innerHTML=`<div class="chat-list">${cs.map(c=>{const l=map[c.listing_id]||{};const other=c.buyer_id===authUser.id?"Seller":"Buyer";return `<button class="chat-row" data-chat="${esc(c.id)}" data-listing="${esc(c.listing_id||"")}"><span class="chat-avatar">💬</span><span><b>${esc(l.title||"HarvestHome listing")}</b><small>${esc(other)} · ${esc(l.location||"")}, ${esc(l.country||"")}</small></span><span class="chat-arrow">→</span></button>`}).join("")}</div>`;$$("[data-chat]",root).forEach(e=>e.onclick=async()=>{const l=listings().find(x=>String(x.id)===String(e.dataset.listing));if(l)await openChat(e.dataset.chat,l)})}catch(e){root.innerHTML=`<div class="empty-state compact"><div>⚠️</div><h3>Chats could not be loaded</h3><p>${esc(e.message||"Please try again.")}</p></div>`}}
async function contact(id){const u=user();if(!u){auth("login");toast("Log in to contact the seller.",true);return}const l=listings().find(x=>String(x.id)===String(id));if(!l){toast("Listing not found.",true);return}if(!sb||!authUser||!l.seller_id){toast("This listing is not connected to a seller account yet.",true);return}if(l.seller_id===authUser.id){toast("You cannot contact yourself about your own listing.",true);return}try{let {data:c,error}=await sb.from('conversations').select('*').eq('listing_id',l.id).eq('buyer_id',authUser.id).eq('seller_id',l.seller_id).maybeSingle();if(error)throw error;if(!c){const r=await sb.from('conversations').insert({listing_id:l.id,buyer_id:authUser.id,seller_id:l.seller_id}).select().single();if(r.error)throw r.error;c=r.data}openChat(c.id,l)}catch(e){toast(e.message||"Could not start the chat.",true)}}
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
  const listingOptions=mine.map(l=>`<option value="${esc(l.id)}" ${selected&&String(selected.id)===String(l.id)?"selected":""}>${esc(l.title)} — ${esc(l.location||l.country||"")}</option>`).join("");
  $('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-close>×</button><span class="eyebrow">Secure payment</span><h2>Pay for a HarvestHome service</h2><p>Payments are processed by Paystack. Your Paystack secret key stays in the Supabase Edge Function.</p><form id="paymentForm"><label>Email<input name="email" type="email" value="${esc(u.email)}" required></label><label>Service<select name="service"><option value="featured">Featured listing — ₦2,000</option><option value="verification">Seller verification — ₦5,000</option><option value="pro">Professional seller — ₦10,000</option></select></label><label>Listing<select name="listing_id" ${mine.length?"":"disabled"}><option value="">No listing selected</option>${listingOptions}</select></label>${mine.length?"":"<small class=\"demo-note\">Create a listing first if you want a payment linked to a specific listing.</small>"}<button class="primary-btn full">Continue to Paystack</button></form><small class="demo-note">After payment, HarvestHome records the amount, listing and Paystack reference.</small></div></div>`;
  $('[data-close]')?.addEventListener('click',close);$('#paymentForm')?.addEventListener('submit',paymentSubmit);
}
async function paymentSubmit(e){
  e.preventDefault();const d=Object.fromEntries(new FormData(e.target));const amounts={featured:200000,verification:500000,pro:1000000};
  if(!sb){toast("Connect Supabase first.",true);return}
  if(d.service==="featured"&&!d.listing_id){toast("Select the listing you are paying to feature.",true);return}
  try{
    const {data,error}=await sb.functions.invoke('paystack-initialize',{body:{amount:amounts[d.service],service:d.service,listing_id:d.listing_id||null,currency:'NGN',callback_url:location.origin+'/payment-success.html'}});
    if(error){let detail=error.message||'Payment initialization failed';try{if(error.context?.json)detail=(await error.context.json()).error||detail}catch{}throw new Error(detail)}
    if(!data?.authorization_url)throw new Error(data?.error||'Payment service unavailable');
    location.href=data.authorization_url
  }catch(err){toast(err.message||'Payment setup is not connected yet.',true)}
}
function bind(){
document.querySelectorAll("[data-a]").forEach(e=>e.onclick=()=>act(e.dataset.a));document.querySelectorAll("[data-pay-listing]").forEach(e=>e.onclick=()=>paymentModal(e.dataset.payListing));$$("[data-scroll]").forEach(e=>e.onclick=()=>document.getElementById(e.dataset.scroll)?.scrollIntoView({behavior:"smooth"}));
$("#countryTop")?.addEventListener("change",e=>switchCountry(e.target.value));$("#profilePhotoInput")?.addEventListener("change",e=>uploadProfilePhoto(e.target.files[0]));$("#profileForm")?.addEventListener("submit",saveProfile);$("#countryFilter")?.addEventListener("change",e=>switchCountry(e.target.value));$("#locationFilter")?.addEventListener("change",e=>{state.location=e.target.value;render()});$("#categoryFilter")?.addEventListener("change",e=>{state.category=e.target.value;render()});$("#modeFilter")?.addEventListener("change",e=>{state.mode=e.target.value;render()});
$("#searchInput")?.addEventListener("keydown",e=>{if(e.key==="Enter"){state.search=e.target.value;render()}});$$("[data-cat]").forEach(e=>e.onclick=()=>{state.category=e.dataset.cat;render()});$$("[data-country]").forEach(e=>e.onclick=()=>switchCountry(e.dataset.country));$$("[data-fav]").forEach(e=>e.onclick=x=>{x.stopPropagation();fav(e.dataset.fav)});$$("[data-contact]").forEach(e=>e.onclick=()=>contact(e.dataset.contact));$$("[data-recommend]").forEach(e=>e.onclick=()=>recommendSeller(e.dataset.recommend));$$("[data-chat]").forEach(e=>e.onclick=async()=>{const l=listings().find(x=>String(x.id)===String(e.dataset.listing));if(l)await openChat(e.dataset.chat,l)});$$("[data-tab]").forEach(e=>e.onclick=()=>{state.dashboardTab=e.dataset.tab;render()});$$("[data-notification]").forEach(e=>e.onclick=()=>markNotificationRead(e.dataset.notification));$$("[data-del]").forEach(e=>e.onclick=()=>del(e.dataset.del));$$("[data-mod]").forEach(e=>e.onclick=()=>moderate(e.dataset.mod))
}
function switchCountry(c){state.country=c;state.location="All locations";state.category="All categories";localStorage.setItem(KEYS.country,c);render()}
async function act(a){if(a==="home"){state.view="marketplace";render();scrollTo(0,0)}if(a==="login")auth("login");if(a==="signup")auth("signup");if(a==="logout"){if(sb) await sb.auth.signOut();localStorage.removeItem(KEYS.session);authUser=null;authProfile=null;state.view="marketplace";render();toast("Logged out.")}if(a==="dashboard"){state.view="dashboard";render()}if(a==="admin"){state.view="dashboard";state.dashboardTab="moderation";render()}if(a==="search"){state.search=$("#searchInput")?.value||"";render()}if(a==="clear"){state.search="";state.location="All locations";state.category="All categories";state.mode="All";render()}if(a==="newListing")listingModal();if(a==="pay")paymentModal();if(a==="markAllNotifications")markAllNotificationsRead()}
function auth(mode){state.authMode=mode;$("#modalRoot").innerHTML=`<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-close>×</button><span class="eyebrow">${mode==="login"?"Account login":"Join HarvestHome"}</span><h2>${mode==="login"?"Welcome back":"Create your account"}</h2><p>Use your HarvestHome account.</p><form id="authForm">${mode==="signup"?`<label>Full name<input name="name" required></label>`:""}<label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="6" required></label>${mode==="signup"?`<label>Account type<select name="role"><option>Buyer</option><option>Seller</option></select></label>`:""}<button class="primary-btn full"> ${mode==="login"?"Login":"Create account"} </button></form>${mode==="login"?`<button class="link-btn" id="forgot">Forgot password?</button>`:""}<small class="demo-note">Your account is secured by Supabase Auth.</small></div></div>`;bindModal()}
function bindModal(){$("[data-close]")?.addEventListener("click",close);$("#authForm")?.addEventListener("submit",authSubmit);$("#forgot")?.addEventListener("click",showForgot);$("#listingForm")?.addEventListener("submit",listingSubmit)}
function showForgot(){close();$('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-close>×</button><span class="eyebrow">Account recovery</span><h2>Reset your password</h2><p>Enter your email and Supabase will send a secure password-reset link.</p><form id="forgotForm"><label>Email<input name="email" type="email" required autocomplete="email"></label><button class="primary-btn full">Send reset link</button></form><small class="demo-note">Check your inbox and spam folder. The link returns to HarvestHome.</small></div></div>`;$('[data-close]')?.addEventListener('click',close);$('#forgotForm')?.addEventListener('submit',forgotSubmit)}
async function forgotSubmit(e){e.preventDefault();const email=String(new FormData(e.target).get('email')||'').toLowerCase().trim();if(!sb){toast('Add your Supabase settings in Config.js first.',true);return}try{const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;close();toast('If the account exists, a reset link has been sent.')}catch(err){toast(err.message||'Password reset failed.',true)}}
function showReset(){ $('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-close>×</button><span class="eyebrow">Password reset</span><h2>Create a new password</h2><form id="resetForm"><label>New password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><label>Confirm password<input name="confirm" type="password" minlength="8" required autocomplete="new-password"></label><button class="primary-btn full">Update password</button></form></div></div>`;$('[data-close]')?.addEventListener('click',close);$('#resetForm')?.addEventListener('submit',resetSubmit)}
async function resetSubmit(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));if(d.password!==d.confirm){toast('Passwords do not match.',true);return}try{const {error}=await sb.auth.updateUser({password:d.password});if(error)throw error;close();history.replaceState({},document.title,location.pathname);toast('Password updated successfully. You can now log in.')}catch(err){toast(err.message||'Reset failed.',true)}}
function close(){$("#modalRoot").innerHTML=""}
async function authSubmit(e){e.preventDefault();let d=Object.fromEntries(new FormData(e.target));if(!sb){toast("Add your Supabase URL and anon key in Config.js first.",true);return}try{if(state.authMode==="signup"){const {data,error}=await sb.auth.signUp({email:d.email,password:d.password,options:{data:{full_name:d.name,role:d.role}}});if(error)throw error;close();toast(data.session?"Account created and signed in.":"Account created. Check your email to confirm.");if(data.session){await loadAuth();state.view="dashboard";render();}}else{const {data,error}=await sb.auth.signInWithPassword({email:d.email,password:d.password});if(error)throw error;authUser=data.user;await loadProfile();close();state.view="marketplace";render();toast("Welcome back.")}}catch(err){toast(err.message||"Authentication failed.",true)}}
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

async function listingSubmit(e){e.preventDefault();const fd=new FormData(e.target),d=Object.fromEntries(fd);const images=[...e.target.querySelector('[name=images]').files],video=e.target.querySelector('[name=video]').files[0];if(images.length>C.MAX_IMAGE_FILES){toast(`Please select no more than ${C.MAX_IMAGE_FILES} photos.`,true);return}if(video&&video.size>C.MAX_VIDEO_MB*1024*1024){toast(`Video must be ${C.MAX_VIDEO_MB} MB or smaller.`,true);return}try{if(sb&&authUser){const payload={seller_id:authUser.id,country:d.country,location:d.location,category:d.category,title:d.title,description:d.description,price:Number(d.price),currency:d.currency,mode:d.mode,status:'pending'};const {data:row,error}=await sb.from('listings').insert(payload).select().single();if(error)throw error;let cover_url=null,video_url=null;for(let i=0;i<images.length;i++){const file=images[i],path=`${authUser.id}/${row.id}/images/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const up=await sb.storage.from('listing-media').upload(path,file,{upsert:false});if(up.error)throw up.error;const pub=sb.storage.from('listing-media').getPublicUrl(path).data.publicUrl;if(i===0)cover_url=pub;await sb.from('listing_media').insert({listing_id:row.id,media_type:'image',storage_path:path});}if(video){const path=`${authUser.id}/${row.id}/video/${Date.now()}-${video.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const up=await sb.storage.from('listing-media').upload(path,video,{upsert:false});if(up.error)throw up.error;video_url=sb.storage.from('listing-media').getPublicUrl(path).data.publicUrl;await sb.from('listing_media').insert({listing_id:row.id,media_type:'video',storage_path:path});}if(cover_url||video_url)await sb.from('listings').update({cover_url,video_url}).eq('id',row.id);const notificationPromise=createNotification(authUser.id,'listing_review','Listing submitted for review',`Your listing "${d.title}" has been submitted and is under review. It will appear publicly after a moderator approves it.`,row.id);await syncListings();close();state.view='dashboard';state.dashboardTab='listings';render();showListingSubmittedConfirmation(d.title,row.id);toast('Listing submitted. Your notification is already in your Notifications.');notificationPromise.then(async saved=>{if(saved)await syncNotifications();});return}if(!sb||!authUser){throw new Error("Seller listing service is unavailable. Please sign in again.")}throw new Error("Your seller listing could not be saved. Please try again.")}catch(err){toast(err.message||'The listing could not be saved.',true)}}
async function moderate(cmd){
 const [action,id]=cmd.split(':');
 if(sb&&authUser){
  try{
   const {data:listing,error:fetchError}=await sb.from('listings').select('id,title,seller_id,status').eq('id',id).maybeSingle();
   if(fetchError)throw fetchError;if(!listing)throw new Error('Listing not found.');
   if(action==='delete'){
    const {error}=await sb.from('listings').update({status:'deleted'}).eq('id',id);if(error)throw error;
    await createNotification(listing.seller_id,'listing_review','Listing removed',`Your listing "${listing.title}" was removed by a moderator.`,listing.id);
   }else{
    const status=action==='approve'?'approved':'rejected';
    const {error}=await sb.from('listings').update({status}).eq('id',id);if(error)throw error;
    if(status==='approved')await createNotification(listing.seller_id,'listing_review','Listing approved',`Your listing "${listing.title}" has been approved and is now visible on HarvestHome.`,listing.id);
    else await createNotification(listing.seller_id,'listing_review','Listing not approved',`Your listing "${listing.title}" was not approved. Please review the listing details and submit an updated listing if needed.`,listing.id);
   }
   await syncListings();toast(action==='delete'?'Listing removed.':`Listing ${action==='approve'?'approved':'rejected'} and seller notified.`);render();return;
  }catch(e){toast(e.message||'Moderation action failed.',true);return}
 }
 let ls=json(KEYS.sellerListings,[]);
 if(action==='delete'){ls=ls.filter(x=>x.id!==id);toast('Listing removed.')}else{let l=ls.find(x=>x.id===id);if(!l)return;l.status=action==='approve'?'approved':'rejected';toast(`Listing ${l.status}.`)}
 put(KEYS.sellerListings,ls);render()
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
if(sb){sb.auth.onAuthStateChange(async (event,session)=>{authUser=session?.user||null; if(authUser){await loadProfile();await syncListings();await syncFavourites();await syncNotifications();await syncRewards();} else authProfile=null; render(); if(event==='PASSWORD_RECOVERY') setTimeout(showReset,0);}); loadAuth();}else{render();}

})();