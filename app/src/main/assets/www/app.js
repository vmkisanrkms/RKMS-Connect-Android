
const C=window.RKMS_CONFIG||{};
const SUPA=C.SUPABASE_URL||"";
const ANON=C.SUPABASE_ANON_KEY||"";
const API=SUPA+"/rest/v1";
const AUTH=SUPA+"/auth/v1";
const STORE=SUPA+"/storage/v1";
const AUTH_STORE=localStorage;
// Native Android session is the durable backup for WebView storage. Copy it
// synchronously before any auth/route code runs so notification launches do
// not briefly render the login screen and then lose the session.
(function restoreNativeSessionEarly(){
 try{
   if(window.RKMSNative){
     const na=String(window.RKMSNative.getAccessToken?.()||"");
     const nr=String(window.RKMSNative.getRefreshToken?.()||"");
     if(na){
       AUTH_STORE.setItem("rkms_access_token",na);
       if(nr) AUTH_STORE.setItem("rkms_refresh_token",nr);
       if(!AUTH_STORE.getItem("rkms_access_expires_at")) AUTH_STORE.removeItem("rkms_access_expires_at");
     }
   }
 }catch(e){ console.warn("RKMS native session bootstrap failed",e); }
})();
const state={user:null,member:null,officer:null,role:null,tempAccess:false,org:null,bookPage:Number(localStorage.getItem("rkms_book_page")||1),bookTotal:60,dir:[],posts:[],permissions:[],approvedMemberCache:null,approvedMemberCacheAt:0,chatPeople:[],chatPeopleError:"",activeChatThreadId:null,chatThreads:[],chatFilter:"all",chatSearch:""};
// Expose the single live state object to the chat module and other legacy modules.
// Without this, RKMSAllUsersChat.actor() sees an empty role even after a valid login.
window.state=state;

function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function val(id){return document.getElementById(id)?.value?.trim()||""}
function toast(msg){let x=document.querySelector(".toast");if(!x){x=document.createElement("div");x.className="toast";document.body.appendChild(x)}x.textContent=msg;clearTimeout(x._t);x._t=setTimeout(()=>x.remove(),3500)}
function token(){return AUTH_STORE.getItem("rkms_access_token")||""}
function authHeaders(extra={}){return {apikey:ANON,Authorization:"Bearer "+(token()||ANON),"Content-Type":"application/json",...extra}}
async function request(url,opts={}){const r=await fetch(url,opts);const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}if(!r.ok)throw new Error(d?.message||d?.msg||t||("HTTP "+r.status));return d}
async function rpc(name,body={}){return request(`${SUPA}/rest/v1/rpc/${name}`,{method:"POST",headers:authHeaders(),body:JSON.stringify(body)})}
function dataOf(x){return x?.data??x?.result??x}
function arrOf(x,key){
 const d=dataOf(x);
 if(key && Array.isArray(d?.[key])) return d[key];
 if(Array.isArray(d)) return d;
 for(const k of ["data","rows","items","news","events","gallery","documents","reports","campaigns","notifications","officers","leadership","posts","permissions","members","states","mandals","districts","tehsils","blocks","villages"]){
   if(Array.isArray(d?.[k])) return d[k];
 }
 return [];
}
function normMobile(v){let d=String(v||"").replace(/\D/g,"");if(d.startsWith("91")&&d.length===12)d=d.slice(2);return d.slice(-10)}
function phone91(v){const d=normMobile(v);return d.length===10?"+91"+d:""}
async function loadActiveFlash(){
  try{
    const r=await rpc("rkms_get_active_flash");
    const d=dataOf(r);
    if(Array.isArray(d)) return d[0]||null;
    if(Array.isArray(d?.flash)) return d.flash[0]||null;
    if(d?.id) return d;
    return null;
  }catch{return null}
}
async function setupOpening(){
 const splash=document.querySelector("#splash");if(!splash)return;
 const flashes=await loadActiveFlashes(),active=flashes[0]||await loadActiveFlash();
 const content=splash.querySelector(".splash-content"),mark=splash.querySelector(".splash-mark");
 if(active){
  mark.style.opacity=".06";
  content.innerHTML=`${active.image_url?`<img class="splash-flash-image" src="${esc(active.image_url)}" alt="">`:``}<h1>${esc(active.title||"")}</h1>${active.body?`<p>${esc(active.body)}</p>`:""}`;
  splash.classList.add("has-flash");
 }else splash.classList.remove("has-flash");
 setTimeout(()=>splash.classList.add("hide"),2000);
}
async function loadActiveFlashes(){
 try{
  const r=await rpc("rkms_get_flash_messages",{p_limit:60});
  const rows=arrOf(r),now=Date.now();
  return rows.filter(x=>x&&x.image_url&&x.published!==false&&(!x.start_at||now>=new Date(x.start_at).getTime())&&(!x.end_at||now<=new Date(x.end_at).getTime())).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
 }catch{return []}
}
function route(){
 const r=location.hash.replace(/^#/,"")||"home";
 return r.startsWith("chat/")?"chat":r;
}
function chatRouteConversationId(){
 const raw=location.hash.replace(/^#/,"");
 return raw.startsWith("chat/")?decodeURIComponent(raw.slice(5)):"";
}
function readScreenStack(){
  try{return JSON.parse(sessionStorage.getItem("rkms_screen_stack")||"[]")}catch{return []}
}
function writeScreenStack(stack){
  if(stack.length>40) stack.splice(0,stack.length-40);
  sessionStorage.setItem("rkms_screen_stack",JSON.stringify(stack));
}
function currentHistoryIndex(){return Number(history.state?.rkmsIndex??0)||0}
function syncScreenStack(){
  // Compatibility/debug mirror only. Browser history is the single source of truth.
  const r=route();
  writeScreenStack([r]);
}
function go(r,replace=false){
  const next=String(r||"home");
  const current=route();
  if(current===next){ render(); return; }
  const idx=currentHistoryIndex();
  if(replace){
    history.replaceState({rkmsRoute:next,rkmsIndex:idx,rkmsApp:true,rkmsAuthenticated:!!token()},"","#"+next);
  }else{
    history.pushState({rkmsRoute:next,rkmsIndex:idx+1,rkmsApp:true,rkmsAuthenticated:!!token()},"","#"+next);
  }
  writeScreenStack([next]);
  render();
}
function completeLogin(routeName){
  const next=String(routeName||"home");
  // Login must be replaced, never left underneath the authenticated screen.
  // This also prevents a second/third Back from returning to the login form.
  const idx=currentHistoryIndex();
  history.replaceState({rkmsRoute:next,rkmsIndex:idx,rkmsApp:true,rkmsAuthenticated:true},"","#"+next);
  writeScreenStack([next]);
  document.dispatchEvent(new CustomEvent("rkms:login-success",{detail:{route:"#"+next}}));
  render();
}

function screenHead(title,sub=""){return `<div class="screen-head"><div><span class="eyebrow">RKMS CONNECT</span><h1 class="screen-title">${esc(title)}</h1>${sub?`<p class="lead">${esc(sub)}</p>`:""}</div><button class="btn ghost" data-back="1">← वापस</button></div>`}
function cardEmpty(text){return `<div class="empty">${esc(text)}</div>`}
function normalizeMediaUrl(url){
 if(!url)return "";
 let s=String(url).trim();
 if(/^https?:\/\//i.test(s)){
   // Keep existing signed/public URLs intact, but encode accidental spaces in object paths.
   try{const u=new URL(s);u.pathname=u.pathname.split("/").map((x,i)=>i<3?x:encodeURIComponent(decodeURIComponent(x))).join("/");return u.toString();}catch{return s.replace(/ /g,"%20");}
 }
 s=s.replace(/^\/+/,"");
 return `${SUPA}/storage/v1/object/public/rkms-media/${s.split("/").map(encodeURIComponent).join("/")}`;
}
function mediaVersion(url,version=""){
 const u=normalizeMediaUrl(url);
 if(!u)return "";
 if(!version)return u;
 return u+(u.includes("?")?"&":"?")+"v="+encodeURIComponent(version);
}
function imageTag(url,alt="",cls="",version=""){
 const src=mediaVersion(url,version);
 if(!src)return "";
 return `<img src="${esc(src)}" alt="${esc(alt)}" class="${esc(cls)}" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="this.dataset.failed='1';this.style.visibility='hidden';">`;
}
function imgOrAvatar(url,name=""){
 const src=mediaVersion(url);
 return src?`<img class="avatar" src="${esc(src)}" alt="${esc(name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src+(this.src.includes('?')?'&':'?')+'v='+Date.now();}else{this.onerror=null;this.src='assets/rkms-logo-transparent.png';this.classList.add('photo-fallback');}">`:`<div class="avatar" aria-label="${esc(name)}"></div>`;
}
const RKMS_HARMANJEET_SIGNATURE="https://kzczivaydandiqgnzfeg.supabase.co/storage/v1/object/public/rkms-media/Untitled%20folder/Harmanjeet_Singh_Digital_Signature.png";
const RKMS_HARMANJEET_NAME="Harmanjeet Singh";
const RKMS_HARMANJEET_POST="जिला अध्यक्ष IT Cell";

async function loadOrg(){
  try{const r=await rpc("rkms_get_organization");state.org=dataOf(r)||{}}
  catch{state.org={organization_name:"राष्ट्रीय किसान मजदूर संगठन",tagline:"जय किसान - जय नौजवान"}}
  return state.org;
}
async function loadLeaders(){
  try{return arrOf(await rpc("rkms_get_leadership",{p_level:null,p_state:null,p_limit:30}))}catch{return []}
}
async function loadPublic(kind,body){
  try{return arrOf(await rpc(kind,body||{}),kind.replace("rkms_get_",""))}catch{return []}
}
async function publicOfficers(){
  try{return arrOf(await rpc("rkms_get_active_officers"),"officers")}catch{return []}
}

async function renderHome(){
 const o=state.org||{},flashes=await loadActiveFlashes(),active=flashes[0]||await loadActiveFlash();
 const heroVisual=active?`<div class="hero-logo hero-flash" id="homeFlashRotator" data-flash-count="${flashes.length}"><img src="${esc(active.image_url||"assets/rkms-logo-transparent.png")}" alt="${esc(active.title||"Flash")}" class="home-flash-image">${active.title?`<div class="home-flash-title">${esc(active.title)}</div>`:""}</div>`:`<div class="hero-logo"><img src="assets/rkms-logo-transparent.png" alt="RKMS"></div>`;
 const vmCard=`<article class="card vm-leader-card"><img src="assets/vm-singh.jpg" alt="श्री V. M. Singh"><div><span class="eyebrow">राष्ट्रीय नेतृत्व</span><h2>श्री V. M. Singh</h2><h3>राष्ट्रीय अध्यक्ष</h3><p>राष्ट्रीय किसान मजदूर संगठन के राष्ट्रीय अध्यक्ष एवं किसानों की आवाज़ के प्रमुख नेतृत्वकर्ता।</p><button class="btn" data-route="leadership">पूरा नेतृत्व देखें</button></div></article>`;
 return `<section class="screen"><div class="hero"><div><span class="eyebrow">राष्ट्रीय किसान मजदूर संगठन</span><h1>किसानों की आवाज़,<br>संगठन की ताकत</h1><p class="lead">${esc(o.description||"")}</p><div class="actions"><button class="btn" data-route="membership">सदस्य बनें</button><button class="btn ghost" data-login-menu>सदस्य/पदाधिकारी लॉगिन</button></div></div>${heroVisual}</div>${vmCard}
 <div class="quick-grid"><button class="quick" data-route="directory"><strong>पदाधिकारी खोजें</strong><span>जिला-वार संख्या, नाम, फोटो और संपर्क</span></button><button class="quick" data-route="book"><strong>📖 एक जिंदगी किसानों के नाम</strong><span>पुस्तक पढ़ें और जहाँ छोड़ा था वहीं से जारी रखें</span></button><button class="quick" data-route="events"><strong>कार्यक्रम</strong><span>संगठन के आगामी कार्यक्रम देखें</span></button><button class="quick" data-route="news"><strong>समाचार / Flash</strong><span>नई संगठन सूचनाएँ देखें</span></button><button class="quick" data-route="gallery"><strong>फोटो/मीडिया गैलरी</strong><span>कार्यक्रमों की तस्वीरें और वीडियो</span></button><button class="quick" data-route="documents"><strong>प्रकाशित दस्तावेज</strong><span>मोबाइल से दस्तावेज पढ़ें</span></button><button class="quick" data-route="reports"><strong>रिपोर्ट</strong><span>संगठन की प्रकाशित रिपोर्ट</span></button><button class="quick" data-route="notifications"><strong>📢 सूचना केंद्र</strong><span>राष्ट्रीय, प्रदेश और अपने अधिकार क्षेत्र की आधिकारिक सूचनाएँ</span></button><button class="quick" data-route="organization"><strong>संगठन</strong><span>परिचय, दृष्टि, मिशन और संपर्क</span></button></div>
 <div class="section-block"><div class="card"><h2>📢 सूचना केंद्र</h2><div id="homeNotifications" class="grid"><div class="note">सूचनाएँ लोड हो रही हैं…</div></div><div class="actions"><button class="btn ghost" data-route="notifications">सभी सूचनाएँ देखें</button></div></div></div>
 <div class="section-block"><div class="book-tile"><img src="assets/book/cover.jpg" alt="एक जिंदगी किसानों के नाम" loading="lazy"><h3>एक जिंदगी किसानों के नाम</h3><p>V. M. Singh</p><div class="actions" style="justify-content:center"><button class="btn" data-route="book">पुस्तक पढ़ें</button></div></div></div></section>`;
}
async function renderOrganization(){
 const o=await loadOrg();
 const blocks=[];
 if(o.description)blocks.push(`<div class="card"><h2>परिचय</h2><p class="lead">${esc(o.description)}</p></div>`);
 if(o.vision)blocks.push(`<div class="card"><h2>दृष्टि</h2><p class="lead">${esc(o.vision)}</p></div>`);
 if(o.mission)blocks.push(`<div class="card"><h2>मिशन</h2><p class="lead">${esc(o.mission)}</p></div>`);
 const contact=(o.official_phone||o.official_email||o.office_address)?`<div class="card"><h2>संपर्क</h2>${o.office_address?`<p>📍 ${esc(o.office_address)}</p>`:""}${o.official_phone?`<p>📞 <a href="tel:${esc(phone91(o.official_phone)||o.official_phone)}">${esc(o.official_phone)}</a></p>`:""}${o.official_email?`<p>✉️ <a href="mailto:${esc(o.official_email)}">${esc(o.official_email)}</a></p>`:""}</div>`:"";
 return `<section class="screen">${screenHead(o.organization_name||"संगठन",o.tagline||"")}<div class="grid">${blocks.join("")}${contact}</div>${!blocks.length&&!contact?cardEmpty("संगठन की अतिरिक्त जानकारी अभी उपलब्ध नहीं है।"):''}</section>`;
}

async function renderLeadership(){
 let rows=await loadLeaders();
 const v=rows.find(x=>String(x.name||"").toLowerCase().includes("v. m. singh"))||{};
 const vphoto="assets/vm-singh.jpg";
 const vcard=`<article class="card profile watermark-card">
   <img src="${vphoto}" alt="V. M. Singh">
   <div><span class="eyebrow">राष्ट्रीय नेतृत्व</span><h2>${esc(v.name||"श्री V. M. Singh")}</h2>
   <h3>${esc(v.post_name||"राष्ट्रीय अध्यक्ष")}</h3><p class="lead">${esc(v.introduction||"राष्ट्रीय किसान मजदूर संगठन के राष्ट्रीय अध्यक्ष")}</p>
   <div class="contact-row">
     <a href="tel:+919582445605">📞 संपर्क</a><a href="mailto:vmsingh@vmsingh.com">✉️ ईमेल</a>
     <a target="_blank" rel="noopener" href="https://www.instagram.com/sardarvmsingh/">Instagram</a>
     <a target="_blank" rel="noopener" href="https://www.facebook.com/share/1bi5ovFbqo/">Facebook</a><a target="_blank" rel="noopener" href="https://x.com/SardarVm">X</a><a target="_blank" rel="noopener" href="https://www.facebook.com/share/1GqtKeC1V8/">IT Cell Account</a>
   </div>
   <div class="actions"><button class="btn" data-route="vmsingh">पूरा प्रोफाइल</button></div></div>
 </article>`;
 const vmAddress="W-127 Greater Kailash 2, Delhi, India, 110048";
 const vmAddressUrl=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(vmAddress)}`;
 // V. M. Singh जी का पूरा profile और सभी account links ऊपर जस के तस रहें।
 // "अन्य नेतृत्व" section में केवल address रखा जाए; कोई अन्य नेता/card/message नहीं।
 const addressCard=`<div class="section-block vm-address-only"><h2>पता</h2><a class="card" href="${vmAddressUrl}" target="_blank" rel="noopener" aria-label="V. M. Singh जी का पता Google Maps में खोलें" style="display:block;text-decoration:none;color:inherit;cursor:pointer"><div style="display:flex;align-items:center;gap:14px"><span style="font-size:30px">📍</span><div><strong style="font-size:20px;line-height:1.45">${esc(vmAddress)}</strong></div><span style="margin-left:auto;font-size:30px;color:#087f4f">›</span></div></a></div>`;
 return `<section class="screen">${screenHead("नेतृत्व","संगठन का राष्ट्रीय और सक्रिय नेतृत्व")}${vcard}${addressCard}</section>`;
}

async function renderVMS(){return `<section class="screen">${screenHead("V. M. Singh जी","राष्ट्रीय किसान मजदूर संगठन") }<article class="card profile"><img src="assets/vm-singh.jpg" alt="V. M. Singh"><div><span class="eyebrow">राष्ट्रीय अध्यक्ष</span><h2>श्री V. M. Singh</h2><p class="lead">राष्ट्रीय किसान मजदूर संगठन के राष्ट्रीय अध्यक्ष</p><div class="contact-row"><a href="tel:+919582445605">📞 +91 95824 45605</a><a href="mailto:vmsingh@vmsingh.com">✉️ vmsingh@vmsingh.com</a><a target="_blank" rel="noopener" href="https://www.instagram.com/sardarvmsingh/">Instagram</a><a target="_blank" rel="noopener" href="https://www.facebook.com/share/1bi5ovFbqo/">Facebook</a><a target="_blank" rel="noopener" href="https://x.com/SardarVm">X</a><a target="_blank" rel="noopener" href="https://www.facebook.com/share/1GqtKeC1V8/">IT Cell Account</a></div></div></article></section>`}

async function renderDirectory(){
 const rows=await publicOfficers();state.dir=rows;
 const map={};rows.forEach(x=>{const d=x.district||"जिला निर्दिष्ट नहीं";(map[d]??=[]).push(x)});
 const districts=Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0],"hi")).map(([d,list])=>`<button class="card district-card" data-district="${esc(d)}"><div class="count-card"><h3>${esc(d)}</h3><b>${list.length}</b></div><p>सक्रिय पदाधिकारी</p></button>`).join("");
 const all=rkmsSortPdaOfficers(rows).map(officerCard).join("");
 return `<section class="screen">${screenHead("पदाधिकारी खोजें","हर जिले में सक्रिय पदाधिकारियों की संख्या और संपर्क") }
 ${(state.role==="officer"||state.role==="super_admin")?`<div class="card area-report-card"><h2>📊 क्षेत्रवार संगठन सूची</h2><p class="note">State → Mandal → District → Tehsil → Block → Village चुनकर अलग-अलग सदस्य और पदाधिकारी सूची देखें।</p><div class="form-grid"><label class="field">State<select id="areaState"></select></label><label class="field">Mandal<select id="areaMandal" disabled></select></label><label class="field">District<select id="areaDistrict" disabled></select></label><label class="field">Tehsil<select id="areaTehsil" disabled></select></label><label class="field">Block<select id="areaBlock" disabled></select></label><label class="field">Village<select id="areaVillage" disabled></select></label></div><div id="areaLists" class="grid" style="margin-top:16px"><div class="note">पहले क्षेत्र चुनें।</div></div></div>`:""}
 <div class="search"><input id="dirQ" placeholder="नाम, मोबाइल, पद या जिला"><button class="btn" id="dirSearch">खोजें</button></div>
 <div class="section-block"><h2>जिला-वार सूची</h2><div id="districtGrid" class="grid">${districts||cardEmpty("अभी कोई सक्रिय पदाधिकारी उपलब्ध नहीं है।")}</div></div>
 <div class="section-block"><h2>सभी सक्रिय पदाधिकारी</h2><div id="officerGrid" class="grid">${all||cardEmpty("अभी कोई सक्रिय पदाधिकारी उपलब्ध नहीं है।")}</div></div>
 </section>`;
}
function officerCard(x){
 const phone=phone91(x.mobile)||x.mobile||"";
 return `<article class="card officer-card"><div style="display:flex;gap:13px;align-items:center">${imgOrAvatar(x.photo_url,x.name)}<div><h3>${esc(x.name||"")}</h3><b>${esc(x.post_name||"")}</b></div></div>
 <p>${esc([x.state,x.mandal,x.district,x.tehsil,x.block,x.village].filter(Boolean).join(" · "))}</p>
 <span class="status">ACTIVE</span><div class="contact-row"><a href="tel:${esc(phone)}">📞 कॉल</a><button class="btn small" data-officer="${esc(x.officer_id)}">पूरा विवरण</button></div></article>`;
}
async function loadApprovedMembersCached(){
 const now=Date.now();
 if(Array.isArray(state.approvedMemberCache) && now-state.approvedMemberCacheAt<30000) return state.approvedMemberCache;
 const rows=arrOf(await rpc("rkms_search_members",{p_search:"",p_status:"APPROVED",p_limit:1000}));
 state.approvedMemberCache=rows;state.approvedMemberCacheAt=now;
 return rows;
}
async function loadAreaMembers(filters){
 try{
  const all=await loadApprovedMembersCached();
  return all.filter(m=>Object.entries(filters).every(([k,v])=>!v||String(m[k]||"")===String(v)));
 }catch{return []}
}
async function bindAreaReport(){
 const s=document.querySelector("#areaState"),ma=document.querySelector("#areaMandal"),d=document.querySelector("#areaDistrict"),t=document.querySelector("#areaTehsil"),b=document.querySelector("#areaBlock"),v=document.querySelector("#areaVillage"),box=document.querySelector("#areaLists");
 if(!s)return;
 const reset=(el,label)=>{el.innerHTML=`<option value="">${label}</option>`;el.disabled=true;};
 const fill=async(el,level,params,label)=>{const rows=await getLocations(level,params);el.innerHTML=`<option value="">${label}</option>`+rows.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");el.disabled=false;};
 const update=async()=>{
  const filters={state:s.value,mandal:ma.value,district:d.value,tehsil:t.value,block:b.value,village:v.value};
  if(!Object.values(filters).some(Boolean)){const officers=rkmsSortPdaOfficers(state.dir.length?state.dir:await publicOfficers());const members=await loadAreaMembers({});box.innerHTML=`<div class="card"><h3>👥 सभी Approved सदस्य (${members.length})</h3>${members.map(m=>`<div class="list-row"><b>${esc(capName(m.name))}</b><span>${esc(m.member_id||"")}</span></div>`).join("")||cardEmpty("कोई Approved सदस्य नहीं है।")}</div><div class="card"><h3>👤 सभी सक्रिय पदाधिकारी (${officers.length})</h3>${officers.map(o=>`<div class="list-row"><b>${esc(o.name)}</b><span>${esc(o.post_name||"")} · ${esc(officerAreaLabel(o,o))}</span></div>`).join("")||cardEmpty("कोई सक्रिय पदाधिकारी नहीं है।")}</div>`;return;}
  const members=await loadAreaMembers(filters);
  const officers=(state.dir.length?state.dir:await publicOfficers()).filter(o=>Object.entries(filters).every(([k,val])=>!val||String(o[k]||"")===String(val)));
  const label=[v.value,b.value,t.value,d.value,ma.value,s.value].find(Boolean)||"चयनित क्षेत्र";
  box.innerHTML=`<div class="card"><h3>👥 ${esc(label)} — सदस्य (${members.length})</h3>${members.map(m=>`<div class="list-row"><b>${esc(capName(m.name))}</b><span>${esc(m.member_id||"")}</span></div>`).join("")||cardEmpty("इस क्षेत्र में कोई Approved सदस्य नहीं है।")}</div><div class="card"><h3>👤 ${esc(label)} — पदाधिकारी (${officers.length})</h3>${officers.map(o=>`<div class="list-row"><b>${esc(o.name)}</b><span>${esc(o.post_name||"")} · ${esc(officerAreaLabel(o,o))}</span></div>`).join("")||cardEmpty("इस क्षेत्र में कोई सक्रिय पदाधिकारी नहीं है।")}</div>`;
 };
 s.onchange=async()=>{reset(ma,"मंडल चुनें");reset(d,"जिला चुनें");reset(t,"तहसील चुनें");reset(b,"ब्लॉक चुनें");reset(v,"ग्राम चुनें");if(s.value)await fill(ma,"mandal",{state:s.value},"मंडल चुनें");await update();};
 ma.onchange=async()=>{reset(d,"जिला चुनें");reset(t,"तहसील चुनें");reset(b,"ब्लॉक चुनें");reset(v,"ग्राम चुनें");if(ma.value)await fill(d,"district",{state:s.value,mandal:ma.value},"जिला चुनें");await update();};
 d.onchange=async()=>{reset(t,"तहसील चुनें");reset(b,"ब्लॉक चुनें");reset(v,"ग्राम चुनें");if(d.value)await fill(t,"tehsil",{state:s.value,mandal:ma.value,district:d.value},"तहसील चुनें");await update();};
 t.onchange=async()=>{reset(b,"ब्लॉक चुनें");reset(v,"ग्राम चुनें");if(t.value)await fill(b,"block",{state:s.value,mandal:ma.value,district:d.value,tehsil:t.value},"ब्लॉक चुनें");await update();};
 b.onchange=async()=>{reset(v,"ग्राम चुनें");if(b.value)await fill(v,"village",{state:s.value,mandal:ma.value,district:d.value,tehsil:t.value,block:b.value},"ग्राम चुनें");await update();};
 v.onchange=update;
 await fill(s,"state",{},"State चुनें");
}
function bindDirectory(){
 const q=document.querySelector("#dirQ");const grid=document.querySelector("#officerGrid");
 document.querySelector("#dirSearch")?.addEventListener("click",()=>{const s=q.value.toLowerCase();grid.innerHTML=state.dir.filter(x=>[x.name,x.mobile,x.post_name,x.district,x.tehsil].some(v=>String(v||"").toLowerCase().includes(s))).map(officerCard).join("")||cardEmpty("कोई पदाधिकारी नहीं मिला।");bindOfficerButtons()});
 document.querySelectorAll("[data-district]").forEach(b=>b.onclick=()=>{const d=b.dataset.district;go("district/"+encodeURIComponent(d))});
 bindOfficerButtons();
 bindAreaReport();}
function bindOfficerButtons(){document.querySelectorAll("[data-officer]").forEach(b=>b.onclick=()=>go("officer/"+b.dataset.officer))}

async function renderDistrict(district){
 const rows=state.dir.length?state.dir:await publicOfficers();
 const list=rkmsSortPdaOfficers(rows.filter(x=>String(x.district||"").trim()===String(district||"").trim()));
 return `<section class="screen">${screenHead(district,"इस जिले के सक्रिय पदाधिकारी") }<div class="card count-card"><span>कुल सक्रिय पदाधिकारी</span><b>${list.length}</b></div><div class="grid" style="margin-top:16px">${list.map(officerCard).join("")||cardEmpty("इस जिले में अभी कोई सक्रिय पदाधिकारी उपलब्ध नहीं है।")}</div></section>`;
}
async function renderOfficer(id){
 const x=state.dir.find(a=>a.officer_id===id)||((await publicOfficers()).find(a=>a.officer_id===id));
 if(!x)return `<section class="screen">${screenHead("पदाधिकारी विवरण")}${cardEmpty("पदाधिकारी नहीं मिला।")}</section>`;
 const p=phone91(x.mobile)||x.mobile||"";
 return `<section class="screen">${screenHead("पदाधिकारी विवरण","संपर्क के लिए जानकारी") }<article class="card profile watermark-card">${imgOrAvatar(x.photo_url,x.name)}<div><span class="eyebrow">${esc(x.authority_level||"")}</span><h2>${esc(x.name)}</h2><h3>${esc(x.post_name||"")}</h3><div class="detail-list"><div><b>क्षेत्र:</b> ${esc([x.state,x.mandal,x.district,x.tehsil,x.block,x.village].filter(Boolean).join(" / "))}</div><div><b>Appointment No.:</b> ${esc(x.appointment_no||"—")}</div><div><b>Joining:</b> ${esc(x.joining_date||"—")}</div></div>${(state.role==="officer"||state.role==="super_admin")&&p?`<div class="contact-row"><a href="tel:${esc(p)}">📞 संपर्क करें</a></div>`:""}</div></article></section>`;
}

async function getLocations(level,params={}){
 const names={state:"rkms_get_states",mandal:"rkms_get_mandals",district:"rkms_get_districts",tehsil:"rkms_get_tehsils",block:"rkms_get_blocks",village:"rkms_get_villages"};
 const body={};if(level==="mandal")body.p_state=params.state;if(level==="district"){body.p_state=params.state;body.p_mandal=params.mandal}if(level==="tehsil"){Object.assign(body,{p_state:params.state,p_mandal:params.mandal,p_district:params.district})}if(level==="block"){Object.assign(body,{p_state:params.state,p_mandal:params.mandal,p_district:params.district,p_tehsil:params.tehsil})}if(level==="village"){Object.assign(body,{p_state:params.state,p_mandal:params.mandal,p_district:params.district,p_tehsil:params.tehsil,p_block:params.block})}
 const r=await rpc(names[level],body);return arrOf(r);
}
function fillSelect(el,rows,placeholder){el.innerHTML=`<option value="">${placeholder}</option>`;(rows||[]).forEach(x=>{const v=typeof x==="string"?x:(x.name||x.value||x.state||x.mandal||x.district||x.tehsil||x.block||x.village||x.gp_name);if(v)el.insertAdjacentHTML("beforeend",`<option value="${esc(v)}">${esc(v)}</option>`)});el.disabled=!rows?.length}
async function setupLocations(prefix){
 const ids=["state","mandal","district","tehsil","block","village"].map(x=>`${prefix}_${x}`);
 const [s,ma,d,t,b,v]=ids.map(id=>document.getElementById(id));if(!s)return;
 const manual=document.getElementById(`${prefix}_village_manual`);
 const reset=(el,text)=>{if(el){fillSelect(el,[],text);el.disabled=true}};
 const setVillage=async()=>{
   reset(v,"ग्राम चुनें");
   if(!b.value){if(manual)manual.style.display="none";return}
   try{
     const rows=await getLocations("village",{state:s.value,mandal:ma.value,district:d.value,tehsil:t.value,block:b.value});
     fillSelect(v,rows,"ग्राम चुनें");
     if(manual)manual.style.display=rows.length?"none":"block";
   }catch{
     fillSelect(v,[],"ग्राम सूची उपलब्ध नहीं");
     if(manual)manual.style.display="block";
   }
 };
 try{fillSelect(s,await getLocations("state"),"राज्य चुनें")}catch{}
 s.onchange=async()=>{reset(ma,"पहले राज्य चुनें");reset(d,"पहले मंडल चुनें");reset(t,"पहले जिला चुनें");reset(b,"पहले तहसील चुनें");reset(v,"पहले ब्लॉक चुनें");if(manual)manual.style.display="none";if(s.value)fillSelect(ma,await getLocations("mandal",{state:s.value}),"मंडल चुनें")};
 ma.onchange=async()=>{reset(d,"पहले मंडल चुनें");reset(t,"पहले जिला चुनें");reset(b,"पहले तहसील चुनें");reset(v,"पहले ब्लॉक चुनें");if(manual)manual.style.display="none";if(ma.value)fillSelect(d,await getLocations("district",{state:s.value,mandal:ma.value}),"जिला चुनें")};
 d.onchange=async()=>{reset(t,"पहले जिला चुनें");reset(b,"पहले तहसील चुनें");reset(v,"पहले ब्लॉक चुनें");if(manual)manual.style.display="none";if(d.value)fillSelect(t,await getLocations("tehsil",{state:s.value,mandal:ma.value,district:d.value}),"तहसील चुनें")};
 t.onchange=async()=>{reset(b,"पहले तहसील चुनें");reset(v,"पहले ब्लॉक चुनें");if(manual)manual.style.display="none";if(t.value)fillSelect(b,await getLocations("block",{state:s.value,mandal:ma.value,district:d.value,tehsil:t.value}),"ब्लॉक चुनें")};
 b.onchange=setVillage;
}

function membershipForm(){
 return `<section class="screen">${screenHead("सदस्य बनें","सदस्यता आवेदन भरते समय ही अपना Password बनाएं।")}
 <div class="card"><div class="form-grid">
 <label class="field">नाम*<input id="m_name" required autocomplete="name"></label><label class="field">पिता/पति का नाम*<input id="m_father" required></label>
 <label class="field">जन्म तिथि*<input id="m_dob" type="date" required></label>
 <label class="field">मोबाइल नंबर*<input id="m_mobile" inputmode="numeric" maxlength="10" required></label>
 <label class="field">ईमेल (वैकल्पिक)<input id="m_email" type="email" autocomplete="email"></label>
 <label class="field">Password*<input id="m_password" type="password" minlength="8" autocomplete="new-password" required></label>
 <label class="field">Confirm Password*<input id="m_password_confirm" type="password" minlength="8" autocomplete="new-password" required></label>
 <label class="field full">सदस्य का फोटो (वैकल्पिक)<input id="m_photo" type="file" accept="image/jpeg,image/png,image/webp"><span class="note">JPG/PNG/WEBP, अधिकतम 5 MB</span></label>
 <label class="field">राज्य*<select id="member_state" required></select></label><label class="field">मंडल*<select id="member_mandal" disabled required></select></label>
 <label class="field">जिला*<select id="member_district" disabled required></select></label><label class="field">तहसील*<select id="member_tehsil" disabled required></select></label>
 <label class="field">ब्लॉक*<select id="member_block" disabled required></select></label><label class="field">ग्राम*<select id="member_village" disabled required></select><input id="member_village_manual" class="village-manual" placeholder="यदि ग्राम सूची न मिले तो ग्राम का नाम लिखें" style="display:none;margin-top:8px"></label>
 <label class="field full">पूरा पता (वैकल्पिक)<textarea id="m_address" rows="3" placeholder="यदि चाहें तो अपना पता लिखें"></textarea></label></div>
 <div id="memberMsg" class="msg"></div><button id="memberSubmit" class="btn">सदस्य आवेदन Save करें</button></div></section>`;
}
async function fileToBase64(file){
 return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||"").split(",")[1]||"");r.onerror=reject;r.readAsDataURL(file);});
}
function capName(v){
 return String(v||"").trim().replace(/\s+/g," ").replace(/(^|[\s.'-])([a-zA-Z\u0900-\u097F])/g,(m,p,c)=>p+c.toUpperCase());
}
async function submitMember(){
 const msg=document.querySelector("#memberMsg");msg.className="msg";msg.textContent="";
 const data={name:capName(val("m_name")),father_name:capName(val("m_father")),date_of_birth:val("m_dob"),mobile:val("m_mobile"),email:val("m_email"),state:val("member_state"),mandal:val("member_mandal"),district:val("member_district"),tehsil:val("member_tehsil"),block:val("member_block"),village:val("member_village")||val("member_village_manual"),gram_panchayat:val("member_village")||val("member_village_manual"),address:val("m_address")};
 const p1=String(val("m_password")||""),p2=String(val("m_password_confirm")||"");
 for(const [k,l] of [["name","नाम"],["father_name","पिता/पति का नाम"],["mobile","मोबाइल"],["date_of_birth","जन्म तिथि"],["state","राज्य"],["mandal","मंडल"],["district","जिला"],["tehsil","तहसील"],["block","ब्लॉक"],["village","ग्राम"]])if(!data[k]){msg.className="msg err";msg.textContent=l+" जरूरी है।";return}
 if(normMobile(data.mobile).length!==10){msg.className="msg err";msg.textContent="मोबाइल नंबर 10 अंकों का होना चाहिए।";return}
 if(p1.length<8){msg.className="msg err";msg.textContent="Password कम से कम 8 अक्षरों का होना चाहिए।";return}
 if(p1!==p2){msg.className="msg err";msg.textContent="Password और Confirm Password समान नहीं हैं।";return}
 if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)){msg.className="msg err";msg.textContent="Email सही लिखें।";return}
 const photo=document.querySelector("#m_photo")?.files?.[0];
 if(photo&&(!photo.type.startsWith("image/")||photo.size>5*1024*1024)){msg.className="msg err";msg.textContent="Photo केवल JPG/PNG/WEBP और अधिकतम 5 MB रखें।";return}
 try{
   document.querySelector("#memberSubmit").disabled=true;msg.textContent="आवेदन और Password Save हो रहा है…";
   const r=await rpc("rkms_submit_member_application",{p_data:data});
   let existingSaved=false;
   if(r?.success===false){
     const duplicateMsg=String(r.message||"");
     if(!/पहले से मौजूद|पहले से/i.test(duplicateMsg)) throw new Error(duplicateMsg);
     existingSaved=true;
     msg.textContent="आवेदन पहले से Save है। अब Password बनाया जा रहा है…";
   }
   const pr=await request(`${SUPA}/functions/v1/rkms-member-auth`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({action:"create_password",mobile:data.mobile,dob:data.date_of_birth,password:p1})});
   if(!pr?.success)throw new Error(pr?.message||"Password बन नहीं पाया। आवेदन दोबारा जमा न करें; सहायता लें।");
   if(existingSaved){
     msg.className="msg ok";msg.textContent="आपका आवेदन पहले ही सफलतापूर्वक Save हो चुका है। संगठन से Approval के बाद आप सदस्य Login कर सकते हैं। धन्यवाद।";
     return;
   }
   if(photo){
     const b64=await fileToBase64(photo);
     const pp=await request(`${SUPA}/functions/v1/rkms-member-auth`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({action:"upload_pending_member_photo",member_id:r.member_uuid,base64:b64,content_type:photo.type,filename:photo.name})});
     if(!pp?.success)throw new Error("आवेदन और Password Save हो गया, लेकिन Photo upload नहीं हुई: "+(pp?.message||"फिर प्रयास करें।"));
   }
   msg.className="msg ok";msg.textContent="आपका आवेदन Save हो गया है। संगठन से Approval के बाद आप सदस्य Login कर सकते हैं। धन्यवाद।";
 }catch(e){document.querySelector("#memberSubmit").disabled=false;msg.className="msg err";msg.textContent=e.message||"आवेदन जमा नहीं हुआ।"}
}
function loginScreen(){
 return `<section class="screen">${screenHead("सदस्य Login","Approved सदस्य Registration के समय बनाए गए Password से Login करें।")}
 <div class="card member-login-card">
  <h2>👤 सदस्य Login</h2>
  <label class="field">Mobile या Email<input id="memberIdentifier" autocomplete="username" placeholder="मोबाइल नंबर या Email"></label>
  <label class="field">Password<input id="memberPasswordLogin" type="password" autocomplete="current-password" placeholder="अपना Password"></label>
  <div class="actions"><button id="memberPasswordLoginBtn" class="btn">Member Login</button><button id="memberForgotBtn" class="btn ghost small">Forget Password</button></div>
  <div id="memberLoginMsg" class="msg"></div>
  <div id="memberLoginSlogan" class="member-login-slogan" aria-live="polite"><span>किसानों की आवाज़ बुलंद रहे<br>संघर्ष लगातार जारी रहे</span></div>
 </div>
 </section>`;
}
async function loadLoginSlogans(){
 const box=document.querySelector('#memberLoginSlogan'); if(!box)return;
 try{
  const r=await rpc('rkms_get_login_slogans');
  const rows=arrOf(r,'slogans').map(x=>String(x?.slogan||'').trim()).filter(Boolean);
  if(!rows.length)return;
  if(window.rkmsLoginSloganTimer){clearInterval(window.rkmsLoginSloganTimer);window.rkmsLoginSloganTimer=null;}
  let i=0;
  const show=()=>{if(!box.isConnected)return;box.classList.remove('is-visible');setTimeout(()=>{if(!box.isConnected)return;box.innerHTML=`<span>${esc(rows[i]).replace(/\n/g,'<br>')}</span>`;box.classList.add('is-visible');},120);};
  show(); if(rows.length>1)window.rkmsLoginSloganTimer=setInterval(()=>{i=(i+1)%rows.length;show();},4500);
 }catch{}
}
function canManageLoginSlogansClient(){
 if(state.role==='super_admin')return true; if(state.role!=='officer')return false;
 const level=String(state.officer?.authority_level||state.officer?.level||'').toUpperCase();
 return level==='STATE'||/राष्ट्रीय अध्यक्ष/i.test(String(state.officer?.post_name||''));
}
async function renderLoginSlogans(){
 await refreshIdentity(); if(!canManageLoginSlogansClient())return loginScreen();
 let rows=[]; try{rows=arrOf(await rpc('rkms_get_login_slogans'),'slogans');}catch{}
 const slots=Array.from({length:10},(_,i)=>rows.find(x=>Number(x.display_order)===i+1)?.slogan||'');
 return `<section class="screen">${screenHead('Login Slogan Management','सदस्य Login के नीचे दिखने वाले 1 से 10 slogans — एक-एक करके अपने आप बदलेंगे')}
 <div class="card login-slogan-admin-card"><h2>📢 सदस्य Login Slogans</h2>
 <p class="note">एक बार में अधिकतम 10 slogans सेव करें। हर slogan 2 लाइन में लिखा जा सकता है। Login screen पर slogans एक-एक करके लगभग 4.5 सेकंड में बदलेंगे। खाली slot publish नहीं होगा।</p>
 <div class="login-slogan-grid">${slots.map((v,i)=>`<label class="field"><span>Slogan ${i+1}</span><textarea id="loginSlogan${i+1}" rows="3" maxlength="240" placeholder="पहली लाइन\nदूसरी लाइन">${esc(v)}</textarea></label>`).join('')}</div>
 <div id="loginSloganMsg" class="msg"></div><div class="actions"><button class="btn" id="loginSloganSave">💾 सभी Slogans Save करें</button><button class="btn ghost" id="loginSloganClear">फ़ॉर्म साफ करें</button></div>
 </div></section>`;
}
async function saveLoginSlogans(){
 const msg=document.querySelector('#loginSloganMsg');
 try{
  const slogans=[]; for(let i=1;i<=10;i++){const text=String(document.querySelector(`#loginSlogan${i}`)?.value||'').trim();if(text)slogans.push({display_order:i,slogan:text});}
  if(!slogans.length)throw new Error('कम से कम 1 slogan लिखें।');
  const r=await rpc('rkms_manage_login_slogans',{p_slogans:slogans}); if(!r?.success)throw new Error(r?.message||'Slogans save नहीं हुए।');
  msg.className='msg ok';msg.textContent=`✅ ${slogans.length} slogans सफलतापूर्वक save हो गए।`;
 }catch(e){msg.className='msg err';msg.textContent=e.message||'Slogans save नहीं हुए।'}
}
function officerLoginScreen(){
 return `<section class="screen">${screenHead("पदाधिकारी / Super Admin Login","अधिकारी और Super Admin के लिए Login")}
 <div class="card"><h2>🛡️ पदाधिकारी Login</h2>
 <label class="field">ईमेल<input id="loginEmail" type="email" autocomplete="username"></label>
 <label class="field">पासवर्ड<input id="loginPassword" type="password" autocomplete="current-password"></label>
 <div class="actions"><button id="loginBtn" class="btn">लॉगिन</button><button id="forgotBtn" class="btn ghost">पासवर्ड भूल गए?</button></div>
 <div id="loginMsg" class="msg"></div></div></section>`;
}
async function memberPasswordLogin(){
 const msg=document.querySelector("#memberLoginMsg");msg.className="msg";msg.textContent="";
 try{
   const identifier=val("memberIdentifier").trim(), password=val("memberPasswordLogin");
   if(!identifier||!password)throw new Error("Mobile/Email और Password दोनों भरें।");
   const r=await request(`${SUPA}/functions/v1/rkms-member-auth`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({action:"login",identifier,password})});
   if(!r?.success)throw new Error(r?.message||"Member login नहीं हुआ।");
   saveSession(r.session,true);
   if(r.member && String(r.member.status||"").toUpperCase()==="APPROVED"){
     state.user={id:r.session?.user?.id||null,email:r.session?.user?.email||null};
     state.member=r.member;
     state.officer=null;
     state.role="member";
     // Keep the member identity as the primary login view, but also load an
     // officer record when this same person is an appointed officer. This
     // allows the member login to show officer details/appointment while the
     // separate Officer Login continues to expose officer-only authorities.
     try{
       const op=dataOf(await rpc("rkms_get_current_officer_profile"));
       if(op?.officer){ state.officer=op.officer; }
     }catch{}
     completeLogin("member-dashboard");
     return;
   }
   await refreshIdentity();
   if(!state.member || String(state.member.status||"").toUpperCase()!=="APPROVED")throw new Error("यह account APPROVED Member से जुड़ा नहीं है।");
   completeLogin("member-dashboard");
 }catch(e){msg.className="msg err";msg.textContent=e.message||"Member login नहीं हुआ।"}
}
async function memberForgotPassword(){
 const old=document.querySelector("#memberPasswordResetModal");if(old)old.remove();
 const modal=document.createElement("div");modal.id="memberPasswordResetModal";modal.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;z-index:99999;padding:18px;overflow:auto";
 modal.innerHTML=`<div class="card" style="width:min(520px,100%);background:#fff;max-height:92vh;overflow:auto">
 <h2>🔐 Member Password Reset</h2>
 <p class="note">Mobile + DOB + Registered Email से पहचान सत्यापित करें। नया Password बनाकर एक ही बार Password Reset Request भेजें। PDA approval के बाद इसी नए Password से Login करें। OTP नहीं है।</p>
 <div class="form-grid">
  <label class="field">Mobile*<input id="mr_mobile" inputmode="numeric" maxlength="10" autocomplete="tel"></label>
  <label class="field">DOB*<input id="mr_dob" type="date" autocomplete="bday"></label>
  <label class="field full">Registered Email*<input id="mr_email" type="email" autocomplete="email"></label>
  <label class="field">New Password*<input id="mr_password" type="password" minlength="8" autocomplete="new-password"></label>
  <label class="field">Confirm Password*<input id="mr_password2" type="password" minlength="8" autocomplete="new-password"></label>
 </div>
 <div id="mr_msg" class="msg"></div>
 <div class="actions">
  <button class="btn ghost" id="mr_cancel">Cancel</button>
  <button class="btn secondary" id="mr_request">Password Reset Request Send</button>
 </div>
 </div>`;
 document.body.appendChild(modal);
 const msg=modal.querySelector("#mr_msg");
 const btn=modal.querySelector("#mr_request");
 let statusTimer=null;
 let statusBusy=false;
 let submitted=false;
 const fields=()=>({
   mobile:normMobile(modal.querySelector("#mr_mobile").value),
   dob:modal.querySelector("#mr_dob").value,
   email:modal.querySelector("#mr_email").value.trim().toLowerCase(),
   password:modal.querySelector("#mr_password").value,
   password2:modal.querySelector("#mr_password2").value
 });
 const showStatus=async()=>{
   if(submitted||statusBusy)return;
   const x=fields();
   if(x.mobile.length!==10||!x.dob||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email))return;
   statusBusy=true;
   try{
     const r=await request(`${SUPA}/functions/v1/rkms-member-auth`,{
       method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},
       body:JSON.stringify({action:"password_reset_status",mobile:x.mobile,dob:x.dob,email:x.email})
     });
     if(!r?.success)return;
     const st=String(r.status||"NONE").toUpperCase();
     if(st==="PENDING"){
       msg.className="msg ok";msg.textContent="Request Already Pending — पदाधिकारी की Approval की प्रतीक्षा करें।";
       btn.textContent="Request Pending";btn.disabled=true;
     }else if(st==="APPROVED"){
       msg.className="msg ok";msg.textContent="पिछली Password Reset Request APPROVED हो चुकी है। यदि Password फिर भूल गए हैं तो नया Password भरकर नई Request भेज सकते हैं।";
       btn.textContent="Password Reset Request Send";btn.disabled=false;
     }else{
       msg.className="msg";msg.textContent="";
       btn.textContent="Password Reset Request Send";btn.disabled=false;
     }
   }catch{}finally{statusBusy=false;}
 };
 const scheduleStatus=()=>{
   clearTimeout(statusTimer);
   statusTimer=setTimeout(showStatus,450);
 };
 modal.querySelector("#mr_cancel").onclick=()=>{clearTimeout(statusTimer);modal.remove()};
 ["mr_mobile","mr_dob","mr_email"].forEach(id=>modal.querySelector("#"+id).addEventListener("input",scheduleStatus));
 btn.onclick=async e=>{
   if(btn.disabled||!lockButton(e.currentTarget,"⏳ Request भेजी जा रही है…"))return;
   try{
     const x=fields();
     if(x.mobile.length!==10||!x.dob||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email))throw new Error("Mobile, DOB और Registered Email सही भरें।");
     if(x.password.length<8)throw new Error("Password कम से कम 8 अक्षरों का होना चाहिए।");
     if(x.password!==x.password2)throw new Error("Password और Confirm Password समान नहीं हैं।");
     const r=await request(`${SUPA}/functions/v1/rkms-member-auth`,{
       method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},
       body:JSON.stringify({action:"request_password_reset",mobile:x.mobile,dob:x.dob,email:x.email,password:x.password})
     });
     if(!r?.success)throw new Error(r?.message||"Reset request नहीं बनी।");
     submitted=true;
     btn.textContent="Request Pending";btn.disabled=true;
     msg.className="msg ok";
     msg.textContent="Password Reset Request पदाधिकारी के पास भेज दी गई है। Approval के बाद नए Password से Login करें।";
   }catch(err){
     msg.className="msg err";msg.textContent=err.message||"Request नहीं बनी।";
     if(String(err.message||"").includes("पहले से Pending")){
       btn.textContent="Request Pending";btn.disabled=true;
     }else{
       btn.textContent="Password Reset Request Send";btn.disabled=false;
     }
   }finally{
     if(!submitted)unlockButton(e.currentTarget);
   }
 };
}
async function anonymousSignIn(){
 const r=await request(`${AUTH}/signup`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({})});
 if(!r?.access_token)throw new Error("Temporary member session नहीं बन सकी।");
 saveSession(r,true);
 return r;
}
async function temporaryMemberAccess(mobile){
 const p=normMobile(mobile);if(p.length!==10)throw new Error("सही 10 अंकों का मोबाइल नंबर दें।");
 AUTH_STORE.setItem("rkms_temp_member_mobile",p);
 try{
   if(!token())await anonymousSignIn();
   let d;
   try{d=await request(`${SUPA}/functions/v1/rkms-member-access`,{method:"POST",headers:authHeaders(),body:JSON.stringify({mobile:p})});}
   catch(e){
     AUTH_STORE.removeItem("rkms_access_token");AUTH_STORE.removeItem("rkms_refresh_token");
     await anonymousSignIn();
     d=await request(`${SUPA}/functions/v1/rkms-member-access`,{method:"POST",headers:authHeaders(),body:JSON.stringify({mobile:p})});
   }
   if(!d?.success||!d.member)throw new Error(d?.message||"इस मोबाइल नंबर से APPROVED सदस्य नहीं मिला।");
   // Link this anonymous temporary session to the approved member so self-service
   // profile/photo updates can be restricted to the logged-in member record.
   const claim=await rpc("rkms_claim_temp_member_session",{p_mobile:p});
   if(!claim?.success)throw new Error(claim?.message||"Member session verify नहीं हुआ।");
   state.user={id:"temporary-"+d.member.id,is_anonymous:true};
   state.member=d.member;state.officer=d.officer||null;state.role="member";state.tempAccess=true;
   return d;
 }catch(e){AUTH_STORE.removeItem("rkms_temp_member_mobile");throw e}
}
async function mobileMemberLogin(){
 const msg=document.querySelector("#memberMobileLoginMsg");msg.textContent="";
 try{await temporaryMemberAccess(val("memberMobileLogin"));msg.className="msg ok";msg.textContent="सदस्य सत्यापित हो गया।";go("member-dashboard")}
 catch(e){msg.className="msg err";msg.textContent=e.message||"Member login नहीं हुआ।"}}
function saveSession(d,resetWindow=false){
 AUTH_STORE.setItem("rkms_access_token",d?.access_token||"");
 if(d?.refresh_token)AUTH_STORE.setItem("rkms_refresh_token",d.refresh_token);
 if(d?.expires_in)AUTH_STORE.setItem("rkms_access_expires_at",String(Date.now()+Number(d.expires_in)*1000));
 // Android bridge keeps FCM registration tied to the authenticated account.
 // Anonymous temporary sessions must never register an FCM token.
 try{
   const anon=!!d?.user?.is_anonymous;
   if(window.RKMSNative){
     if(anon) window.RKMSNative.clearSession();
     else if(d?.access_token) window.RKMSNative.saveSession(d.access_token,d.refresh_token||"",state.role||"");
   }
 }catch(e){}
}
function clearSessionStorage(){
 AUTH_STORE.removeItem("rkms_access_token");
 AUTH_STORE.removeItem("rkms_refresh_token");
 AUTH_STORE.removeItem("rkms_access_expires_at");
 AUTH_STORE.removeItem("rkms_temp_member_mobile");
 try{window.RKMSNative?.clearSession?.()}catch(e){}
}
async function ensureSession(){
 const access=token(),refresh=AUTH_STORE.getItem("rkms_refresh_token")||"";
 if(!access)return false;
 const exp=Number(AUTH_STORE.getItem("rkms_access_expires_at")||0);
 // A valid access token is usable until it expires. Once expired, silently
 // refresh it; there is intentionally no 30-minute app-side auto logout.
 if(exp&&Date.now()<exp-30000)return true;
 if(!refresh)return false;
 try{
  const d=await request(`${AUTH}/token?grant_type=refresh_token`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:refresh})});
  if(!d?.access_token)throw new Error("Session refresh failed");
  saveSession(d,false);return true;
 }catch{clearSessionStorage();return false;}
}
async function currentUser(){
 if(!(await ensureSession()))return null;
 try{return await request(`${AUTH}/user`,{headers:authHeaders()})}catch{return null}
}
async function refreshIdentity(force=false){
 // Unified role resolution: one Officer Login serves Super Admin and every
 // active authorized officer. The database RPC is the source of truth.
 // Temporary Member Login uses an anonymous Auth session plus a claimed
 // member session, so restore it before generic role resolution.
 if(!force && state.user && state.role && ["member","officer","super_admin"].includes(state.role)) return;
 const u=await currentUser();
 state.tempAccess=false;
 state.user=u;state.member=null;state.officer=null;state.role=null;
 if(!u)return;
 const tempMobile=normMobile(AUTH_STORE.getItem("rkms_temp_member_mobile")||"");
 if(tempMobile.length===10){
   try{
     const claim=await rpc("rkms_claim_temp_member_session",{p_mobile:tempMobile});
     if(claim?.success&&claim.member){
       state.user={id:"temporary-"+claim.member.id,is_anonymous:true};
       state.member=claim.member;
       state.officer=claim.officer||null;
       state.role="member";
       state.tempAccess=true;
       return;
     }
   }catch{}
 }
 try{
   const ident=await rpc("rkms_get_login_identity");
   if(ident?.success){
     state.role=ident.role||null;
     if(state.role==="super_admin") return;
     if(state.role==="officer"){
       try{const r=await rpc("rkms_get_current_officer_profile");if(r?.success&&r.officer)state.officer=r.officer}catch{}
       try{const r=await rpc("rkms_get_current_member_profile");if(r?.success&&r.member)state.member=r.member}catch{}
       return;
     }
     if(state.role==="member"){
       try{const r=await rpc("rkms_get_current_member_profile");if(r?.success&&r.member)state.member=r.member}catch{}
       return;
     }
   }
 }catch{}
 // Backward-compatible fallback for databases that have not yet received the RPC.
 try{if(await rpc("rkms_is_super_admin"))state.role="super_admin"}catch{}
 if(!state.role)try{if(await rpc("rkms_is_current_officer"))state.role="officer"}catch{}
 if(!state.role)try{const r=await rpc("rkms_get_current_member_profile");if(r?.success){state.member=r.member;state.role="member"}}catch{}
}
async function logout(reload=true){
 try{if(token())await request(`${AUTH}/logout`,{method:"POST",headers:authHeaders()});}catch{}
 clearSessionStorage();
 state.user=state.member=state.officer=null;state.role=null;state.tempAccess=false;
 if(reload){
   const idx=currentHistoryIndex();
   history.replaceState({rkmsRoute:"home",rkmsIndex:idx,rkmsApp:true,rkmsAuthenticated:false},"","#home");
   writeScreenStack(["home"]);
   render();
 }
}

async function hydrateCurrentMember(){
 try{const r=await rpc("rkms_get_current_member_profile");if(r?.success&&r.member){state.member=r.member;return r.member;}}catch{}
 return state.member;
}
function officerAreaLabel(o,m){
 if(!o)return "";
 const level=String(o.post_level||o.authority_level||o.level||"").toUpperCase();
 const explicit=String(o.area_name||o.charge_name||o.jurisdiction_name||"").trim();
 if(explicit)return explicit;
 if(level==="STATE"||level==="PROVINCE")return o.state||m?.state||"";
 if(level==="MANDAL"||level==="DIVISION")return o.mandal||"";
 if(level==="DISTRICT")return o.district||"";
 if(level==="TEHSIL"||level==="TAHSIL")return o.tehsil||"";
 if(level==="BLOCK")return o.block||"";
 if(level==="VILLAGE"||level==="GRAM")return o.village||m?.village||m?.gram_panchayat||"";
 return [o.village,o.block,o.tehsil,o.district,o.mandal,o.state].find(Boolean)||"";
}
async function getAppointmentMeta(memberId){
 let meta={};try{meta=dataOf(await rpc("rkms_get_digital_id_meta",{p_member_id:memberId}))||{}}catch{}
 if(!meta.national_president_name)meta.national_president_name="श्री V. M. Singh";
 return meta;
}
async function renderMemberDashboard(){
 if(!state.user) return loginScreen();
 if(state.role!=="member" && state.role!=="officer") return loginScreen();
 if(!state.member){await refreshIdentity()}
 await hydrateCurrentMember();
 if(!state.member)return `<section class="screen">${screenHead("सदस्य Dashboard")}${cardEmpty("इस login से कोई member नहीं मिला।")}</section>`; if(state.member.status!=="APPROVED")return `<section class="screen">${screenHead("सदस्य आवेदन स्थिति")}<div class="card"><span class="status amber">${esc(state.member.status||"PENDING")}</span><h2>${esc(state.member.name||"सदस्य")}</h2><p class="lead">आपका सदस्यता आवेदन अभी स्वीकृति की प्रतीक्षा में है। APPROVED होने के बाद Digital ID, शिकायत और सदस्य सेवाएँ उपलब्ध होंगी।</p><button class="btn ghost" data-route="home">होम</button></div></section>`;
 const m=state.member;
 return `<section class="screen">${screenHead(state.role==="officer"?"सदस्य विवरण / Member View":"सदस्य Dashboard","आपकी सदस्य जानकारी और सेवाएँ")}
 <div class="card profile">${imgOrAvatar(m.photo_url,m.name)}<div><span class="status">${esc(m.status)}</span><h2>${esc(m.name)}</h2><p>${esc(m.member_id||"Member ID अभी उपलब्ध नहीं")}</p><p>${esc([m.state,m.district,m.tehsil,m.block,m.village].filter(Boolean).join(" · "))}</p></div></div>
 <div class="quick-grid" style="margin:18px 0"><button class="quick" data-route="digital-id"><strong>🪪 Digital ID</strong><span>अपना डिजिटल सदस्य पहचान पत्र</span></button><button class="quick" data-route="member-update"><strong>✏️ जानकारी अपडेट करें</strong><span>फोटो, WhatsApp, ईमेल और पता अपडेट करें</span></button><button class="quick" data-route="complaint"><strong>📝 शिकायत</strong><span>संगठन को शिकायत भेजें</span></button><button class="quick" data-route="my-complaints"><strong>📋 मेरी शिकायतें</strong><span>स्थिति और history देखें</span></button><button class="quick" data-route="notifications"><strong>🔔 सूचनाएँ</strong><span>संगठन की जरूरी सूचना</span></button><button class="quick" data-route="chat"><strong>💬 Chat</strong><span>सदस्य और अधिकृत पदाधिकारी से संदेश</span></button>${state.officer?`<button class="quick" data-route="appointment-letter"><strong>📜 नियुक्ति पत्र</strong><span>अपना नियुक्ति पत्र देखें</span></button>`:`<button class="quick" data-route="membership-certificate"><strong>📜 सदस्यता प्रमाण-पत्र</strong><span>अपना सदस्यता प्रमाण-पत्र देखें</span></button>`}</div>
 <div class="actions"><button class="btn ghost" id="memberLogout">Logout</button></div></section>`;
}

async function validateFileSignature(file, kind="general"){
 if(!file)throw new Error("कृपया file चुनें।");
 const type=String(file.type||"").toLowerCase();
 const name=String(file.name||"").toLowerCase();
 const buf=await file.slice(0,16).arrayBuffer();
 const b=new Uint8Array(buf);
 const is=(...xs)=>xs.every((v,i)=>b[i]===v);
 const imageOk=(type==="image/jpeg"&&is(0xff,0xd8,0xff))||(type==="image/png"&&is(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a))||(type==="image/webp"&&is(0x52,0x49,0x46,0x46)&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50);
 const pdfOk=type==="application/pdf"&&String.fromCharCode(...b.slice(0,4))==="%PDF";
 if(type.startsWith("image/")&&!imageOk)throw new Error("फोटो का वास्तविक file format मान्य नहीं है।");
 if(type==="application/pdf"&&!pdfOk)throw new Error("PDF file का वास्तविक format मान्य नहीं है।");
 if(kind==="image"&&!imageOk)throw new Error("केवल मान्य JPG/PNG/WEBP फोटो स्वीकार है।");
 // Browser MIME sniffing cannot reliably validate every video/audio container. For those, extension + MIME are retained and server/storage rules remain authoritative.
 if((type.startsWith("video/")||type.startsWith("audio/"))&&!/\.(mp4|webm|ogg|mp3|wav|m4a|aac|mov)$/i.test(name))throw new Error("इस media file का extension मान्य नहीं है।");
 return true;
}

async function uploadMemberPhoto(file){
 if(!file||!state.member?.id)throw new Error("फोटो और member session जरूरी है।");
 if(!file.type.startsWith("image/"))throw new Error("केवल फोटो file चुनें।");
 if(file.size>5*1024*1024)throw new Error("फोटो 5 MB से छोटी रखें।");
 await validateFileSignature(file,"image");
 const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
 const path=`member-photos/${state.member.id}/${Date.now()}.${ext}`;
 const r=await fetch(`${STORE}/object/rkms-media/${path}`,{method:"POST",headers:{apikey:ANON,Authorization:"Bearer "+token(),"Content-Type":file.type,"x-upsert":"false"},body:file});
 const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}
 if(!r.ok)throw new Error(d?.message||d?.error||t||"फोटो upload नहीं हुई।");
 return `${SUPA}/storage/v1/object/public/rkms-media/${path}`;
}

async function renderMemberUpdate(){
 await refreshIdentity();
 const m=state.member;
 if(!m||m.status!=="APPROVED")return `<section class="screen">${screenHead("जानकारी अपडेट करें")}${cardEmpty("यह सुविधा केवल APPROVED सदस्य के लिए उपलब्ध है।")}</section>`;
 return `<section class="screen">${screenHead("सदस्य जानकारी अपडेट करें","अपनी फोटो और संपर्क जानकारी मोबाइल से अपडेट करें")}
 <div class="card profile">${imgOrAvatar(m.photo_url,m.name)}<div><h2>${esc(m.name)}</h2><p>Member ID: <b>${esc(m.member_id||"—")}</b></p><p>मोबाइल: <b>${esc(m.mobile||"—")}</b></p></div></div>
 <div class="card"><div class="form-grid">
 <label class="field full">नई फोटो<input id="mu_photo" type="file" accept="image/*"><span class="note">JPG/PNG/WEBP, अधिकतम 5 MB</span></label>
 <label class="field">WhatsApp नंबर<input id="mu_whatsapp" inputmode="numeric" maxlength="10" value="${esc(m.whatsapp||"")}"></label>
 <label class="field">ईमेल<input id="mu_email" type="email" value="${esc(m.email||"")}"></label>
 <label class="field full">पता<input id="mu_address" value="${esc(m.address||"")}"></label>
 </div><p class="note">नाम, पिता/पति का नाम, मोबाइल और सदस्य का क्षेत्र जैसे पहचान संबंधी विवरण बदलने के लिए पदाधिकारी/Super Admin से संपर्क करें।</p><div id="memberUpdateMsg" class="msg"></div><button class="btn" id="memberUpdateSave">💾 जानकारी सेव करें</button></div></section>`;
}

async function saveMemberUpdate(){
 const msg=document.querySelector("#memberUpdateMsg");msg.className="msg";msg.textContent="अपडेट हो रहा है…";
 try{
   await refreshIdentity();
   if(!state.member||state.member.status!=="APPROVED")throw new Error("Approved member login जरूरी है।");
   let photo=state.member.photo_url||"";
   const file=document.querySelector("#mu_photo")?.files?.[0];
   if(file)photo=await uploadMemberPhoto(file);
   const r=await rpc("rkms_update_member_self",{p_data:{photo_url:photo,whatsapp:normMobile(val("mu_whatsapp")),email:val("mu_email"),address:val("mu_address")}});
   if(!r?.success)throw new Error(r?.message||"जानकारी update नहीं हुई।");
   state.member=r.member;
   msg.className="msg ok";msg.textContent="जानकारी और फोटो सफलतापूर्वक अपडेट हो गई।";
 }catch(e){msg.className="msg err";msg.textContent=e.message||"Update नहीं हुआ।"}
}

async function renderDigitalId(){
 await refreshIdentity();await hydrateCurrentMember();
 const m=state.member;if(!m)return loginScreen();
 if(m.status!=="APPROVED")return `<section class="screen">${screenHead("Digital Member ID Card","स्वीकृत सदस्य का डिजिटल पहचान पत्र")}${cardEmpty("Digital ID केवल APPROVED सदस्य के लिए उपलब्ध है।")}</section>`;
 const meta=await getAppointmentMeta(m.id);
 const photo=normalizeMediaUrl(m.photo_url);
 const post="सदस्य";
 const appointedName=String(meta.appointing_officer_name||"").trim();
 const appointedPost=String(meta.appointing_officer_post||"").trim();
 const appointedSig=normalizeMediaUrl(meta.appointing_officer_signature_url||"");
 const photoHtml=photo?`<img src="${esc(photo)}" alt="${esc(m.name||"सदस्य")}" class="member-photo digital-member-photo" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src+(this.src.includes('?')?'&':'?')+'v='+Date.now();}else{this.onerror=null;this.src='assets/rkms-logo-transparent.png';this.classList.add('photo-fallback');}">`:`<div class="member-photo photo-fallback"></div>`;
 const appointedHtml=appointedName&&appointedName!=="—"?`<div><small>नियुक्तिकर्ता अधिकारी</small>${appointedSig?`<img class="appoint-signature" src="${esc(appointedSig)}" alt="नियुक्तिकर्ता अधिकारी का Digital Signature" loading="eager" decoding="async" referrerpolicy="no-referrer">`:`<div class="signature-line"></div>`}<b>${esc(appointedName)}</b><span>${esc(appointedPost||"PDA पदाधिकारी")}</span></div>`:`<div><small>नियुक्तिकर्ता अधिकारी</small><b>—</b><span>पदाधिकारी विवरण उपलब्ध नहीं</span></div>`;
 return `<section class="screen">${screenHead("Digital Member ID Card","स्वीकृत सदस्य का डिजिटल पहचान पत्र")}
 <div class="id-card"><div class="id-head"><img src="assets/rkms-logo-transparent.png" alt="RKMS"><div><div class="id-org-title">राष्ट्रीय किसान मजदूर संगठन</div></div></div>
 <div class="id-body"><div class="id-photo-wrap">${photoHtml}</div>
 <div><span class="eyebrow">DIGITAL ID</span><h2>${esc(m.name)}</h2><p><b>Member ID:</b> ${esc(m.member_id||"—")}</p><p><b>पद:</b> ${esc(post)}</p><p><b>ग्राम:</b> ${esc(m.village||m.gram_panchayat||"—")}</p></div></div>
 <div class="id-authorities"><div><small>राष्ट्रीय अध्यक्ष</small><b>${esc(meta.national_president_name||"श्री V. M. Singh जी")}</b><span>राष्ट्रीय किसान मजदूर संगठन</span></div>${appointedHtml}</div>
 <div class="id-foot">जय किसान — जय नौजवान</div></div><div class="actions"><button class="btn" onclick="window.print()">🖨️ Print / PDF</button></div></section>`;
}

async function renderMembershipCertificate(){
 await refreshIdentity();await hydrateCurrentMember();
 if(state.officer)return renderAppointmentLetter();
 if(!state.member)return loginScreen();
 const m=state.member;
 if(m.status!=="APPROVED")return `<section class="screen">${screenHead("सदस्यता प्रमाण-पत्र")}${cardEmpty("सदस्यता प्रमाण-पत्र केवल APPROVED सदस्य के लिए उपलब्ध है।")}</section>`;
 const memberId=String(m.member_id||"—");
 const today=new Date();
 const issueDate=`${String(today.getDate()).padStart(2,"0")} / ${String(today.getMonth()+1).padStart(2,"0")} / ${today.getFullYear()}`;
 const nameWithJi=`${String(m.name||"सदस्य").trim()} जी`;
 const meta=await getAppointmentMeta(m.id);
 const appointedName=String(meta.appointing_officer_name||"").trim();
 const appointedPost=String(meta.appointing_officer_post||"").trim();
 const appointedSig=normalizeMediaUrl(meta.appointing_officer_signature_url||"");
 return `<section class="screen">${screenHead("सदस्यता प्रमाण-पत्र","स्वीकृत सदस्य के लिए सदस्यता प्रमाण-पत्र")}
 <div class="membership-certificate-paper"><div class="membership-certificate">
   <div class="certificate-corner certificate-corner-tl"></div><div class="certificate-corner certificate-corner-tr"></div><div class="certificate-corner certificate-corner-bl"></div><div class="certificate-corner certificate-corner-br"></div>
   <div class="certificate-header"><img class="certificate-logo" src="assets/rkms-logo-transparent.png" alt="RKMS"><div class="certificate-heading"><h1>राष्ट्रीय किसान मजदूर संगठन</h1><div class="certificate-subtitle">जय किसान — जय नौजवान</div><div class="certificate-rule"></div></div></div>
   <div class="certificate-title-box"><h2>सदस्यता प्रमाण-पत्र</h2></div>
   <div class="certificate-meta"><span><b>सदस्यता संख्या :</b> ${esc(memberId)}</span><span><b>दिनांक :</b> ${esc(issueDate)}</span></div>
   <div class="certificate-body"><p class="certificate-member-name"><span>श्री/श्रीमती</span> <b>${esc(nameWithJi)}</b></p><p class="certificate-award">को <b>राष्ट्रीय किसान मजदूर संगठन</b> की सदस्यता प्रदान की जाती है।</p><p>हम आपको संगठन का सक्रिय सदस्य बनाते हुए यह विश्वास व्यक्त करते हैं कि आप संगठन के उद्देश्यों, विचारों एवं संविधान का पालन करते हुए किसान-मजदूर हितों की रक्षा, उनके अधिकारों के लिए संघर्ष तथा संगठन की एकता, अनुशासन और मजबूती के लिए सदैव समर्पित रहेंगे।</p></div>
   <div class="certificate-slogan">जय किसान | जय मजदूर | जय नौजवान</div>
   <div class="certificate-signatures"><div class="certificate-sign"><div class="signature-line"></div><b>राष्ट्रीय अध्यक्ष</b><strong class="certificate-fixed-sign-name">श्री V. M. Singh जी</strong><small>राष्ट्रीय किसान मजदूर संगठन</small></div><div class="certificate-sign">${appointedSig?`<img class="certificate-digital-signature" src="${esc(appointedSig)}" alt="नियुक्तिकर्ता अधिकारी का Digital Signature" loading="eager" decoding="async" referrerpolicy="no-referrer">`:`<div class="signature-line"></div>`}<b>${esc(appointedName||"नियुक्तिकर्ता अधिकारी")}</b><small>${esc(appointedPost||"PDA पदाधिकारी")}<br>नियुक्तिकर्ता अधिकारी</small></div></div>
 </div></div><div class="actions"><button class="btn" onclick="window.print()">🖨️ सदस्यता प्रमाण-पत्र Print / PDF</button></div></section>`;
}
async function renderAppointmentLetter(){
 await refreshIdentity();await hydrateCurrentMember();
 if(!state.member)return loginScreen();
 const m=state.member;
 let o=state.officer||null;
 try{const rr=dataOf(await rpc("rkms_get_current_officer_profile"));if(rr?.officer){o=rr.officer;state.officer=o;}}catch{}
 if(!o)return `<section class="screen">${screenHead("नियुक्ति पत्र")}${cardEmpty("आपके नाम से कोई सक्रिय नियुक्ति उपलब्ध नहीं है।")}</section>`;
 const meta=await getAppointmentMeta(m.id);
 let appointedName=meta.appointing_officer_name||o.name||"अधिकृत पदाधिकारी";
 let appointedPost=meta.appointing_officer_post||o.post_name||"";
 let appointedSig=meta.appointing_officer_signature_url||"";
 if(!appointedSig && o.signature_url)appointedSig=o.signature_url;
 if(!appointedSig && o.digital_signature_url)appointedSig=o.digital_signature_url;
 const signerSig=normalizeMediaUrl(appointedSig);
 const area=officerAreaLabel(o,m);
 const rawPost=String(o.post_name||"").trim();
 const designation=[area,rawPost].filter(Boolean).join(" ").trim() || "—";
 const nameWithJi=`${String(m.name||"सदस्य").trim()} जी`;
 const appointmentDate=o.joining_date||meta.joining_date||new Date().toISOString().slice(0,10);
 const [ay,am,ad]=String(appointmentDate).split('-');
 const issueDate=(ay&&am&&ad)?`${ad} / ${am} / ${ay}`:appointmentDate;
 return `<section class="screen">${screenHead("नियुक्ति पत्र","सक्रिय पदाधिकारी नियुक्ति का प्रमाणपत्र")}
 <div class="membership-certificate-paper appointment-certificate-paper"><div class="membership-certificate">
   <div class="certificate-corner certificate-corner-tl"></div><div class="certificate-corner certificate-corner-tr"></div><div class="certificate-corner certificate-corner-bl"></div><div class="certificate-corner certificate-corner-br"></div>
   <div class="certificate-header"><img class="certificate-logo" src="assets/rkms-logo-transparent.png" alt="RKMS"><div class="certificate-heading"><h1>राष्ट्रीय किसान मजदूर संगठन</h1><div class="certificate-subtitle">जय किसान — जय नौजवान</div><div class="certificate-rule"></div></div></div>
   <div class="certificate-title-box"><h2>नियुक्ति पत्र</h2></div>
   <div class="certificate-meta"><span><b>Member ID :</b> ${esc(m.member_id||"—")}</span><span><b>Appointment No. :</b> ${esc(o.appointment_no||meta.appointment_no||"—")}</span><span><b>दिनांक :</b> ${esc(issueDate)}</span></div>
   <div class="certificate-body"><p class="certificate-member-name"><span>श्री/श्रीमती</span> <b>${esc(nameWithJi)}</b></p><p class="certificate-award">को संगठन की गतिविधियों एवं उद्देश्यों को ध्यान में रखते हुए <b>${esc(designation)}</b> के पद पर नियुक्त किया जाता है।</p><p><b>पिता / पति का नाम:</b> ${esc(m.father_name||"—")}</p><p>आप संगठन के नियमों, अनुशासन एवं संविधान का पालन करते हुए संगठन के हित में ईमानदारी, निष्ठा और समर्पण के साथ कार्य करेंगे तथा संगठन को मजबूत बनाने में अपना योगदान देंगे।</p></div>
   <div class="certificate-slogan">जय किसान | जय मजदूर | जय नौजवान</div>
   <div class="certificate-signatures"><div class="certificate-sign">${signerSig?`<img class="certificate-digital-signature" src="${esc(signerSig)}" alt="नियुक्तिकर्ता अधिकारी का Digital Signature" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling?.classList.add('signature-missing');">`:`<div class="signature-line"></div>`}<b>${esc(appointedName)}</b><small>${esc(appointedPost||"नियुक्तिकर्ता अधिकारी")}<br>नियुक्तिकर्ता अधिकारी</small></div></div>
 </div></div><div class="actions"><button class="btn" onclick="window.print()">🖨️ नियुक्ति पत्र Print / PDF</button></div></section>`;
}

async function renderComplaint(){
 await refreshIdentity();if(!state.member||state.member.status!=="APPROVED")return `<section class="screen">${screenHead("शिकायत")}${cardEmpty("शिकायत दर्ज करने के लिए APPROVED सदस्य का login जरूरी है।")}</section>`;
 const m=state.member;
 return `<section class="screen">${screenHead("शिकायत दर्ज करें","आपका नाम, मोबाइल और क्षेत्र member profile से लिए जाएंगे")}<div class="card"><div class="detail-list"><div><b>सदस्य:</b> ${esc(m.name)} · ${esc(m.mobile)}</div><div><b>क्षेत्र:</b> ${esc([m.state,m.district,m.tehsil,m.block,m.village].filter(Boolean).join(" / "))}</div></div><div class="form-grid" style="margin-top:16px"><label class="field">श्रेणी*<input id="c_category" placeholder="जैसे भूमि, भुगतान, प्रशासन"></label><label class="field">विषय*<input id="c_subject"></label><label class="field full">विवरण*<textarea id="c_description" rows="7"></textarea></label></div><div id="complaintMsg" class="msg"></div><button id="complaintSubmit" class="btn">शिकायत भेजें</button></div></section>`;
}
async function submitComplaint(){
 const msg=document.querySelector("#complaintMsg");try{await refreshIdentity();const m=state.member;if(!m)throw new Error("Member login जरूरी है");const r=await rpc("rkms_register_complaint",{p_member_id:m.id,p_state:m.state,p_mandal:m.mandal,p_district:m.district,p_tehsil:m.tehsil,p_block:m.block,p_village:m.village,p_category:val("c_category"),p_subject:val("c_subject"),p_description:val("c_description"),p_photo_url:null,p_document_url:null});if(!r?.success)throw new Error(r.message);msg.className="msg ok";msg.textContent=`शिकायत दर्ज हो गई: ${r.complaint_id||""}`;document.querySelector("#complaintSubmit").disabled=true}catch(e){msg.className="msg err";msg.textContent=e.message}}
async function renderMyComplaints(){
 await refreshIdentity();if(!state.member)return loginScreen();
 let rows=[];try{rows=arrOf(await rpc("rkms_get_current_member_complaints",{p_search:"",p_status:""}))}catch(e){return `<section class="screen">${screenHead("मेरी शिकायतें")}${cardEmpty(e.message)}</section>`}
 return `<section class="screen">${screenHead("मेरी शिकायतें","अपनी शिकायत की स्थिति और history") }<div class="grid">${rows.map(c=>`<article class="card"><span class="status">${esc(c.status||"")}</span><h3>${esc(c.complaint_id||"Complaint")}</h3><p><b>${esc(c.subject||"")}</b></p><p>${esc(c.created_at||"")}</p><button class="btn small" data-member-complaint="${esc(c.id)}">विवरण</button></article>`).join("")||cardEmpty("अभी कोई शिकायत नहीं है।")}</div></section>`;
}
async function renderMemberComplaintDetail(id){
 
 let r;try{r=await rpc("rkms_get_current_member_complaint_details",{p_complaint_id:id})}catch(e){return `<section class="screen">${screenHead("शिकायत विवरण")}${cardEmpty(e.message)}</section>`}
 const c=r?.data||{};let h=[];try{h=arrOf(await rpc("rkms_get_current_member_complaint_history",{p_complaint_id:id}))}catch{}
 return `<section class="screen">${screenHead("शिकायत विवरण")}<div class="card"><span class="status">${esc(c.status||"")}</span><h2>${esc(c.complaint_id||"")}</h2><h3>${esc(c.subject||"")}</h3><p class="lead">${esc(c.description||"")}</p><h3>History</h3><div class="grid">${h.map(x=>`<div class="card"><b>${esc(x.new_status||"")}</b><p>${esc(x.remarks||"")}</p><small>${esc(x.created_at||"")}</small></div>`).join("")||cardEmpty("History उपलब्ध नहीं है।")}</div></div></section>`;
}

function bookScreen(){
 const p=Math.min(60,Math.max(1,state.bookPage));const src=p===1?"assets/book/cover.jpg":`assets/book/page-${String(p).padStart(2,"0")}.jpg`;const saved=Number(localStorage.getItem("rkms_book_page")||1);
 return `<section class="book-reader"><div class="screen-head"><div><span class="eyebrow" style="color:#8de0b4">पुस्तक</span><h1 class="screen-title" style="color:#fff">एक जिंदगी किसानों के नाम</h1><p style="color:#b9c8c1">V. M. Singh</p></div><button class="btn ghost" data-route="home">← वापस</button></div>
 ${saved>1&&saved!==p?`<div class="resume-box">आपने पिछली बार पृष्ठ ${saved} पर पढ़ना छोड़ा था। <button class="btn small" id="resumeBook">जहाँ छोड़ा था वहीं से पढ़ें</button></div>`:""}
 <div class="book-page-wrap"><img id="bookPage" class="book-page" src="${src}" alt="पृष्ठ ${p}" decoding="async"></div>
 <div class="book-controls"><button class="btn" id="bookFirst">पहला</button><button class="btn" id="bookPrev">← पिछला</button><button class="btn" id="bookNext">अगला →</button><button class="btn" id="bookLast">अंतिम</button></div>
 <div class="book-page-wrap"><div style="display:flex;justify-content:space-between"><span id="bookPageLabel">पृष्ठ ${p} / 60</span><span>जहाँ छोड़ेंगे, वहीं save होगा</span></div><div class="book-progress"><span id="bookProgressBar" style="width:${p/60*100}%"></span></div></div></section>`;
}


function bookPageSrc(page){
 const p=Math.min(60,Math.max(1,Number(page)||1));
 return p===1?"assets/book/cover.jpg":`assets/book/page-${String(p).padStart(2,"0")}.jpg`;
}
function rkmsPreloadBookPage(page){
 const p=Math.min(60,Math.max(1,Number(page)||1));
 if(window.__rkmsBookPreloadCache?.[p]) return Promise.resolve(true);
 window.__rkmsBookPreloadCache=window.__rkmsBookPreloadCache||{};
 return new Promise(resolve=>{
   const img=new Image();
   img.onload=()=>{window.__rkmsBookPreloadCache[p]=img;resolve(true);};
   img.onerror=()=>resolve(false);
   img.src=bookPageSrc(p);
 });
}
function rkmsPreloadAdjacentBookPages(page,total=60){
 const p=Number(page)||1,t=Math.min(60,Number(total)||60);
 const jobs=[];
 if(p<t)jobs.push(rkmsPreloadBookPage(p+1));
 if(p>1)jobs.push(rkmsPreloadBookPage(p-1));
 return Promise.all(jobs);
}
function bindBook(){
 const applyPage=async p=>{
   const target=Math.min(60,Math.max(1,Number(p)||1));
   if(target===state.bookPage&&document.querySelector("#bookPage")){rkmsPreloadAdjacentBookPages(target,60);return;}
   const img=document.querySelector("#bookPage");
   const controls=[...document.querySelectorAll("#bookFirst,#bookPrev,#bookNext,#bookLast")];
   controls.forEach(b=>b.disabled=true);
   try{
     const ok=await rkmsPreloadBookPage(target);
     if(!ok)throw new Error("load");
     if(img){
       img.classList.add("book-page-switching");
       img.src=bookPageSrc(target);
       img.alt=`पृष्ठ ${target}`;
       img.onload=()=>img.classList.remove("book-page-switching");
     }
     state.bookPage=target;
     localStorage.setItem("rkms_book_page",target);
     const label=document.querySelector("#bookPageLabel");if(label)label.textContent=`पृष्ठ ${target} / 60`;
     const bar=document.querySelector("#bookProgressBar");if(bar)bar.style.width=`${target/60*100}%`;
     document.dispatchEvent(new CustomEvent("rkms:book-page-rendered",{detail:{page:target,totalPages:60}}));
   }catch(e){
     if(typeof toast==="function")toast("पुस्तक का पृष्ठ लोड नहीं हो पाया। पिछला पृष्ठ सुरक्षित है।");
   }finally{controls.forEach(b=>b.disabled=false);}
 };
 document.querySelector("#bookFirst")?.addEventListener("click",()=>applyPage(1));
 document.querySelector("#bookPrev")?.addEventListener("click",()=>applyPage(state.bookPage-1));
 document.querySelector("#bookNext")?.addEventListener("click",()=>applyPage(state.bookPage+1));
 document.querySelector("#bookLast")?.addEventListener("click",()=>applyPage(60));
 document.querySelector("#resumeBook")?.addEventListener("click",()=>applyPage(Number(localStorage.getItem("rkms_book_page")||1)));
 rkmsPreloadBookPage(state.bookPage+1);
 rkmsPreloadBookPage(state.bookPage-1);
}

async function contentScreen(kind,title,subtitle,renderCard){
 let rows=[];
 try{
  if(kind==="notifications"){
    if(token()){await refreshIdentity();rows=await loadPriorityNotifications(60);}
    else{const r=await rpc("rkms_get_public_notifications",{p_limit:60});rows=arrOf(r,"notifications");}
  }else{const map={news:["rkms_get_news",{p_limit:50}],events:["rkms_get_events",{p_limit:50}],gallery:["rkms_get_gallery",{p_limit:60}],documents:["rkms_get_documents",{p_category:null,p_limit:60}],reports:["rkms_get_reports",{p_year:null,p_limit:50}],campaigns:["rkms_get_campaigns",{p_limit:50}]};rows=arrOf(await rpc(map[kind][0],map[kind][1]));}
 }catch{}
 return `<section class="screen">${screenHead(title,subtitle)}<div class="grid">${rows.map(renderCard).join("")||cardEmpty("अभी कोई प्रकाशित सामग्री उपलब्ध नहीं है।")}</div></section>`;
}
function newsCard(x){return `<article class="card">${x.image_url?`<img src="${esc(x.image_url)}" style="width:100%;max-height:260px;object-fit:cover;border-radius:14px">`:""}<span class="eyebrow">${esc(x.category||"समाचार")}</span><h3>${esc(x.title)}</h3><p>${esc(x.body||"")}</p>${x.location?`<small>📍 ${esc(x.location)}</small>`:""}</article>`}
function eventCard(x){return `<article class="card">${x.image_url?`<img src="${esc(x.image_url)}" style="width:100%;max-height:260px;object-fit:cover;border-radius:14px">`:""}<h3>${esc(x.title)}</h3><p>${esc(x.description||"")}</p><p><b>${esc(x.event_date||"")}</b> ${esc(x.event_time||"")}</p><p>${esc(x.location||"")}</p></article>`}
function galleryCard(x){return `<article class="card">${x.media_type==="VIDEO"?`<video controls style="width:100%;border-radius:14px" src="${esc(x.media_url)}"></video>`:`<img loading="lazy" style="width:100%;border-radius:14px" src="${esc(x.media_url)}">`}<h3>${esc(x.title||"")}</h3><p>${esc(x.description||"")}</p></article>`}
function docCard(x){return `<article class="card"><h3>📄 ${esc(x.title)}</h3><p>${esc(x.description||"")}</p><a class="btn" target="_blank" rel="noopener" href="${esc(x.file_url)}">दस्तावेज खोलें</a></article>`}
async function renderOrganizationReports(){
 let members=0,officers=0,pending=0,approvedRows=[];
 try{const r=await rpc("rkms_approved_member_count");members=Number(dataOf(r)?.count??dataOf(r)??0)}catch{}
 try{officers=(await publicOfficers()).length}catch{}
 try{const r=await rpc("rkms_pending_member_count");pending=Number(dataOf(r)?.count??dataOf(r)??0)}catch{}
 try{approvedRows=await loadApprovedMembersCached()}catch{}
 const officerRows=state.dir.length?state.dir:await publicOfficers();
 const group=(rows,key)=>Object.entries(rows.reduce((a,x)=>{const k=String(x?.[key]||"अनिर्धारित");a[k]=(a[k]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]);
 const memberGroups={state:group(approvedRows,"state"),mandal:group(approvedRows,"mandal"),district:group(approvedRows,"district"),tehsil:group(approvedRows,"tehsil"),block:group(approvedRows,"block"),village:group(approvedRows,"village")};
 const officerGroups={state:group(officerRows,"state"),mandal:group(officerRows,"mandal"),district:group(officerRows,"district"),tehsil:group(officerRows,"tehsil"),block:group(officerRows,"block"),village:group(officerRows,"village")};
 const wingCount=(needle)=>officerRows.filter(x=>String(x?.post_name||"").toLowerCase().includes(needle)).length;
 const wingCards=`<div class="grid report-wing-grid"><div class="card count-card"><span>महिला Wing</span><b>${wingCount("महिला")}</b></div><div class="card count-card"><span>युवा Wing</span><b>${wingCount("युवा")}</b></div><div class="card count-card"><span>IT Cell</span><b>${officerRows.filter(x=>x?.is_it_cell===true||String(x?.post_name||"").toLowerCase().includes("it")).length}</b></div></div>`;
 const rowsHtml=(title,rows)=>`<div class="card"><h3>${esc(title)}</h3>${rows.slice(0,30).map(([n,c])=>`<div class="list-row"><b>${esc(n)}</b><span>${c}</span></div>`).join("")||cardEmpty("कोई आँकड़ा उपलब्ध नहीं है।")}</div>`;
 return `<section class="screen">${screenHead("संगठन की Reports","Live Supabase आंकड़े — static/fake संख्या नहीं")}
 <div class="grid"><div class="card count-card"><span>कुल Approved सदस्य</span><b>${members}</b></div><div class="card count-card"><span>कुल सक्रिय पदाधिकारी</span><b>${officers}</b></div><div class="card count-card"><span>Pending सदस्य</span><b>${pending}</b></div></div>
 ${wingCards}<div class="grid report-detail-grid" style="margin-top:16px"><div><h2>सदस्य — क्षेत्रवार</h2>${rowsHtml("State-wise",memberGroups.state)}${rowsHtml("Mandal-wise",memberGroups.mandal)}${rowsHtml("District-wise",memberGroups.district)}${rowsHtml("Tehsil-wise",memberGroups.tehsil)}${rowsHtml("Block-wise",memberGroups.block)}${rowsHtml("Village-wise",memberGroups.village)}</div><div><h2>सक्रिय पदाधिकारी — क्षेत्रवार</h2>${rowsHtml("State-wise",officerGroups.state)}${rowsHtml("Mandal-wise",officerGroups.mandal)}${rowsHtml("District-wise",officerGroups.district)}${rowsHtml("Tehsil-wise",officerGroups.tehsil)}${rowsHtml("Block-wise",officerGroups.block)}${rowsHtml("Village-wise",officerGroups.village)}</div></div></section>`;
}
function reportCard(x){return `<article class="card"><h3>📊 ${esc(x.title)}</h3><p>${esc(x.report_type||"")} · ${esc(x.report_year||"")}</p><p>${esc(x.description||"")}</p>${x.file_url?`<a class="btn" target="_blank" rel="noopener" href="${esc(x.file_url)}">रिपोर्ट खोलें</a>`:""}</article>`}
function campaignCard(x){return `<article class="card"><h3>${esc(x.title)}</h3><p>${esc(x.description||"")}</p><p>${esc(x.demands||"")}</p><p>${esc(x.start_date||"")} — ${esc(x.end_date||"")}</p></article>`}
function notificationPriority(x,region){
 const target=String(x.target_type||"ALL").toUpperCase(),v=String(x.target_value||"").trim().toLowerCase();
 if(target==="ALL")return 50;
 const field={STATE:"state",MANDAL:"mandal",DISTRICT:"district",TEHSIL:"tehsil",BLOCK:"block"}[target];
 if(field&&String(region?.[field]||"").trim().toLowerCase()===v)return ({DISTRICT:0,MANDAL:1,STATE:2,TEHSIL:3,BLOCK:4}[target]??10);
 return 40;
}
async function loadPriorityNotifications(limit=6){
 let rows=[];
 try{
   if(token()){
     const r=await rpc("rkms_get_targeted_notifications",{p_limit:Math.max(limit,20)});
     rows=arrOf(r,"notifications");
   }else{
     const r=await rpc("rkms_get_public_notifications",{p_limit:Math.max(limit,20)});
     rows=arrOf(r,"notifications");
   }
 }catch{return []}
 const region=state.member||state.officer||{};
 return rows.sort((a,b)=>{const pa=notificationPriority(a,region),pb=notificationPriority(b,region);if(pa!==pb)return pa-pb;return new Date(b.created_at||0)-new Date(a.created_at||0)}).slice(0,limit);
}
function notificationCard(x){return `<article class="card"><span class="status ${x.is_important?"amber":""}">${x.is_public?"🌐 सार्वजनिक":"🔒 संगठनात्मक"}${x.is_important?" · महत्वपूर्ण":""}</span><h3>${esc(x.title)}</h3><p>${esc(x.body||"")}</p><small>${esc(x.target_type||"ALL")}${x.target_value?` · ${esc(x.target_value)}`:""}</small></article>`}

async function adminScreen(){
 if(state.role!=="super_admin"){
   try{await refreshIdentity()}catch{}
 }
 if(state.role!=="super_admin")return loginScreen();

 let members=0,officers=0,pending=0;
 try{const r=await rpc("rkms_approved_member_count");members=Number(dataOf(r)?.count??dataOf(r)??0)}catch{}
 try{officers=(await publicOfficers()).length}catch{}
 try{const r=await rpc("rkms_pending_member_count");pending=Number(dataOf(r)?.count??dataOf(r)??0)}catch{}

 const roleLabel="Super Admin";

 return `<section class="screen admin-dashboard">
   <div class="pro-admin-hero">
     <div class="pro-admin-brand">
       <span class="pro-admin-kicker">RKMS • CONTROL CENTER</span>
       <h1>संगठन प्रबंधन</h1>
       <p>सदस्य, पदाधिकारी, नियुक्ति, संपर्क और संगठन की पूरी जानकारी एक व्यवस्थित स्थान पर।</p>
     </div>
     <div class="pro-role">
       <span class="pro-role-icon">🛡️</span>
       <div><small>लॉगिन भूमिका</small><b>${esc(roleLabel)}</b></div>
     </div>
   </div>

   <div class="pro-stat-grid">
     <button class="pro-stat-card" data-route="member-list">
       <span class="pro-stat-icon">👥</span><span class="pro-stat-label">कुल सदस्य</span>
       <strong>${members}</strong><small>Live database</small>
     </button>
     <button class="pro-stat-card" data-route="active-officers">
       <span class="pro-stat-icon">👤</span><span class="pro-stat-label">कुल सक्रिय पदाधिकारी</span>
       <strong>${officers}</strong><small>Active only</small>
     </button>
     <button class="pro-stat-card pro-stat-warning" data-route="pending">
       <span class="pro-stat-icon">⏳</span><span class="pro-stat-label">Pending Approval</span>
       <strong>${pending}</strong><small>कार्रवाई आवश्यक</small>
     </button>
     <button class="pro-stat-card" data-route="reports">
       <span class="pro-stat-icon">📊</span><span class="pro-stat-label">संगठन Reports</span>
       <strong>देखें</strong><small>क्षेत्रवार आंकड़े</small>
     </button>
   </div>

   <div class="pro-section-head">
     <div><span class="pro-section-kicker">MANAGEMENT</span><h2>मुख्य प्रबंधन</h2></div>
     <p>हर काम के लिए अलग और स्पष्ट विकल्प</p>
   </div>

   <div class="pro-action-grid">
     <button class="pro-action-card pro-action-primary" data-route="pending">
       <span class="pro-action-icon">✓</span><div><b>सदस्य Approval</b><small>Pending सदस्य देखें, Approve या Reject करें</small></div><span class="pro-arrow">›</span>
     </button>
     <button class="pro-action-card pro-action-primary" data-route="appointment">
       <span class="pro-action-icon">👤</span><div><b>पदाधिकारी प्रबंधन</b><small>नियुक्त करें • पद बदलें • पद से हटाएँ • History</small></div><span class="pro-arrow">›</span>
     </button>
     <button class="pro-action-card" data-route="directory">
       <span class="pro-action-icon">🔎</span><div><b>पदाधिकारी खोजें</b><small>State → Mandal → District → Tehsil → Block → Village</small></div><span class="pro-arrow">›</span>
     </button>
     <button class="pro-action-card" data-route="password-reset-requests">
       <span class="pro-action-icon">🔐</span><div><b>Password Reset Requests</b><small>सदस्य के reset request को Approve/Reject करें</small></div><span class="pro-arrow">›</span>
     </button>
     <button class="pro-action-card" data-route="member-list">
       <span class="pro-action-icon">🗑️</span><div><b>Member Delete</b><small>सदस्य चुनें • Password verify • Confirmation • Delete Audit</small></div><span class="pro-arrow">›</span>
     </button>
     <button class="pro-action-card" data-route="reports">
       <span class="pro-action-icon">📊</span><div><b>संगठन की Reports</b><small>सदस्य और पदाधिकारी के live क्षेत्रवार आंकड़े</small></div><span class="pro-arrow">›</span>
     </button>
     <button class="pro-action-card" data-route="directory">
       <span class="pro-action-icon">📞</span><div><b>संपर्क करें</b><small>State, Mandal, District, Tehsil, Block के अधिकारी खोजें और Call करें</small></div><span class="pro-arrow">›</span>
     </button>
     <button class="pro-action-card" data-route="login-slogans">
       <span class="pro-action-icon">📢</span><div><b>Login Slogan Management</b><small>सदस्य Login पर 1–10 slogans जोड़ें, बदलें और क्रम से चलाएँ</small></div><span class="pro-arrow">›</span>
     </button>
     <button type="button" class="pro-action-card" data-route="content-management">
       <span class="pro-action-icon">📰</span><div><b>Content Management</b><small>News • Events • Gallery • Documents</small></div><span class="pro-arrow">›</span>
     </button>
   </div>

   <div class="pro-section-head pro-section-head-tight">
     <div><span class="pro-section-kicker">ORGANIZATION</span><h2>संगठन के क्षेत्र</h2></div>
     <p>हर स्तर के पदाधिकारी अलग देखें</p>
   </div>
   <div class="pro-level-grid">
     <button data-route="directory"><span>🏛️</span><b>State</b><small>राज्य स्तर</small></button>
     <button data-route="directory"><span>🗺️</span><b>Mandal</b><small>मंडलवार अधिकारी</small></button>
     <button data-route="directory"><span>📍</span><b>District</b><small>जिलावार अधिकारी</small></button>
     <button data-route="directory"><span>🏢</span><b>Tehsil</b><small>तहसीलवार अधिकारी</small></button>
     <button data-route="directory"><span>🏘️</span><b>Block</b><small>ब्लॉकवार अधिकारी</small></button>
     <button data-route="directory"><span>🏠</span><b>Village</b><small>ग्रामवार अधिकारी</small></button>
   </div>

   <div class="pro-bottom-grid">
     <button class="pro-secondary-card" data-route="organization"><span>⚙️</span><div><b>Organization Settings</b><small>संगठन की मूल जानकारी</small></div></button>
     <button class="pro-secondary-card" data-route="security-audit"><span>🔐</span><div><b>Security & Delete Audit</b><small>सुरक्षा और Delete history</small></div></button>
     <button class="pro-secondary-card danger-card" id="adminLogout"><span>↪</span><div><b>Logout</b><small>सुरक्षित रूप से बाहर निकलें</small></div></button>
   </div>

   <div id="adminPanel" class="admin-panel"></div>
 </section>`;
}
async function loadDeleteAudit(){
 const box=document.querySelector("#deleteAuditList");if(!box)return;
 try{const r=await request(`${SUPA}/functions/v1/rkms-member-delete-audit`,{method:"POST",headers:authHeaders(),body:JSON.stringify({limit:100})});if(!r?.success)throw new Error(r?.message||"Audit नहीं खुला।");box.innerHTML=(r.rows||[]).map(a=>`<article class="card" style="padding:12px;margin-bottom:10px"><b>${esc(a.deleted_member_name||"सदस्य")}</b><div class="detail-list"><div>Member ID: ${esc(a.deleted_member_id||"—")}</div><div>Delete करने वाले: ${esc(a.deleter_name||"—")}</div><div>पद/स्तर: ${esc(a.deleter_authority_level||"—")}</div><div>क्षेत्र: ${esc([a.deleter_state,a.deleter_mandal,a.deleter_district].filter(Boolean).join(" / ")||"—")}</div><div>समय: ${esc(a.deleted_at||"—")}</div></div></article>`).join("")||cardEmpty("अभी कोई Delete Audit record नहीं है।")}catch(e){box.innerHTML=`<div class="msg err">${esc(e.message||"Audit नहीं खुला।")}</div>`}
}
async function renderAdminPanel(tab="content"){
 const p=document.querySelector("#adminPanel");if(!p)return;
 if(tab==="members"){await refreshIdentity(); let canDelete=state.role==="super_admin"; if(!canDelete && state.role==="officer"){try{const o=dataOf(await rpc("rkms_get_current_officer_profile")).officer; const lvl=String(o?.authority_level||o?.level||"").toUpperCase(); canDelete=["NATIONAL","STATE","MANDAL","DISTRICT"].includes(lvl)}catch{}}; window.rkmsCanDeleteMembers=canDelete; p.innerHTML=`<div class="card"><h2>Members</h2><p class="note">${canDelete?"सदस्य को हटाने के लिए पहले checkbox ✓ करें। फिर Delete दबाकर पुष्टि में checkbox tick करके <b>हाँ, Delete करें</b> चुनें।":"इस स्तर के अधिकारी को सदस्य Delete करने का अधिकार नहीं है।"}</p><div class="search"><input id="pendingQ" placeholder="नाम/मोबाइल/जिला"><button class="btn" id="pendingSearch">खोजें</button></div><div id="pendingRows" class="grid" style="margin-top:14px"></div></div>`;loadPending();return}
 if(tab==="appointment"){p.innerHTML=appointmentPanel(true);await setupAppointment(true);return}
 if(tab==="organization"){p.innerHTML=organizationAdmin();bindOrganizationAdmin();return}
 if(tab==="security"){p.innerHTML=`<div class="card"><h2>सुरक्षा स्थिति</h2><p>Delete के लिए password re-verification जरूरी है। Delete करने वाले अधिकारी का record सुरक्षित Delete Audit में रहता है।</p><div id="deleteAuditList" style="margin-top:14px"><div class="note">Delete Audit लोड हो रहा है…</div></div></div>`;loadDeleteAudit();return}
 p.innerHTML=contentAdmin();
 bindContentAdmin();
}
function contentAdmin(allowedTypes=null){
 const all=["flash","news","gallery","documents","reports","events","campaigns","leadership","notifications"];
 const types=Array.isArray(allowedTypes)?all.filter(x=>allowedTypes.includes(x)):all;
 const labels={flash:"Flash",news:"समाचार",gallery:"फोटो/मीडिया गैलरी",documents:"प्रकाशित दस्तावेज",reports:"Reports",events:"कार्यक्रम",campaigns:"अभियान",leadership:"Leadership",notifications:"Notifications"};
 return `<div class="card"><h2>मोबाइल Content Management</h2><p class="note">अधिकृत पदाधिकारी अपने permission के अनुसार यहाँ से <b>कार्यक्रम, समाचार, Flash, फोटो/मीडिया गैलरी और प्रकाशित दस्तावेज</b> जोड़, बदल और हटाए जा सकते हैं। Backend भी permission की जाँच करेगा।</p><div class="admin-tabs" id="contentTabs">${types.map(x=>`<button data-content-tab="${x}">${labels[x]}</button>`).join("")}</div><div id="contentForm" class="admin-panel"></div><div id="contentList" class="admin-panel" style="margin-top:18px"></div></div>`
}
function bindContentAdmin(defaultType=null){document.querySelectorAll("[data-content-tab]").forEach(b=>b.onclick=()=>showContentForm(b.dataset.contentTab));const first=defaultType&&document.querySelector(`[data-content-tab="${defaultType}"]`)?.dataset.contentTab||document.querySelector("[data-content-tab]")?.dataset.contentTab;if(first)showContentForm(first)}
async function renderOfficerContentManagement(){
 await refreshIdentity();
 if(state.role!=="officer" && state.role!=="super_admin")return loginScreen();
 const labels={flash:"Flash",news:"समाचार",gallery:"फोटो/मीडिया गैलरी",documents:"प्रकाशित दस्तावेज",events:"कार्यक्रम",reports:"Reports",campaigns:"अभियान",leadership:"Leadership",notifications:"Notifications"};
 let allowed=[];
 if(state.role==="super_admin") allowed=Object.keys(labels);
 else {
  try{
   const r=await rpc("rkms_get_my_content_permissions");
   if(r?.success===false)throw new Error(r.message||"Content permission नहीं मिला।");
   allowed=arrOf(r,"permissions").filter(x=>x?.can_manage).map(x=>String(x.content_type||"").toLowerCase()).filter(x=>['events','news','flash','gallery','documents'].includes(x));if(!allowed.includes('notifications'))allowed.push('notifications');
  }catch(e){return `<section class="screen">${screenHead("Content Management","पदाधिकारी के लिए अधिकृत Content Management")}<div class="msg err">${esc(e.message||"Content permission नहीं मिली।")}</div></section>`}
 }
 if(!allowed.length)return `<section class="screen">${screenHead("Content Management","पदाधिकारी के लिए अधिकृत Content Management")}<div class="card"><h2>कोई Content Permission नहीं</h2><p class="note">आपको अभी कार्यक्रम, समाचार, Flash, गैलरी या दस्तावेज बदलने की permission नहीं दी गई है।</p></div></section>`;
 return `<section class="screen">${screenHead("Content Management","अपने अधिकार के अनुसार प्रकाशित सामग्री जोड़ें, बदलें या हटाएँ")}${contentAdmin(allowed)}</section>`;
}
function contentMeta(type){return ({flash:["rkms_get_active_flash",{p_limit:50}],news:["rkms_get_news",{p_limit:50}],gallery:["rkms_get_gallery",{p_limit:60}],documents:["rkms_get_documents",{p_category:null,p_limit:60}],reports:["rkms_get_reports",{p_year:null,p_limit:60}],events:["rkms_get_events",{p_limit:60}],campaigns:["rkms_get_campaigns",{p_limit:60}],leadership:["rkms_get_leadership",{p_level:null,p_state:null,p_limit:60}],notifications:["rkms_get_notifications",{p_limit:60}]}[type]||[])}
function contentLabel(type){return ({flash:"Flash",news:"समाचार",gallery:"गैलरी",documents:"दस्तावेज",reports:"रिपोर्ट",events:"कार्यक्रम",campaigns:"अभियान",leadership:"नेतृत्व",notifications:"सूचनाएँ"}[type]||type)}
function contentRowSummary(type,x){
 if(type==="flash")return `<b>${esc(x.title||"बिना शीर्षक")}</b><small>${esc(x.start_at||"")} → ${esc(x.end_at||"")}</small>`;
 if(type==="events")return `<b>${esc(x.title||"बिना शीर्षक")}</b><small>${esc(x.event_date||"")} ${esc(x.event_time||"")} · ${esc(x.location||"")}</small>`;
 if(type==="gallery")return `<b>${esc(x.title||"बिना शीर्षक")}</b><small>${esc(x.album||"")} · ${esc(x.media_type||"")}</small>`;
 if(type==="documents")return `<b>${esc(x.title||"बिना शीर्षक")}</b><small>${esc(x.category||"")}</small>`;
 if(type==="reports")return `<b>${esc(x.title||"बिना शीर्षक")}</b><small>${esc(x.report_type||"")} · ${esc(x.report_year||"")}</small>`;
 if(type==="leadership")return `<b>${esc(x.name||"बिना नाम")}</b><small>${esc(x.post_name||"")} · ${esc(x.level||"")}</small>`;
 if(type==="notifications")return `<b>${esc(x.title||"बिना शीर्षक")}</b><small>${esc(x.notification_type||"")} · ${x.is_important?"महत्वपूर्ण":"सामान्य"}</small>`;
 return `<b>${esc(x.title||"बिना शीर्षक")}</b><small>${esc(x.category||x.description||"")}</small>`;
}
function contentListCard(type,x){return `<article class="card" style="padding:14px"><div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start"><div style="min-width:0">${contentRowSummary(type,x)}${x.image_url?`<img src="${esc(x.image_url)}" alt="" style="display:block;width:90px;height:60px;object-fit:cover;border-radius:8px;margin-top:8px">`:x.media_url&&x.media_type!=="VIDEO"?`<img src="${esc(x.media_url)}" alt="" style="display:block;width:90px;height:60px;object-fit:cover;border-radius:8px;margin-top:8px">`:``}</div><div class="actions" style="flex-shrink:0"><button class="btn small" data-content-edit="${esc(type)}" data-content-id="${esc(x.id)}">✏️ Edit</button><button class="btn small danger" data-content-delete="${esc(type)}" data-content-id="${esc(x.id)}">🗑️ Delete</button></div></div></article>`}
async function loadContentList(type){
 const p=document.querySelector("#contentList");if(!p)return;
 p.innerHTML=`<div class="card"><h3>${contentLabel(type)} — प्रकाशित सामग्री</h3><p class="note">लोड हो रहा है…</p></div>`;
 try{
  let rows=[];
  if(type==="flash"){
   const all=await rpc("rkms_get_flash_messages",{p_limit:60});
   rows=arrOf(all);
  }else{const meta=contentMeta(type);rows=arrOf(await rpc(meta[0],meta[1]));}
  p.innerHTML=`<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h3 style="margin:0">${contentLabel(type)} — पहले से मौजूद</h3><span class="status">${rows.length}</span></div><div class="grid" style="margin-top:12px">${rows.map(x=>contentListCard(type,x)).join("")||cardEmpty(`अभी कोई ${contentLabel(type)} उपलब्ध नहीं है।`)}</div></div>`;
  p.querySelectorAll("[data-content-edit]").forEach(b=>b.onclick=async()=>{await showContentForm(type,b.dataset.contentId)});
  p.querySelectorAll("[data-content-delete]").forEach(b=>b.onclick=()=>deleteContent(type,b.dataset.contentId));
 }catch(e){p.innerHTML=`<div class="card"><div class="msg err">${esc(e.message||"List load नहीं हुई।")}</div></div>`}
}
function isoLocal(v){if(!v)return "";const d=new Date(v);if(Number.isNaN(d.getTime()))return "";const pad=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
async function showContentForm(type,editId=null){
 const p=document.querySelector("#contentForm");if(!p)return;
 const forms={
 flash:`<h3>${editId?"Flash Edit करें":"नई Opening Flash"}</h3><div class="form-grid"><label class="field">Title<input id="f_title"></label><label class="field">Photo <small>(एक से अधिक फोटो चुनें)</small><input id="f_file" type="file" accept="image/*" multiple></label><label class="field full">Text<textarea id="f_body" rows="4"></textarea></label><label class="field">Start Date/Time<input id="f_start" type="datetime-local"></label><label class="field">End Date/Time<input id="f_end" type="datetime-local"></label></div>`,
 news:`<h3>${editId?"News Edit करें":"News"}</h3><div class="form-grid"><label class="field">Title<input id="n_title"></label><label class="field">Category<input id="n_category"></label><label class="field full">Text<textarea id="n_body" rows="5"></textarea></label><label class="field">Location<input id="n_location"></label><label class="field">Photo<input id="n_file" type="file" accept="image/*"></label></div>`,
 gallery:`<h3>${editId?"Gallery Edit करें":"Gallery"}</h3><div class="form-grid"><label class="field">Title<input id="g_title"></label><label class="field">Album<input id="g_album"></label><label class="field">Photo/Video<input id="g_file" type="file" accept="image/*,video/*"></label><label class="field full">Description<textarea id="g_desc"></textarea></label></div>`,
 documents:`<h3>${editId?"Document Edit करें":"Documents"}</h3><div class="form-grid"><label class="field">Title<input id="d_title"></label><label class="field">Category<input id="d_category"></label><label class="field full">Description<textarea id="d_desc"></textarea></label><label class="field full">PDF/File<input id="d_file" type="file" accept=".pdf,image/*"></label></div>`,
 reports:`<h3>${editId?"Report Edit करें":"Reports"}</h3><div class="form-grid"><label class="field">Title<input id="r_title"></label><label class="field">Report Type<input id="r_type"></label><label class="field">Year<input id="r_year" type="number"></label><label class="field">PDF<input id="r_file" type="file" accept=".pdf"></label><label class="field full">Description<textarea id="r_desc"></textarea></label></div>`,
 events:`<h3>${editId?"कार्यक्रम Edit करें":"कार्यक्रम"}</h3><div class="form-grid"><label class="field">Title<input id="e_title"></label><label class="field">Date<input id="e_date" type="date"></label><label class="field">Time<input id="e_time" type="time"></label><label class="field">Location<input id="e_location"></label><label class="field">Poster<input id="e_file" type="file" accept="image/*"></label><label class="field full">Description<textarea id="e_desc"></textarea></label></div>`,
 campaigns:`<h3>${editId?"Campaign Edit करें":"Campaign"}</h3><div class="form-grid"><label class="field">Title<input id="c2_title"></label><label class="field">Start<input id="c2_start" type="date"></label><label class="field">End<input id="c2_end" type="date"></label><label class="field">Location<input id="c2_location"></label><label class="field">Image<input id="c2_file" type="file" accept="image/*"></label><label class="field full">Description<textarea id="c2_desc"></textarea></label><label class="field full">Demands<textarea id="c2_demands"></textarea></label></div>`,
 leadership:`<h3>${editId?"Leadership Edit करें":"Leadership"}</h3><div class="form-grid"><label class="field">Name<input id="l_name"></label><label class="field">Post<input id="l_post"></label><label class="field">Level<select id="l_level"><option>NATIONAL</option><option>STATE</option><option>MANDAL</option><option>DISTRICT</option><option>TEHSIL</option><option>BLOCK</option><option>VILLAGE</option></select></label><label class="field">Photo<input id="l_file" type="file" accept="image/*"></label><label class="field">Mobile<input id="l_mobile"></label><label class="field">Email<input id="l_email" type="email"></label><label class="field full">Introduction<textarea id="l_intro"></textarea></label></div>`,
 notifications:`<h3>${editId?"सूचना Edit करें":"नई संगठन सूचना"}</h3><div class="form-grid"><label class="field">सूचना का प्रकार<select id="nt_type"><option value="GENERAL">सामान्य सूचना</option><option value="ORDER">आदेश</option><option value="CIRCULAR">परिपत्र</option><option value="MEETING">बैठक</option><option value="PROGRAM">कार्यक्रम</option><option value="URGENT">अत्यावश्यक</option></select></label><label class="field">लक्षित पद<select id="nt_post"><option value="">सभी संबंधित</option></select></label><label class="field full">शीर्षक<input id="nt_title"></label><label class="field full">विवरण<textarea id="nt_body" rows="6"></textarea></label><label class="field">प्राप्तकर्ता<select id="nt_audience"><option value="ALL">सभी योग्य सदस्य/पदाधिकारी</option><option value="MEMBERS">केवल सदस्य</option><option value="OFFICERS">केवल पदाधिकारी</option></select></label><label class="field">अधिकार क्षेत्र<select id="nt_target"><option>ALL</option><option>STATE</option><option>MANDAL</option><option>DISTRICT</option><option>TEHSIL</option><option>BLOCK</option><option>VILLAGE</option></select></label><label class="field">क्षेत्र का नाम<input id="nt_value" placeholder="Backend आपके अधिकार क्षेत्र से सत्यापित करेगा"></label><label class="field"><span>🌐 Guest को दिखाएँ</span><input id="nt_public" type="checkbox"></label><label class="field">⭐ महत्वपूर्ण <input id="nt_imp" type="checkbox"></label><div id="nt_scope_note" class="note full"></div></div>`
 };
 p.innerHTML=(forms[type]||"")+`<div id="contentMsg" class="msg"></div><div class="actions"><button class="btn" id="contentSave">${editId?"Update / Save":"Save / Publish"}</button>${editId?`<button class="btn secondary" id="contentCancel">Cancel</button>`:""}</div>`;
 p.dataset.editType=type;p.dataset.editId=editId||"";
 if(editId){
  try{
   let row=null;
   if(type==="flash"){row=arrOf(await rpc("rkms_get_flash_messages",{p_limit:60})).find(x=>String(x.id)===String(editId));}
   else{const meta=contentMeta(type);row=arrOf(await rpc(meta[0],meta[1])).find(x=>String(x.id)===String(editId));}
   if(!row)throw new Error("Record नहीं मिला।");
   const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v??""};
   if(type==="flash"){set("f_title",row.title);set("f_body",row.body);set("f_start",isoLocal(row.start_at));set("f_end",isoLocal(row.end_at));}
   if(type==="news"){set("n_title",row.title);set("n_category",row.category);set("n_body",row.body);set("n_location",row.location);}
   if(type==="gallery"){set("g_title",row.title);set("g_album",row.album);set("g_desc",row.description);}
   if(type==="documents"){set("d_title",row.title);set("d_category",row.category);set("d_desc",row.description);}
   if(type==="reports"){set("r_title",row.title);set("r_type",row.report_type);set("r_year",row.report_year);set("r_desc",row.description);}
   if(type==="events"){set("e_title",row.title);set("e_date",row.event_date);set("e_time",row.event_time);set("e_location",row.location);set("e_desc",row.description);}
   if(type==="campaigns"){set("c2_title",row.title);set("c2_start",row.start_date);set("c2_end",row.end_date);set("c2_location",row.location);set("c2_desc",row.description);set("c2_demands",row.demands);}
   if(type==="leadership"){set("l_name",row.name);set("l_post",row.post_name);set("l_level",row.level);set("l_mobile",row.mobile);set("l_email",row.email);set("l_intro",row.introduction);}
   if(type==="notifications"){set("nt_title",row.title);set("nt_type",row.notification_type||"GENERAL");set("nt_body",row.body);set("nt_target",row.target_type||"ALL");set("nt_value",row.target_value);set("nt_audience",row.target_audience||"ALL");set("nt_post",row.target_post_id||"");document.querySelector("#nt_imp").checked=!!row.is_important;document.querySelector("#nt_public").checked=!!row.is_public;}
   p.dataset.existingUrl=row.image_url||row.media_url||row.file_url||row.photo_url||"";
  }catch(e){document.querySelector("#contentMsg").className="msg err";document.querySelector("#contentMsg").textContent=e.message;}
 }else p.dataset.existingUrl="";
 if(type==="notifications"){
   try{
     const posts=arrOf(await rpc("rkms_get_posts"),"posts");
     const lvl=String(state.officer?.authority_level||"NATIONAL").toUpperCase();
     const rank={NATIONAL:0,STATE:1,MANDAL:2,DISTRICT:3,TEHSIL:4,BLOCK:5,VILLAGE:6};
     const sel=document.querySelector("#nt_post");
     if(sel)posts.filter(x=>(rank[String(x.level||"").toUpperCase()]??99)>=(rank[lvl]??0)).sort((a,b)=>String(a.post_name||"").localeCompare(String(b.post_name||""),"hi")).forEach(x=>sel.insertAdjacentHTML("beforeend",`<option value="${esc(x.id)}">${esc(x.post_name||"")} — ${esc(x.level||"")}</option>`));
     const target=document.querySelector("#nt_target"),note=document.querySelector("#nt_scope_note"),pub=document.querySelector("#nt_public");
     const allowed={NATIONAL:["ALL","STATE","MANDAL","DISTRICT","TEHSIL","BLOCK","VILLAGE"],STATE:["STATE"],MANDAL:["MANDAL"],DISTRICT:["DISTRICT"],TEHSIL:["TEHSIL"],BLOCK:["BLOCK"],VILLAGE:["VILLAGE"]}[lvl]||[];
     if(target){Array.from(target.options).forEach(op=>op.hidden=!allowed.includes(op.value));if(!allowed.includes(target.value))target.value=allowed[0]||"ALL";target.disabled=allowed.length<=1;}
     if(note){const path=[state.officer?.state,state.officer?.mandal,state.officer?.district,state.officer?.tehsil,state.officer?.block,state.officer?.village].filter(Boolean).join(" → ");note.textContent=`आपका अधिकार क्षेत्र: ${path||"राष्ट्रीय स्तर"}. Backend इसी क्षेत्र को अंतिम रूप से सत्यापित करेगा।`;}
     if(pub){pub.disabled=!['NATIONAL','STATE'].includes(lvl);if(pub.disabled)pub.checked=false;}
   }catch{}
 }
 document.querySelector("#contentSave").onclick=async e=>{if(!lockButton(e.currentTarget,"⏳ Saving…"))return;try{await saveContent(type,editId)}finally{unlockButton(e.currentTarget)}};
 document.querySelector("#contentCancel")?.addEventListener("click",()=>showContentForm(type));
 loadContentList(type);
}
async function deleteContent(type,id){
 if(!id)return;
 if(!confirm(`क्या आप यह ${contentLabel(type)} हटाना चाहते हैं?\nयह action वापस नहीं किया जा सकता।`))return;
 try{
  const fn={flash:"rkms_manage_flash",news:"rkms_manage_news",gallery:"rkms_manage_gallery",documents:"rkms_manage_documents",reports:"rkms_manage_reports",events:"rkms_manage_events",campaigns:"rkms_manage_campaigns",leadership:"rkms_manage_leadership",notifications:"rkms_manage_notifications"}[type];
  const r=await rpc(fn,{p_action:"DELETE",p_id:id,p_data:{}});if(!r?.success)throw new Error(r.message||"Delete नहीं हुआ।");toast(`${contentLabel(type)} सफलतापूर्वक हटाया गया।`);await showContentForm(type);
 }catch(e){toast(e.message||"Delete नहीं हुआ।");}
}
async function uploadFile(file, folder="uploads"){
  if(!file) throw new Error("कृपया file चुनें।");
  const max=50*1024*1024;
  if(file.size<=0 || file.size>max) throw new Error("File 1 byte से 50 MB के बीच होनी चाहिए।");
  const common=["application/pdf","image/jpeg","image/png"];
  const media=["image/webp","image/gif","video/mp4","video/webm"];
  const docs=["text/plain","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
  const allowed=folder==="documents"||folder==="reports"?[...common,...docs]:folder==="gallery"||folder==="flash"?[...common,...media]:folder==="chat"?[...common,"image/webp"]:common;
  if(!allowed.includes(file.type)){
    throw new Error("इस section के लिए यह file type स्वीकार नहीं है।");
  }
  await validateFileSignature(file,folder==="documents"||folder==="reports"?"general":folder==="gallery"||folder==="flash"?"general":"general");
  const safeFolder=String(folder||"uploads").replace(/[^a-zA-Z0-9_-]/g,"-");
  const ext=(file.name.split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"")||"bin";
  const safeName=(file.name.replace(/\.[^/.]+$/,"").replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,80)||"file");
  const path=`${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2,9)}-${safeName}.${ext}`;
  const r=await fetch(`${STORE}/object/rkms-media/${path}`,{
    method:"POST",
    headers:{apikey:ANON,Authorization:"Bearer "+token(),"Content-Type":file.type||"application/octet-stream","x-upsert":"false"},
    body:file
  });
  const t=await r.text(); let d;
  try{d=JSON.parse(t)}catch{d=t}
  if(!r.ok) throw new Error(d?.message||d?.error||d?.statusCode||t||"File upload नहीं हुई।");
  return `${SUPA}/storage/v1/object/public/rkms-media/${path}`;
}

async function saveContent(type,editId=null){
 const msg=document.querySelector("#contentMsg");msg.className="msg";msg.textContent=editId?"Updating…":"Saving…";
 try{
  let data={},fn="",file=null,files=[];
  if(type==="flash"){fn="rkms_manage_flash";files=Array.from(document.querySelector("#f_file")?.files||[]);file=files[0]||null;const sv=val("f_start"),ev=val("f_end"),st=new Date(sv),en=new Date(ev);if(!sv||!ev||Number.isNaN(st.getTime())||Number.isNaN(en.getTime()))throw new Error("Start और End Date/Time सही भरें।");if(en<=st)throw new Error("End Date/Time, Start Date/Time से आगे होना चाहिए।");data={title:val("f_title"),body:val("f_body"),start_at:st.toISOString(),end_at:en.toISOString(),published:true,image_url:""}}
  if(type==="news"){fn="rkms_manage_news";file=document.querySelector("#n_file")?.files[0];data={title:val("n_title"),body:val("n_body"),category:val("n_category"),location:val("n_location"),published:true,is_flash:false,image_url:""}}
  if(type==="gallery"){fn="rkms_manage_gallery";file=document.querySelector("#g_file")?.files[0];data={title:val("g_title"),album:val("g_album"),description:val("g_desc"),published:true,media_url:"",media_type:"IMAGE"}}
  if(type==="documents"){fn="rkms_manage_documents";file=document.querySelector("#d_file")?.files[0];data={title:val("d_title"),category:val("d_category"),description:val("d_desc"),published:true,file_url:""}}
  if(type==="reports"){fn="rkms_manage_reports";file=document.querySelector("#r_file")?.files[0];data={title:val("r_title"),report_type:val("r_type"),report_year:val("r_year"),description:val("r_desc"),published:true,file_url:""}}
  if(type==="events"){fn="rkms_manage_events";file=document.querySelector("#e_file")?.files[0];data={title:val("e_title"),event_date:val("e_date"),event_time:val("e_time"),location:val("e_location"),description:val("e_desc"),status:"UPCOMING",image_url:""}}
  if(type==="campaigns"){fn="rkms_manage_campaigns";file=document.querySelector("#c2_file")?.files[0];data={title:val("c2_title"),start_date:val("c2_start"),end_date:val("c2_end"),location:val("c2_location"),description:val("c2_desc"),demands:val("c2_demands"),status:"ACTIVE",image_url:""}}
  if(type==="leadership"){fn="rkms_manage_leadership";file=document.querySelector("#l_file")?.files[0];data={name:val("l_name"),post_name:val("l_post"),level:val("l_level"),mobile:val("l_mobile"),email:val("l_email"),introduction:val("l_intro"),status:"ACTIVE",photo_url:"",display_order:0}}
  if(type==="notifications"){fn="rkms_manage_notifications";const o=state.officer||{};const lvl=String(o.authority_level||"NATIONAL").toUpperCase();const path={target_state:o.state||"",target_mandal:o.mandal||"",target_district:o.district||"",target_tehsil:o.tehsil||"",target_block:o.block||"",target_village:o.village||""};data={title:val("nt_title"),body:val("nt_body"),notification_type:val("nt_type"),target_type:val("nt_target"),target_value:val("nt_value"),target_audience:val("nt_audience")||"ALL",target_post_id:val("nt_post")||null,is_public:document.querySelector("#nt_public")?.checked||false,is_important:document.querySelector("#nt_imp")?.checked||false,...path};if(!data.title||!data.body)throw new Error("Title और विवरण जरूरी है।");}
  const existing=document.querySelector("#contentForm")?.dataset.existingUrl||"";
  if(type==="flash"&&!editId&&files.length>1){for(const f of files){const uploaded=await uploadFile(f,"flash");const rr=await rpc(fn,{p_action:"CREATE",p_id:null,p_data:{...data,image_url:uploaded}});if(rr?.success===false)throw new Error(rr.message||"Flash save नहीं हुआ।")}msg.className="msg ok";msg.textContent=`${files.length} फोटो वाली Opening Flash सफलतापूर्वक publish हो गई।`;await showContentForm(type);return;}
  if(file){const folder=type==="gallery"?"gallery":type;const uploaded=await uploadFile(file,folder);data[type==="gallery"?"media_url":type==="documents"||type==="reports"?"file_url":type==="leadership"?"photo_url":"image_url"]=uploaded;if(type==="gallery")data.media_type=file.type.startsWith("video")?"VIDEO":"IMAGE";if(type==="documents")data.file_type=file.type;if(type==="documents"||type==="reports")data.file_size=file.size;}
  else if(editId && existing){data[type==="gallery"?"media_url":type==="documents"||type==="reports"?"file_url":type==="leadership"?"photo_url":"image_url"]=existing;}
  const r=await rpc(fn,{p_action:editId?"UPDATE":"CREATE",p_id:editId||null,p_data:data});
  if(r?.success===false)throw new Error(r.message||"Save नहीं हुआ।");
  msg.className="msg ok";msg.textContent=editId?"सफलतापूर्वक update हो गया।":"सफलतापूर्वक save/publish हो गया।";
  await showContentForm(type);
 }catch(e){msg.className="msg err";msg.textContent=e.message||"Save नहीं हुआ।"}
}

function appointmentPanel(superAdmin=false){
 return `<div class="card appointment-management-header"><h2>पदाधिकारी प्रबंधन</h2><p class="note">यहाँ Approved Member को पदाधिकारी नियुक्त करें, वर्तमान पदाधिकारी का पद बदलें या पद से हटाएँ। Backend अंतिम authority check करेगा।</p><div class="actions management-shortcuts"><button class="btn secondary" data-route="directory">🔎 पदाधिकारी खोजें</button><button class="btn secondary" data-route="reports">📊 Reports</button></div><label class="field">Member Search<input id="aptMemberQ" placeholder="नाम / मोबाइल / Member ID"></label><div id="aptMembers" class="grid" style="margin-top:12px"></div><div id="aptForm" class="hidden" style="margin-top:18px"><div id="aptMemberDetail" class="card" style="margin-bottom:14px"></div><div class="form-grid"><label class="field">Post<select id="aptPost"></select></label><label class="field">Joining Date<input id="aptDate" type="date"></label><label class="field">राज्य<select id="apt_state"></select></label><label class="field">मंडल<select id="apt_mandal" disabled></select></label><label class="field">जिला<select id="apt_district" disabled></select></label><label class="field">तहसील<select id="apt_tehsil" disabled></select></label><label class="field">ब्लॉक<select id="apt_block" disabled></select></label><label class="field">ग्राम<select id="apt_village" disabled></select><input id="apt_village_manual" class="village-manual" placeholder="यदि ग्राम सूची न मिले तो ग्राम का नाम लिखें" style="display:none;margin-top:8px"></label></div><div id="aptMsg" class="msg"></div><button id="aptSave" class="btn">नियुक्त करें</button></div></div><div class="card" style="margin-top:16px"><h3>वर्तमान सक्रिय पदाधिकारी</h3><div id="activeOfficerManageList" class="grid"><div class="note">लोड हो रहा है…</div></div></div>`;
}
async function setupAppointment(superAdmin=false){
 state.posts=arrOf(await rpc("rkms_get_posts"),"posts");
 let perms=[];let isIt=false;let authority="";if(!superAdmin){try{const r=await rpc("rkms_get_my_appointment_permissions");perms=arrOf(r,"permissions");isIt=!!r?.is_it_cell;authority=r?.authority_level||"";state.permissions=perms;state.appointmentIsIt=isIt;state.appointmentAuthority=authority}catch{}}
 const select=document.querySelector("#aptPost");const allowed=new Set(perms.filter(x=>x.allowed).map(x=>x.target_level));
 select.innerHTML=`<option value="">पद चुनें</option>`;state.posts.filter(p=>{if(superAdmin)return true;if(!allowed.has(p.level))return false;return true}).forEach(p=>select.insertAdjacentHTML("beforeend",`<option value="${p.id}" data-level="${esc(p.level)}">${esc(p.post_name)} — ${esc(p.level)}${p.is_it_cell?" · IT Cell":""}</option>`));
 document.querySelector("#aptDate").value=new Date().toISOString().slice(0,10);
 await setupLocations("apt");
 const q=document.querySelector("#aptMemberQ");
 q.addEventListener("input",debounce(loadAppointmentMembers,350));
 document.querySelector("#aptSave").onclick=async e=>{if(!lockButton(e.currentTarget,"⏳ Processing…"))return;try{await saveAppointment(superAdmin)}finally{unlockButton(e.currentTarget)}};
}
async function loadAppointmentMembers(){
 const q=val("aptMemberQ"),el=document.querySelector("#aptMembers");if(q.length<2){el.innerHTML=cardEmpty("Member खोजने के लिए कम से कम 2 अक्षर/अंक लिखें।");return}
 try{const rows=arrOf(await rpc("rkms_search_members",{p_search:q,p_status:"APPROVED",p_limit:20}));window.rkmsAppointmentMemberCache={};
  el.innerHTML=rows.map(m=>{window.rkmsAppointmentMemberCache[m.id]=m;return `<button class="card" data-apt-member="${esc(m.id)}" style="text-align:left"><b>${esc(capName(m.name))}</b><p>${esc(m.member_id||"")} · ${esc(m.mobile||"")}</p><small>${esc([m.district,m.tehsil,m.block,m.village].filter(Boolean).join(" / "))}</small></button>`}).join("")||cardEmpty("Approved member नहीं मिला।");
  el.querySelectorAll("[data-apt-member]").forEach(b=>b.onclick=()=>{const m=window.rkmsAppointmentMemberCache[b.dataset.aptMember]||{};document.querySelector("#aptForm").classList.remove("hidden");document.querySelector("#aptForm").dataset.member=b.dataset.aptMember;const d=document.querySelector("#aptMemberDetail");if(d)d.innerHTML=`<div class="detail-list"><div><b>नाम:</b> ${esc(capName(m.name||"—"))}</div><div><b>पिता/पति:</b> ${esc(capName(m.father_name||"—"))}</div><div><b>मोबाइल:</b> ${esc(m.mobile||"—")}</div><div><b>ईमेल:</b> ${esc(m.email||"—")}</div><div><b>सदस्यता:</b> ${esc(m.membership_type||"—")}</div><div><b>क्षेत्र:</b> ${esc([m.state,m.mandal,m.district,m.tehsil,m.block,m.village].filter(Boolean).join(" / ")||"—")}</div><div><b>स्थिति:</b> APPROVED</div></div>`});
 }catch(e){el.innerHTML=cardEmpty(e.message)}}
async function loadActiveOfficerManageList(){
 const box=document.querySelector("#activeOfficerManageList");if(!box)return;
 box.innerHTML=`<div class="note">पदाधिकारी सूची लोड हो रही है…</div>`;
 try{
  const rows=await publicOfficers(); const canManage=state.role==="officer"||state.role==="super_admin";
  box.innerHTML=rows.map(o=>`<article class="card officer-manage-card" style="padding:14px"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
   <div style="flex:1;min-width:190px"><b>${esc(o.name||"")}</b><div>${esc(o.post_name||"")} · ${esc(officerAreaLabel(o,o))}</div><small>${esc(o.member_id||"")}</small></div>
   ${canManage?`<div class="actions"><button class="btn small secondary" data-reappoint-officer="${esc(o.officer_id)}" data-reappoint-member="${esc(o.member_id||"")}">पद बदलें</button><button class="btn small danger" data-remove-officer="${esc(o.officer_id)}">पद से हटाएँ</button></div>`:""}
  </div></article>`).join("")||cardEmpty("कोई सक्रिय पदाधिकारी नहीं है।");
  if(!rows.length && box.querySelector(".empty")){}

  box.querySelectorAll("[data-remove-officer]").forEach(b=>b.onclick=async()=>{
   if(!confirm("क्या इस पदाधिकारी को पद से हटाना है?"))return;b.disabled=true;
   try{const me=await rpc("rkms_current_officer_id");const r=await rpc("rkms_update_officer_status",{p_officer_id:b.dataset.removeOfficer,p_new_status:"INACTIVE",p_changed_by_officer_id:me});if(!r?.success)throw new Error(r?.message||"पद से हटाया नहीं गया।");toast("पदाधिकारी को पद से हटा दिया गया।");await loadActiveOfficerManageList();state.dir=await publicOfficers();}
   catch(e){b.disabled=false;toast(e.message||"पद से हटाया नहीं गया।")}
  });
  box.querySelectorAll("[data-reappoint-officer]").forEach(b=>b.onclick=async()=>{
   const form=document.querySelector("#aptForm"), memberId=b.dataset.reappointMember;
   if(!form||!memberId){toast("पद बदलने की screen उपलब्ध नहीं है।");return;}
   form.classList.remove("hidden"); form.dataset.member=memberId; form.dataset.reappointOfficer=b.dataset.reappointOfficer;
   const q=document.querySelector("#aptMemberQ"); if(q){q.value=memberId; q.dispatchEvent(new Event("input"));}
   document.querySelector("#aptForm")?.scrollIntoView({behavior:"smooth",block:"start"});
   const msg=document.querySelector("#aptMsg"); if(msg){msg.className="msg ok";msg.textContent="नया पद और क्षेत्र चुनें, फिर ‘पद बदलें’ दबाएँ।";}
   const save=document.querySelector("#aptSave"); if(save)save.textContent="पद बदलें";
  });
 }catch(e){box.innerHTML=`<div class="msg err">${esc(e.message||"पदाधिकारी सूची नहीं खुली।")}<br><button class="btn small" id="retryActiveOfficers" style="margin-top:8px">↻ फिर कोशिश करें</button></div>`;document.querySelector("#retryActiveOfficers")?.addEventListener("click",loadActiveOfficerManageList)}
}
async function saveAppointment(superAdmin){
 const msg=document.querySelector("#aptMsg");
 try{
  const form=document.querySelector("#aptForm"), memberId=form?.dataset.member;
  if(!memberId)throw new Error("पहले member चुनें");
  const post=document.querySelector("#aptPost"), p=post.options[post.selectedIndex];
  if(!p?.value)throw new Error("Post चुनें");
  const body={p_member_id:memberId,p_state:val("apt_state"),p_mandal:val("apt_mandal"),p_district:val("apt_district"),p_tehsil:val("apt_tehsil"),p_block:val("apt_block"),p_village:val("apt_village")||val("apt_village_manual"),p_joining_date:val("aptDate")};
  let r;
  if(form.dataset.reappointOfficer){
    if(superAdmin) {
      r=await rpc("rkms_super_admin_reappoint_officer",{...body,p_old_officer_id:form.dataset.reappointOfficer,p_post_name:p.textContent.split(" — ")[0]});
    } else {
      await refreshIdentity();
      r=await rpc("rkms_reappoint_officer",{...body,p_old_officer_id:form.dataset.reappointOfficer,p_post_id:p.value,p_appointed_by_officer_id:(await rpc("rkms_current_officer_id"))});
    }
  } else if(superAdmin){
    r=await rpc("rkms_super_admin_appoint_officer",{...body,p_post_name:p.textContent.split(" — ")[0]});
  } else {
    await refreshIdentity();
    r=await rpc("rkms_appoint_officer",{...body,p_post_id:p.value,p_appointed_by_officer_id:(await rpc("rkms_current_officer_id"))});
  }
  if(!r?.success)throw new Error(r.message||"नियुक्ति सफल नहीं हुई।");
  msg.className="msg ok";msg.textContent=`${form.dataset.reappointOfficer?"पद सफलतापूर्वक बदला गया।":"नियुक्ति सफल हुई।"} Appointment No.: ${r.appointment_no||""}`;
  delete form.dataset.reappointOfficer;
  const save=document.querySelector("#aptSave");if(save)save.textContent="नियुक्त करें";
  await loadActiveOfficerManageList(); state.dir=await publicOfficers();
 }catch(e){msg.className="msg err";msg.textContent=e.message||"नियुक्ति सफल नहीं हुई।"}
}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}

async function loadPending(){
 const el=document.querySelector("#pendingRows"); if(!el)return;
 try{
   const q=val("pendingQ");
   let rows=arrOf(await rpc("rkms_search_members",{p_search:q,p_status:"",p_limit:200}));
   if(q&&!rows.length){const all=arrOf(await rpc("rkms_search_members",{p_search:"",p_status:"",p_limit:200}));const needle=String(q).trim().toLowerCase();rows=all.filter(m=>[m.name,m.father_name,m.mobile,m.member_id,m.district].some(v=>String(v??"").toLowerCase().includes(needle)));}
   el.innerHTML=(rows.map(m=>`<article class="card"><div style="display:flex;gap:12px;align-items:flex-start">${window.rkmsCanDeleteMembers?`<label style="display:flex;align-items:center;gap:8px;flex:0 0 auto"><input type="checkbox" class="member-delete-check" data-member-delete="${esc(m.id)}" aria-label="${esc(capName(m.name))} select"></label>`:""}<div style="flex:1"><h3>${esc(capName(m.name))}</h3><p>${esc(m.mobile)} · ${esc(m.district||"")}</p><span class="status ${String(m.status||"").toUpperCase()==="APPROVED"?"green":"amber"}">${esc(m.status||"PENDING")}</span><div class="actions"><button class="btn small" data-pdetail="${esc(m.id)}">विवरण</button>${String(m.status||"").toUpperCase()==="PENDING"?`<button class="btn small" data-papprove="${esc(m.id)}">✅ Approve</button><button class="btn small danger" data-preject="${esc(m.id)}">❌ Reject</button>`:""}</div></div></div></article>`).join("")||cardEmpty("कोई सदस्य नहीं है।"));
 const oldDelete=document.querySelector("#memberDeleteSelected"); if(oldDelete)oldDelete.remove();
 const head=document.querySelector("#pendingRows")?.parentElement?.querySelector("h2"); if(head){const b=document.createElement("button");b.id="memberDeleteSelected";b.className="btn danger small member-delete-corner";b.textContent="🗑️";b.title="चयनित सदस्य Delete";b.disabled=true;b.style.cssText="position:absolute;right:10px;top:8px;width:34px!important;min-width:34px!important;height:30px!important;padding:3px!important;font-size:14px!important;line-height:1!important;border-radius:6px!important";head.parentElement.style.position="relative";head.parentElement.insertBefore(b,head.nextSibling);b.onclick=()=>{const c=document.querySelector(".member-delete-check:checked");if(c)showMemberDeleteConfirm(c.dataset.memberDelete)}}
 el.querySelectorAll(".member-delete-check").forEach(c=>c.onchange=()=>{const all=[...document.querySelectorAll(".member-delete-check")];all.forEach(x=>{if(x!==c)x.checked=false});const b=document.querySelector("#memberDeleteSelected");if(b)b.disabled=!c.checked});
   el.querySelectorAll("[data-pdetail]").forEach(b=>b.onclick=()=>go("pending/"+b.dataset.pdetail));
   el.querySelectorAll("[data-papprove]").forEach(b=>b.onclick=async()=>{b.disabled=true;b.classList.add("approved-pending");b.textContent="⏳ Approval…";await processPending(b.dataset.papprove,"approve",b);await loadPending();});
   el.querySelectorAll("[data-preject]").forEach(b=>b.onclick=async()=>{b.disabled=true;await processPending(b.dataset.preject,"reject",b);await loadPending();});
 }catch(e){el.innerHTML=cardEmpty(e.message)}}
function showMemberDeleteConfirm(memberId){
 const old=document.querySelector("#memberDeleteModal");if(old)old.remove();
 const modal=document.createElement("div");modal.id="memberDeleteModal";modal.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;z-index:99999;padding:18px";
 const email=String(state.user?.email||"").trim();
 modal.innerHTML=`<div class="card" style="width:min(470px,100%);background:#fff"><h2>🗑️ सदस्य Delete</h2><p><b>क्या आप इस सदस्य को पूरी तरह हटाना चाहते हैं?</b></p><label class="field">अपना वर्तमान Login Password*<input id="deletePassword" type="password" autocomplete="current-password" placeholder="Password डालें"></label><label style="display:flex;gap:10px;align-items:flex-start;margin:14px 0"><input id="deleteConfirmTick" type="checkbox" style="margin-top:4px"><span>हाँ, मैं समझता हूँ और इस सदस्य को स्थायी रूप से हटाना चाहता हूँ।</span></label><div class="note">Delete करने वाले अधिकारी का नाम, पद, क्षेत्र और समय Delete Audit में सुरक्षित रहेगा।</div><div id="memberDeleteMsg" class="msg"></div><div class="actions"><button class="btn ghost" id="deleteCancel">Cancel</button><button class="btn danger" id="deleteYes" disabled>हाँ, Delete करें</button></div></div>`;
 document.body.appendChild(modal);
 const pass=modal.querySelector("#deletePassword"),tick=modal.querySelector("#deleteConfirmTick"),yes=modal.querySelector("#deleteYes"),msg=modal.querySelector("#memberDeleteMsg"),sync=()=>{yes.disabled=!(tick.checked&&pass.value.length>0)};
 pass.oninput=sync;tick.onchange=sync;modal.querySelector("#deleteCancel").onclick=()=>modal.remove();
 yes.onclick=async()=>{yes.disabled=true;tick.disabled=true;pass.disabled=true;msg.className="msg";msg.textContent="⏳ Password verify हो रहा है…";try{
  if(!email)throw new Error("इस login में email उपलब्ध नहीं है।");
  const auth=await request(`${AUTH}/token?grant_type=password`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({email,password:pass.value})});
  if(!auth?.access_token)throw new Error("Password गलत है।");
  saveSession(auth);await refreshIdentity(true);
  if(!["super_admin","officer"].includes(state.role))throw new Error("इस Login को Member Delete का अधिकार नहीं है।");
  const lvl=String(state.officer?.authority_level||state.officer?.level||"").toUpperCase();
  if(state.role!=="super_admin"&&!['NATIONAL','STATE','MANDAL','DISTRICT'].includes(lvl))throw new Error("इस स्तर के अधिकारी को Member Delete का अधिकार नहीं है।");
  const r=await request(`${SUPA}/functions/v1/rkms-member-delete-secure`,{method:"POST",headers:authHeaders(),body:JSON.stringify({member_id:memberId})});
  if(!r?.success)throw new Error(r?.message||"Delete नहीं हुआ।");
  msg.className="msg ok";msg.textContent="✅ सदस्य सफलतापूर्वक Delete हो गया। Delete Audit में रिकॉर्ड सुरक्षित है.";setTimeout(()=>{modal.remove();loadPending()},900);
 }catch(e){msg.className="msg err";msg.textContent=e.message||"Delete नहीं हुआ।";yes.disabled=false;tick.disabled=false;pass.disabled=false}};
}
async function renderPendingDetail(id){
 let x={};try{const raw=dataOf(await rpc("rkms_pending_member_detail",{p_member_id:id}));x=raw?.member||raw||{}}catch(e){return `<section class="screen">${screenHead("सदस्य विवरण")}${cardEmpty(e.message)}</section>`}
 const st=String(x.status||"").toUpperCase(),approved=st==="APPROVED",rejected=st==="REJECTED",statusClass=approved?"green":rejected?"red":"amber",statusText=approved?"APPROVED":rejected?"REJECTED":"PENDING";
 const actions=st==="PENDING"?`<div class="actions"><button class="btn" id="approveMember">Approve</button><button class="btn danger" id="rejectMember">Reject</button></div>`:"";
 return `<section class="screen">${screenHead(approved?"सदस्य विवरण":"Pending Member",approved?"स्वीकृत सदस्य की पूरी जानकारी":"Approval या Reject करने से पहले पूरा विवरण देखें")}<div class="card"><div class="profile">${x.photo_url?`<img class="avatar" src="${esc(x.photo_url)}" alt="">`:``}<div><h2>${esc(capName(x.name||""))}</h2><span class="status ${statusClass}">${statusText}</span></div></div><div class="detail-list"><div>सदस्य ID: ${esc(x.member_id||"—")}</div><div>नाम: ${esc(capName(x.name||"—"))}</div><div>पिता/पति: ${esc(capName(x.father_name||"—"))}</div><div>मोबाइल: ${esc(x.mobile||"—")}</div><div>ईमेल: ${esc(x.email||"—")}</div><div>सदस्यता प्रकार: ${esc(x.membership_type||"—")}</div><div>स्थान: ${esc([x.state,x.mandal,x.district,x.tehsil,x.block,x.gram_panchayat||x.village].filter(Boolean).join(" / ")||"—")}</div><div>पता: ${esc(x.address||"—")}</div><div>स्थिति: ${statusText}</div></div>${actions}<div id="pendingMsg" class="msg"></div></div></section>`;
}
async function processPending(id,action,button=null){
 const msg=document.querySelector("#pendingMsg")||document.querySelector("#pendingRows");
 try{
   if(button&&action==="approve"){button.disabled=true;button.textContent="⏳ Approval…";}
   let r;
   if(action==="approve")r=await rpc("rkms_approve_member",{p_member_id:id,p_approved_by_mobile:""});
   else{const reason=prompt("Reject का कारण लिखें");if(!reason){if(button)button.disabled=false;return;}r=await rpc("rkms_reject_member",{p_member_id:id,p_rejection_reason:reason,p_rejected_by_mobile:""})}
   if(!r?.success)throw new Error(r?.message||"Approval save नहीं हुआ।");
   if(msg){msg.className="msg ok";msg.textContent=action==="approve"?"✅ Approval Successful — सदस्य सफलतापूर्वक Approved हो गया।":"सदस्य सफलतापूर्वक Reject हो गया।";}
   if(button&&action==="approve"){button.classList.remove("approved-pending");button.classList.add("approved");button.textContent="✅ Approved";button.disabled=true;}
   return r;
 }catch(e){if(msg){msg.className="msg err";msg.textContent=e.message||"Approval save नहीं हुआ।"}if(button){button.disabled=false;button.textContent="✅ Approve";}return null}
}

async function officerDashboard(){
 if(state.role!=="officer")return loginScreen();
 let p;try{p=dataOf(await rpc("rkms_get_current_officer_profile")).officer;state.officer=p}catch(e){return `<section class="screen">${screenHead("Officer Dashboard")}${cardEmpty(e.message)}</section>`}
 const c=await rpc("rkms_get_current_officer_complaint_summary").catch(()=>({}));const counts=dataOf(c)||{};
 let pendingMemberApproval=0;try{const r=await rpc("rkms_pending_member_count");pendingMemberApproval=Number(dataOf(r)?.count??dataOf(r)??0)}catch{}
 const level=String(p.authority_level||p.level||"").toUpperCase();
 const isNational=level==="NATIONAL" || /राष्ट्रीय अध्यक्ष/i.test(String(p.post_name||""));
 let appointmentAllowed=false;try{const r=await rpc("rkms_get_my_appointment_permissions");appointmentAllowed=Array.isArray(r?.permissions)?r.permissions.some(x=>x?.allowed):false}catch{}
 const canDelete=["NATIONAL","STATE","MANDAL","DISTRICT"].includes(level);
 if(isNational)return nationalPresidentDashboard(p,counts,appointmentAllowed,canDelete);
 const deleteBtn=canDelete?`<button class="quick" data-route="member-list"><strong>🗑️ सदस्य Delete</strong><span>अधिकृत क्षेत्र के सदस्य को password + confirmation के बाद हटाएँ</span></button>`:"";
 const appointmentBtn=appointmentAllowed?`<button class="quick" data-route="appointment"><strong>👥 पदाधिकारी प्रबंधन</strong><span>अपने अधिकार क्षेत्र के अनुसार नियुक्ति, पद परिवर्तन और पद से हटाना</span></button>`:"";
 const sloganBtn=(isNational||level==='STATE')?`<button class="quick" data-route="login-slogans"><strong>📢 Login Slogan Management</strong><span>सदस्य Login के नीचे 1–10 slogans जोड़ें या बदलें</span></button>`:"";
 let contentBtn="";try{const cr=await rpc("rkms_get_my_content_permissions");const cp=arrOf(cr,"permissions").filter(x=>x?.can_manage);const labels=cp.map(x=>({events:"कार्यक्रम",news:"समाचार",flash:"Flash",gallery:"गैलरी",documents:"दस्तावेज"}[String(x.content_type||"").toLowerCase()]||x.content_type)).filter(Boolean);labels.push("📢 सूचना केंद्र");contentBtn=`<button type="button" class="quick" data-route="content-management"><strong>📰 Content Management</strong><span>${labels.join(" • ")}</span></button>`}catch{contentBtn=`<button type="button" class="quick" data-route="content-management"><strong>📢 सूचना केंद्र</strong><span>अपने अधिकार क्षेत्र की आधिकारिक सूचना publish करें</span></button>`}
 return `<section class="screen">${screenHead("पदाधिकारी Dashboard",`${p.name} · ${p.post_name||""}`)}<div class="card profile"><img class="avatar" style="width:110px;height:110px" src="${esc(p.photo_url||"assets/rkms-logo-transparent.png")}"><div><h2>${esc(p.name)}</h2><p><b>${esc(p.post_name||"")}</b></p><p>अधिकार स्तर: <b>${esc(level||"—")}</b></p><p>${esc([p.state,p.mandal,p.district,p.tehsil,p.block,p.village].filter(Boolean).join(" / "))}</p><p>Appointment: ${esc(p.appointment_no||"—")}</p></div></div>
 <div class="grid" style="margin-top:16px"><div class="card count-card"><span>कुल शिकायत</span><b>${esc(counts.total||0)}</b></div><div class="card count-card"><span>Pending सदस्य Approval</span><b>${pendingMemberApproval}</b></div><div class="card count-card"><span>Pending शिकायत</span><b>${esc(counts.pending||0)}</b></div></div>
 <div class="quick-grid" style="margin:18px 0"><button class="quick" data-route="pending"><strong>👤 सदस्य Approval</strong><span>अपने अधिकार क्षेत्र में Pending सदस्य देखें और Approve/Reject करें</span></button><button class="quick" data-route="officer-complaints"><strong>📝 शिकायत प्रबंधन</strong><span>अपने अधिकार क्षेत्र की शिकायतें देखें और कार्रवाई करें</span></button>${appointmentBtn}${sloganBtn}${contentBtn}<button class="quick" data-route="reports"><strong>📊 Reports</strong><span>अपने अधिकार क्षेत्र के संगठन आँकड़े</span></button><button class="quick" data-route="directory"><strong>📞 पदाधिकारी निर्देशिका</strong><span>अपने क्षेत्र के अधिकृत पदाधिकारी देखें</span></button>${deleteBtn}<button class="quick" data-route="digital-id"><strong>🪪 मेरी Digital ID</strong><span>अपनी पदाधिकारी Digital ID देखें</span></button><button class="quick" data-route="appointment-letter"><strong>📜 मेरा नियुक्ति पत्र</strong><span>अपना नियुक्ति पत्र देखें</span></button><button class="quick" data-route="chat"><strong>💬 Chat</strong><span>अधिकृत सदस्य/पदाधिकारी से बातचीत</span></button></div><button class="btn ghost" id="officerLogout">Logout</button></section>`;
}
async function nationalPresidentDashboard(p,counts,appointmentAllowed=false,canDelete=false){
 let pendingMemberApproval=0;try{const r=await rpc("rkms_pending_member_count");pendingMemberApproval=Number(dataOf(r)?.count??dataOf(r)??0)}catch{}
 const contentBtn=`<button type="button" class="quick" data-route="content-management"><strong>📰 Content Management</strong><span>कार्यक्रम • समाचार • Flash • गैलरी • 📢 सूचना केंद्र</span></button>`;
 return `<section class="screen">${screenHead("राष्ट्रीय अध्यक्ष Dashboard",`${p.name} · ${p.post_name||"राष्ट्रीय अध्यक्ष"}`)}<div class="card profile"><img class="avatar" style="width:110px;height:110px" src="${esc(p.photo_url||"assets/vm-singh.jpg")}"><div><span class="eyebrow">राष्ट्रीय नेतृत्व</span><h2>${esc(p.name)}</h2><p><b>${esc(p.post_name||"राष्ट्रीय अध्यक्ष")}</b></p><p>राष्ट्रीय स्तर: पूरे संगठन का डेटा और अधिकार क्षेत्र</p></div></div><div class="grid" style="margin-top:16px"><div class="card count-card"><span>कुल शिकायत</span><b>${esc(counts.total||0)}</b></div><div class="card count-card"><span>Pending सदस्य Approval</span><b>${pendingMemberApproval}</b></div><div class="card count-card"><span>Pending शिकायत</span><b>${esc(counts.pending||0)}</b></div></div><div class="quick-grid" style="margin:18px 0"><button class="quick" data-route="pending"><strong>👤 सदस्य Approval</strong><span>पूरे राष्ट्रीय स्तर के Pending सदस्य</span></button><button class="quick" data-route="officer-complaints"><strong>📝 शिकायत प्रबंधन</strong><span>राष्ट्रीय स्तर की शिकायतें और कार्रवाई</span></button>${contentBtn}<button class="quick" data-route="login-slogans"><strong>📢 Login Slogan Management</strong><span>सदस्य Login के नीचे 1–10 slogans जोड़ें या बदलें</span></button>${appointmentAllowed?`<button class="quick" data-route="appointment"><strong>👥 पदाधिकारी प्रबंधन</strong><span>अधिकार के अनुसार राष्ट्रीय/अधीनस्थ स्तर के पदाधिकारी</span></button>`:""}<button class="quick" data-route="reports"><strong>📊 राष्ट्रीय Reports</strong><span>पूरे संगठन के क्षेत्रवार आँकड़े</span></button><button class="quick" data-route="directory"><strong>📞 पदाधिकारी निर्देशिका</strong><span>पूरे संगठन के अधिकृत पदाधिकारी</span></button>${canDelete?`<button class="quick" data-route="member-list"><strong>🗑️ सदस्य Delete</strong><span>अधिकृत पुष्टि और password के बाद सदस्य हटाएँ</span></button>`:""}<button class="quick" data-route="digital-id"><strong>🪪 मेरी Digital ID</strong><span>राष्ट्रीय अध्यक्ष की Digital ID</span></button><button class="quick" data-route="appointment-letter"><strong>📜 नियुक्ति पत्र</strong><span>अपना नियुक्ति पत्र</span></button><button class="quick" data-route="chat"><strong>💬 Chat</strong><span>अधिकृत सदस्य और पदाधिकारी</span></button></div><button class="btn ghost" id="officerLogout">Logout</button></section>`;
}
async function officerComplaints(){
 if(state.role!=="officer")return loginScreen();let rows=[];try{rows=arrOf(await rpc("rkms_get_current_officer_complaints"))}catch(e){return `<section class="screen">${screenHead("शिकायत प्रबंधन")}${cardEmpty(e.message)}</section>`}
 return `<section class="screen">${screenHead("शिकायत प्रबंधन","शिकायत पर tap करने से अलग detail screen खुलेगी")}<div class="search"><input id="ocQ" placeholder="Complaint ID, नाम, मोबाइल, विषय"><select id="ocStatus"><option value="">सभी</option><option>RECEIVED</option><option>UNDER_REVIEW</option><option>ASSIGNED</option><option>ACTION_TAKEN</option><option>RESOLVED</option><option>REJECTED</option></select><button class="btn" id="ocSearch">खोजें</button></div><div id="ocList" class="grid" style="margin-top:16px">${rows.map(complaintCard).join("")||cardEmpty("कोई complaint नहीं है।")}</div></section>`;
}
function complaintCard(c){return `<article class="card"><span class="status">${esc(c.status||"")}</span><h3>${esc(c.complaint_id||"")}</h3><p><b>${esc(c.subject||"")}</b></p><p>${esc(c.name||"")} · ${esc(c.mobile||"")}</p><button class="btn small" data-complaint="${esc(c.id)}">विवरण</button></article>`}
async function renderOfficerComplaintDetail(id){
 if(state.role!=="officer")return loginScreen();let c;try{const me=await rpc("rkms_current_officer_id");c=(await rpc("rkms_get_complaint_details",{p_complaint_id:id,p_officer_id:me})).data||{}}catch(e){return `<section class="screen">${screenHead("Complaint")}${cardEmpty(e.message)}</section>`}
 let h=[];try{const me=await rpc("rkms_current_officer_id");h=arrOf(await rpc("rkms_get_complaint_history",{p_complaint_id:id,p_officer_id:me}))}catch{}
 return `<section class="screen">${screenHead("Complaint Detail","अलग full screen में complaint management")}<div class="card"><span class="status">${esc(c.status||"")}</span><h2>${esc(c.complaint_id||"")}</h2><div class="detail-list"><div>नाम: ${esc(c.name||"")}</div><div>मोबाइल: ${esc(c.mobile||"")}</div><div>क्षेत्र: ${esc([c.state,c.district,c.tehsil,c.block,c.village].filter(Boolean).join(" / "))}</div><div>विषय: ${esc(c.subject||"")}</div></div><div class="card" style="margin-top:14px"><p>${esc(c.description||"")}</p></div>
 <h3>स्थिति बदलें</h3><div class="form-grid"><label class="field">Status<select id="newStatus">${["RECEIVED","UNDER_REVIEW","ASSIGNED","ACTION_TAKEN","RESOLVED","REJECTED"].map(s=>`<option ${s===c.status?"selected":""}>${s}</option>`).join("")}</select></label><label class="field">Remarks<input id="cRemarks"></label><label class="field full">Action Taken<textarea id="cAction"></textarea></label><label class="field full">Resolution<textarea id="cResolution"></textarea></label></div><div id="cUpdateMsg" class="msg"></div><button class="btn" id="updateComplaintBtn">Update</button>
 <h3>History</h3><div class="grid">${h.map(x=>`<div class="card"><b>${esc(x.new_status||"")}</b><p>${esc(x.remarks||"")}</p><small>${esc(x.created_at||"")}</small></div>`).join("")||cardEmpty("History नहीं है।")}</div></div></section>`;
}
async function updateComplaint(id){
 const msg=document.querySelector("#cUpdateMsg");try{const o=state.officer||dataOf(await rpc("rkms_get_current_officer_profile")).officer;const r=await rpc("rkms_update_complaint",{p_complaint_id:id,p_new_status:val("newStatus"),p_officer_mobile:o.mobile,p_assigned_to:null,p_remarks:val("cRemarks"),p_action_taken:val("cAction"),p_resolution:val("cResolution")});if(!r?.success)throw new Error(r.message);msg.className="msg ok";msg.textContent="Complaint update हो गई।"}catch(e){msg.className="msg err";msg.textContent=e.message}}

function organizationAdmin(){return `<div class="card"><h2>Organization Settings</h2><div class="form-grid"><label class="field full">Organization Name<input id="o_name"></label><label class="field">Tagline<input id="o_tagline"></label><label class="field">Email<input id="o_email"></label><label class="field">Phone<input id="o_phone"></label><label class="field full">Description<textarea id="o_desc"></textarea></label><label class="field full">दृष्टि (Vision)<textarea id="o_vision"></textarea></label><label class="field full">मिशन<textarea id="o_mission"></textarea></label><label class="field full">Office Address<textarea id="o_address"></textarea></label></div><div id="orgMsg" class="msg"></div><button class="btn" id="orgSave">Save</button></div>`}
function bindOrganizationAdmin(){const o=state.org||{};for(const [id,v] of [["o_name",o.organization_name],["o_tagline",o.tagline],["o_email",o.official_email],["o_phone",o.official_phone],["o_desc",o.description],["o_vision",o.vision],["o_mission",o.mission],["o_address",o.office_address]]){const e=document.getElementById(id);if(e)e.value=v||""}document.querySelector("#orgSave").onclick=async()=>{try{const r=await rpc("rkms_manage_organization",{p_data:{organization_name:val("o_name"),tagline:val("o_tagline"),official_email:val("o_email"),official_phone:val("o_phone"),description:val("o_desc"),vision:val("o_vision"),mission:val("o_mission"),office_address:val("o_address")}});if(!r?.success)throw new Error(r.message);document.querySelector("#orgMsg").className="msg ok";document.querySelector("#orgMsg").textContent="Organization settings save हो गईं।";await loadOrg()}catch(e){document.querySelector("#orgMsg").className="msg err";document.querySelector("#orgMsg").textContent=e.message}}}


async function renderAdminMemberList(){
 await refreshIdentity();
 if(!["super_admin","officer"].includes(state.role))return loginScreen();
 let rows=[];try{rows=await loadApprovedMembersCached();}catch(e){return `<section class="screen">${screenHead("कुल सदस्य","Approved members")}${cardEmpty(e.message)}</section>`}
 const lvl=String(state.officer?.authority_level||state.officer?.level||"").toUpperCase();
 const canDelete=state.role==="super_admin"||["NATIONAL","STATE","MANDAL","DISTRICT"].includes(lvl);window.rkmsCanDeleteMembers=canDelete;
 return `<section class="screen">${screenHead("कुल सदस्य","Approved members — Live database")}<div class="search"><input id="adminMemberSearch" placeholder="नाम / मोबाइल / Member ID / जिला"><button class="btn" id="adminMemberSearchBtn">खोजें</button></div><div class="card" style="margin-top:12px"><p class="note">${canDelete?"सदस्य Delete के लिए सदस्य चुनें, फिर password और confirmation से स्थायी Delete करें।":"आपके वर्तमान अधिकार स्तर में Member Delete उपलब्ध नहीं है।"}</p><button class="btn danger" id="adminMemberDeleteSelected" disabled style="display:${canDelete?"inline-flex":"none"}">🗑️ चयनित सदस्य Delete</button></div><div id="adminMemberRows" class="grid" style="margin-top:14px">${rows.map(x=>`<article class="card"><div style="display:flex;gap:10px;align-items:flex-start">${canDelete?`<input type="checkbox" class="admin-member-delete-check" value="${esc(x.id)}">`:""}<div><h3>${esc(x.name||"")}</h3><p>Member ID: <b>${esc(x.member_id||"—")}</b></p><p>${esc(x.mobile||"")} · ${esc([x.district,x.tehsil,x.block,x.village].filter(Boolean).join(" · "))}</p><span class="status">APPROVED</span></div></div></article>`).join("")||cardEmpty("कोई Approved सदस्य नहीं मिला।")}</div></section>`;
}
document.addEventListener("change",function(e){const c=e.target.closest(".admin-member-delete-check");if(!c)return;const b=document.querySelector("#adminMemberDeleteSelected");if(b)b.disabled=!document.querySelector(".admin-member-delete-check:checked");});
document.addEventListener("click",function(e){const b=e.target.closest("#adminMemberDeleteSelected");if(!b)return;const c=document.querySelector(".admin-member-delete-check:checked");if(c)showMemberDeleteConfirm(c.value);});
async function renderAdminActiveOfficers(){
 if(state.role!=="super_admin"){await refreshIdentity();if(state.role!=="super_admin")return loginScreen();}
 let rows=[];
 try{rows=await publicOfficers();}catch(e){return `<section class="screen">${screenHead("कुल सक्रिय पदाधिकारी","Active officers")}${cardEmpty(e.message)}</section>`}
 rows=rkmsSortPdaOfficers(rows);
 return `<section class="screen">${screenHead("कुल सक्रिय पदाधिकारी","सभी सक्रिय पदाधिकारी — पद के क्रम में")}
 <div class="grid">${rows.map(x=>officerCard(x)).join("")||cardEmpty("कोई सक्रिय पदाधिकारी नहीं मिला।")}</div></section>`;
}

async function renderRoute(r){
 const parts=r.split("/"), name=parts[0],id=decodeURIComponent(parts.slice(1).join("/"));
 if(name==="home")return renderHome();
 if(name==="member-list")return renderAdminMemberList();
 if(name==="active-officers")return renderAdminActiveOfficers();
 if(name==="organization")return renderOrganization();
 if(name==="leadership")return renderLeadership();
 if(name==="vmsingh")return renderVMS();
 if(name==="directory")return renderDirectory();
 if(name==="district")return renderDistrict(id);
 if(name==="officer")return renderOfficer(id);
 if(name==="membership")return membershipForm();
 if(name==="login")return loginScreen();
 if(name==="login-slogans")return renderLoginSlogans();
 if(name==="content-management")return renderOfficerContentManagement();
 if(name==="officer-login")return officerLoginScreen();
 if(name==="chat")return renderChat();
 if(name==="password-reset-requests")return renderPasswordResetRequests();
 if(name==="member-dashboard")return renderMemberDashboard();
 if(name==="member-update")return renderMemberUpdate();
 if(name==="digital-id")return renderDigitalId();
 if(name==="appointment-letter")return renderAppointmentLetter();
 if(name==="membership-certificate")return renderMembershipCertificate();
 if(name==="complaint")return renderComplaint();
 if(name==="my-complaints")return renderMyComplaints();
 if(name==="my-complaint")return renderMemberComplaintDetail(id);
 if(name==="book")return bookScreen();
 if(name==="news")return contentScreen("news","समाचार","प्रकाशित समाचार",newsCard);
 if(name==="events")return contentScreen("events","कार्यक्रम","आगामी और प्रकाशित कार्यक्रम",eventCard);
 if(name==="gallery")return contentScreen("gallery","फोटो/मीडिया गैलरी","प्रकाशित फोटो और वीडियो",galleryCard);
 if(name==="documents")return contentScreen("documents","प्रकाशित दस्तावेज","मोबाइल से पढ़ने/खोलने योग्य दस्तावेज",docCard);
 if(name==="reports")return renderOrganizationReports();
 if(name==="campaigns")return contentScreen("campaigns","अभियान","संगठन के अभियान",campaignCard);
 if(name==="notifications")return contentScreen("notifications","सूचनाएँ","संगठन की notifications",notificationCard);
 if(name==="admin")return adminScreen();
 if(name==="content")return adminScreen();
 if(name==="security-audit")return adminScreen();
 if(name==="officer-dashboard")return officerDashboard();
 if(name==="officer-complaints")return officerComplaints();
 if(name==="complaint-detail")return renderOfficerComplaintDetail(id);
 if(name==="pending" && !id)return `<section class="screen pending-approval-screen">${screenHead("Pending Member Approval","Pending सदस्य की अलग management screen") }<div class="card"><div class="pending-screen-title"><div><h2 style="margin:0">Pending सदस्य Approval</h2><p class="note" style="margin:4px 0 0">सदस्य पर tap करके उसकी पूरी detail खोलें। वहीं Approve या Reject करें।</p></div></div><div class="search" style="margin-top:14px"><input id="pendingQ" placeholder="नाम / मोबाइल / Member ID"><button class="btn" id="pendingSearch">खोजें</button></div><div id="pendingRows" class="grid" style="margin-top:14px"></div></div></section>`;
 if(name==="pending")return renderPendingDetail(id);
 if(name==="appointment")return `<section class="screen">${screenHead("पदाधिकारी नियुक्ति")} ${appointmentPanel(state.role==="super_admin")}</section>`;
 return renderHome();
}
async function bindHomeFlashRotator(){
 const box=document.querySelector("#homeFlashRotator");
 if(!box)return;
 if(window.rkmsFlashTimer){clearInterval(window.rkmsFlashTimer);window.rkmsFlashTimer=null;}
 let fs=[];try{fs=await loadActiveFlashes();}catch{}
 if(fs.length<2)return;
 let i=0;const img=box.querySelector(".home-flash-image"),title=box.querySelector(".home-flash-title");
 fs.forEach(x=>{if(x.image_url){const im=new Image();im.src=x.image_url;}});
 const show=()=>{const x=fs[i];if(img&&x?.image_url){img.src=x.image_url;img.alt=x.title||"Flash";}if(title)title.textContent=x?.title||"";};
 show();
 window.rkmsFlashTimer=setInterval(()=>{
  if(fs.length<2)return;
  i=(i+1)%fs.length;show();
 },5000);
}
async function render(){
 const pendingChatId=chatRouteConversationId();
 const app=document.querySelector("#app");app.innerHTML='<section class="screen"><div class="loading">लोड हो रहा है…</div></section>';
 try{app.innerHTML=await renderRoute(route())}catch(e){app.innerHTML=`<section class="screen">${screenHead("त्रुटि")}${cardEmpty(e.message||"कुछ गलत हुआ।")}</section>`}
 bindGlobal();
 if(route()==="home"){bindHomeFlashRotator();}
 const r=route();
 if(r==="membership"){setupLocations("member");}
 if(r==="book")bindBook();
 if(r==="directory")bindDirectory();
 if(r==="login"||r==="officer-login")bindLogin();
 if(r==="login")loadLoginSlogans();
 if(r==="login-slogans"){document.querySelector("#loginSloganSave")?.addEventListener("click",async e=>{if(!lockButton(e.currentTarget,"⏳ Save हो रहा है…"))return;try{await saveLoginSlogans()}finally{unlockButton(e.currentTarget)}});document.querySelector("#loginSloganClear")?.addEventListener("click",()=>{for(let i=1;i<=10;i++){const el=document.querySelector(`#loginSlogan${i}`);if(el)el.value="";}const msg=document.querySelector("#loginSloganMsg");if(msg){msg.className="msg";msg.textContent="फ़ॉर्म साफ हो गया है। कम से कम 1 slogan रखना आवश्यक है; फिर Save करें।";}})}
 if(r==="complaint")document.querySelector("#complaintSubmit")?.addEventListener("click",async e=>{if(!lockButton(e.currentTarget,"⏳ Submit हो रहा है…"))return;try{await submitComplaint()}finally{unlockButton(e.currentTarget)}});
 if(r==="my-complaints")document.querySelectorAll("[data-member-complaint]").forEach(b=>b.onclick=()=>go("my-complaint/"+b.dataset.memberComplaint));
 if(r==="member-dashboard"){document.querySelector("#memberLogout")?.addEventListener("click",()=>logout());}
 if(r==="member-update"){document.querySelector("#memberUpdateSave")?.addEventListener("click",async e=>{if(!lockButton(e.currentTarget,"⏳ Save हो रहा है…"))return;try{await saveMemberUpdate()}finally{unlockButton(e.currentTarget)}}); }
 if(r==="officer-dashboard"){document.querySelector("#officerLogout")?.addEventListener("click",()=>logout());}
 if(r==="admin"||r==="content"||r==="security-audit"){document.querySelector("#adminLogout")?.addEventListener("click",()=>logout());}
 if(r==="chat"){bindChatScreen(); if(pendingChatId){ requestAnimationFrame(()=>openChatThread(pendingChatId).catch(e=>toast(e.message||"Chat नहीं खुली।"))); }}
 if(r==="password-reset-requests")bindPasswordResetRequests();
 if(r==="officer-complaints"){
   document.querySelectorAll("[data-complaint]").forEach(b=>b.onclick=()=>go("complaint-detail/"+b.dataset.complaint));
   document.querySelector("#ocSearch")?.addEventListener("click",()=>{
     const q=String(val("ocQ")||"").trim().toLowerCase();
     const status=String(val("ocStatus")||"").trim().toUpperCase();
     document.querySelectorAll("#ocList [data-complaint]").forEach(btn=>{
       const card=btn.closest("article");
       if(!card)return;
       const text=card.textContent.toLowerCase();
       const cardStatus=card.querySelector(".status")?.textContent?.trim().toUpperCase()||"";
       card.style.display=(!q||text.includes(q))&&(!status||cardStatus===status)?"":"none";
     });
   });
   document.querySelector("#ocQ")?.addEventListener("keydown",e=>{if(e.key==="Enter")document.querySelector("#ocSearch")?.click()});
 }
 if(r.startsWith("complaint-detail/"))document.querySelector("#updateComplaintBtn")?.addEventListener("click",()=>updateComplaint(r.split("/")[1]));
 if(r==="pending/"){}
 if(r==="pending" || r.startsWith("pending/")){if(r==="pending"){loadPending();document.querySelector("#pendingSearch")?.addEventListener("click",loadPending);document.querySelector("#pendingQ")?.addEventListener("keydown",e=>{if(e.key==="Enter")loadPending()})}else{const id=r.split("/")[1];document.querySelector("#approveMember")?.addEventListener("click",async e=>{const b=e.currentTarget;b.disabled=true;b.textContent="⏳ Approval…";await processPending(id,"approve",b)});document.querySelector("#rejectMember")?.addEventListener("click",()=>processPending(id,"reject"))}}
 if(r==="home")renderHomeNotifications(); if(r==="admin"||r==="content"||r==="security-audit"){renderAdminPanel(r==="security-audit"?"security":"content")}
 if(r==="appointment"){setupAppointment(state.role==="super_admin");setTimeout(loadActiveOfficerManageList,150);}
 if(r==="member-dashboard"&&(state.role!=="member"&&state.role!=="officer"))toast("Member/Officer login जरूरी है।");
 if(r==="chat"&&!(["member","officer"].includes(state.role)))toast("Member/Officer login जरूरी है।");
 if(r==="password-reset-requests"&&!(["super_admin","officer"].includes(state.role)))toast("Authorized officer login जरूरी है।");
 if(r==="officer-dashboard"&&state.role!=="officer")toast("Officer login जरूरी है।");
}
function bindNameCapitalization(){
 ["m_name","m_father","l_name","o_name"].forEach(id=>{const el=document.getElementById(id);if(el&&!el.dataset.capBound){el.dataset.capBound="1";el.addEventListener("input",()=>{const pos=el.selectionStart;el.value=capName(el.value);try{el.setSelectionRange(pos,pos)}catch{}})}});
}
async function renderHomeNotifications(){
 const box=document.querySelector("#homeNotifications");if(!box)return;
 const rows=await loadPriorityNotifications(4);
 box.innerHTML=rows.map(x=>`<article class="card" style="padding:12px"><span class="status ${x.is_important?"amber":""}">${x.is_pinned||notificationPriority(x,state.member||state.officer)<10?"📌 क्षेत्रीय":"सूचना"}</span><h3>${esc(x.title||"")}</h3><p>${esc(x.body||"")}</p></article>`).join("")||cardEmpty("अभी कोई प्रकाशित सूचना नहीं है।");
}
function showLoginChooser(){
 const old=document.querySelector("#loginChooser");if(old)old.remove();
 const modal=document.createElement("div");modal.id="loginChooser";modal.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;z-index:99999;padding:18px";
 modal.innerHTML=`<div class="card" style="width:min(330px,92vw);background:#fff;position:relative;text-align:center"><button id="loginChooserClose" aria-label="Close" style="position:absolute;right:8px;top:8px;border:0;background:transparent;font-size:22px">×</button><h2 style="margin-top:8px">लॉगिन चुनें</h2><p class="note">कृपया अपना Login चुनें</p><div class="actions" style="display:grid;gap:10px"><button id="chooseMemberLogin" class="btn">👤 सदस्य Login</button><button id="chooseOfficerLogin" class="btn secondary">🛡️ पदाधिकारी Login</button></div></div>`;
 document.body.appendChild(modal);
 modal.querySelector("#loginChooserClose").onclick=()=>modal.remove();
 modal.querySelector("#chooseMemberLogin").onclick=()=>{modal.remove();go("login")};
 modal.querySelector("#chooseOfficerLogin").onclick=()=>{modal.remove();sessionStorage.setItem("rkms_login_entry","1");go("officer-login")};
}
let rkmsHistoryBound=false;
function bindHistory(){
  if(rkmsHistoryBound)return;
  rkmsHistoryBound=true;
  const handleBack=()=>{
    // Do not pop a parallel custom stack here. The browser history entry already
    // represents exactly one screen. Mutating another stack caused Forward/Back
    // to drift and could re-introduce the login screen.
    const r=route();
    if(history.state?.rkmsApp){
      writeScreenStack([r]);
      render();
      return;
    }
    // A non-RKMS history entry was reached. Re-anchor the current app route.
    history.replaceState({rkmsRoute:r,rkmsIndex:0,rkmsApp:true,rkmsAuthenticated:!!token()},"",location.hash||"#home");
    writeScreenStack([r]);
    render();
  };
  window.addEventListener("popstate",handleBack);
  window.addEventListener("hashchange",()=>{
    // Hash navigation can generate an additional browser entry. If it is not
    // one of our managed entries, immediately normalize it without pushing.
    const r=route();
    if(history.state?.rkmsApp && history.state.rkmsRoute===r){ render(); return; }
    history.replaceState({rkmsRoute:r,rkmsIndex:currentHistoryIndex(),rkmsApp:true,rkmsAuthenticated:!!token()},"",location.hash||"#home");
    writeScreenStack([r]);
    render();
  });
}

function lockButton(button,label="Processing…"){
 if(!button || button.dataset.busy==="1")return false;
 button.dataset.busy="1";button.disabled=true;
 button.dataset.originalText=button.textContent||"";
 button.textContent=label;
 return true;
}
function unlockButton(button){
 if(!button)return;
 button.disabled=false;button.dataset.busy="0";
 if(button.dataset.originalText!==undefined)button.textContent=button.dataset.originalText;
}
function bindGlobal(){
 document.querySelectorAll("[data-route]").forEach(b=>b.onclick=(e)=>{e.preventDefault();e.stopPropagation();document.querySelector("#nav")?.classList.remove("open");go(b.dataset.route)});
 document.querySelectorAll("[data-login-menu]").forEach(b=>b.onclick=()=>showLoginChooser());
 document.querySelectorAll("[data-back]").forEach(b=>b.onclick=()=>{
   const r=route();
   const idx=currentHistoryIndex();
   if(r==="login"||r==="officer-login"){
     // Never leave the login form as a dead-end history entry.
     if(idx>0){ history.back(); }
     else { history.replaceState({rkmsRoute:"home",rkmsIndex:0,rkmsApp:true,rkmsAuthenticated:false},"","#home"); writeScreenStack(["home"]); render(); }
     return;
   }
   // Exactly one Back = exactly one browser history entry.
   if(idx>0){ history.back(); return; }
   history.replaceState({rkmsRoute:"home",rkmsIndex:0,rkmsApp:true,rkmsAuthenticated:!!token()},"","#home");
   writeScreenStack(["home"]);
   render();
 });

 document.querySelector("#memberSubmit")?.addEventListener("click",async e=>{if(!lockButton(e.currentTarget,"⏳ Save हो रहा है…"))return;try{await submitMember()}finally{unlockButton(e.currentTarget)}});
}
async function passwordLogin(){
 const msg=document.querySelector("#loginMsg");if(msg){msg.className="msg";msg.textContent="";}
 const email=val("loginEmail").toLowerCase(),password=val("loginPassword");
 if(!email||!password){if(msg){msg.className="msg err";msg.textContent="ईमेल और Password दोनों जरूरी हैं।";}return;}
 try{
  const r=await request(`${AUTH}/token?grant_type=password`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({email,password})});
  if(!r?.access_token)throw new Error("Login नहीं हुआ।");
  saveSession(r,true);
  await refreshIdentity(true);
  try{ if(window.RKMSNative&&r?.access_token) window.RKMSNative.saveSession(r.access_token,r.refresh_token||"",state.role||""); }catch(e){}
  // This single login is intentionally shared by Super Admin and all active officers.
  if(state.role!=="super_admin" && state.role!=="officer"){
    throw new Error("यह email/password RKMS के किसी ACTIVE पदाधिकारी या Super Admin account से जुड़ा नहीं है।");
  }
  completeLogin(state.role==="super_admin"?"admin":"officer-dashboard");
 }catch(e){clearSessionStorage();if(msg){msg.className="msg err";msg.textContent=e.message||"Login नहीं हुआ।";}}
}
async function forgotPassword(){
 const email=val("loginEmail").toLowerCase();const msg=document.querySelector("#loginMsg");
 if(!email){if(msg){msg.className="msg err";msg.textContent="पहले अपना Login Email डालें।";}return;}
 try{const r=await request(`${AUTH}/recover`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({email,options:{redirectTo:location.origin+location.pathname+"#login"}})});if(!r){} if(msg){msg.className="msg ok";msg.textContent="यदि यह registered account है तो password recovery email भेज दी गई है।";}}catch(e){if(msg){msg.className="msg err";msg.textContent=e.message||"Recovery email नहीं भेजी गई।";}}
}
function bindLogin(){
 document.querySelector("#loginBtn")?.addEventListener("click",passwordLogin);
 document.querySelector("#forgotBtn")?.addEventListener("click",forgotPassword);
 document.querySelector("#memberPasswordLoginBtn")?.addEventListener("click",memberPasswordLogin);
 document.querySelector("#memberForgotBtn")?.addEventListener("click",memberForgotPassword);
}

function chatActorType(){
  // Chat actor is determined only by the resolved login role.
  // A person who is also a PDA officer remains MEMBER while logged in as Member.
  if(state.role==="member") return "MEMBER";
  if(state.role==="officer") return "OFFICER";
  return "";
}

function chatAvatar(url,name,group=false){
  if(url) return `<img class="wa-avatar-img" src="${esc(url)}" alt="" loading="lazy">`;
  const letter=String(name||"?").trim().slice(0,1).toUpperCase()||"?";
  return `<span class="wa-avatar ${group?"group-avatar":""}">${group?"👥":esc(letter)}</span>`;
}
function chatTime(v){
  if(!v)return "";
  const d=new Date(v); if(Number.isNaN(d.getTime()))return "";
  const now=new Date();
  if(d.toDateString()===now.toDateString()) return d.toLocaleTimeString("hi-IN",{hour:"2-digit",minute:"2-digit"});
  return d.toLocaleDateString("hi-IN",{day:"2-digit",month:"2-digit"});
}
function chatPreview(t){
  const text=String(t?.last_message||"").trim();
  return text || (t?.is_group ? "Group chat" : "कोई संदेश नहीं");
}
function chatThreadMatches(t,filter,search){
  if(filter==="groups"&&!t.is_group)return false;
  if(filter==="unread"&&!Number(t.unread_count||0))return false;
  const q=String(search||"").trim().toLowerCase();
  return !q || String(t.other_name||t.name||"").toLowerCase().includes(q) || chatPreview(t).toLowerCase().includes(q);
}

async function loadChatPeople(){
  const actorType=chatActorType();
  if(!actorType)throw new Error("Chat के लिए Member या पदाधिकारी login जरूरी है।");
  const r=await rpc("rkms_chat_people",{
    p_actor_type:actorType,
    p_search:null,
    p_limit:100
  });
  if(r?.error)throw r.error;
  if(r?.success===false)throw new Error(r.message||"Participants उपलब्ध नहीं हैं।");
  const people=arrOf(r);
  state.chatPeople=people;
  state.chatPeopleError="";
  return people;
}

async function loadChatThreads(){
  const actorType=chatActorType();
  const r=await rpc("rkms_chat_threads",{p_actor_type:actorType});
  if(r?.error)throw r.error;
  if(r?.success===false)throw new Error(r.message||"Chats नहीं मिलीं।");
  state.chatThreads=Array.isArray(r?.data)?r.data:[];
  return state.chatThreads;
}

function renderChatRows(threads,filter="all",search=""){
  const rows=threads.filter(t=>chatThreadMatches(t,filter,search)).map(t=>{
    const name=t.other_name||t.name||"Chat";
    const role=t.other_role||(t.is_group?"Group":"सदस्य");
    const unread=Number(t.unread_count||0);
    return `<div class="wa-chat-row-wrap">
      <button type="button" class="wa-chat-row recent-chat" data-conversation-id="${esc(t.conversation_id||"")}">
        <span class="wa-avatar-wrap">${chatAvatar(t.other_photo,name,!!t.is_group)}</span>
        <span class="wa-chat-copy"><strong>${esc(name)}</strong><small>${esc(role)}${t.is_group&&t.member_count?` · ${esc(t.member_count)} सदस्य`:``}</small><span>${esc(chatPreview(t))}</span></span>
        <span class="wa-chat-right"><time>${esc(chatTime(t.last_message_at))}</time>${unread?`<b class="wa-unread">${unread>99?"99+":unread}</b>`:""}</span>
      </button>
      <button type="button" class="wa-row-menu" data-chat-action="menu" data-conversation-id="${esc(t.conversation_id||"")}" aria-label="Chat menu">⋮</button>
    </div>`;
  }).join("");
  return rows||`<div class="wa-empty"><div>💬</div><strong>${filter==="unread"?"कोई unread chat नहीं है।":filter==="groups"?"अभी कोई group chat नहीं है।":"अभी कोई chat नहीं है।"}</strong><small>ऊपर से New Chat या New Group शुरू करें।</small></div>`;
}

function renderNewChatPeople(people,stateFilter=""){
  const q=String(stateFilter||"").trim().toLowerCase();
  const rows=people.filter(p=>!q||String(p.name||"").toLowerCase().includes(q)||String(p.member_id||"").toLowerCase().includes(q)||String(p.district||"").toLowerCase().includes(q)).map(p=>{
    const id=p.id||p.member_id||p.officer_id||"";
    const type=String(p.chat_type||p.actor_type||p.role||"MEMBER").toUpperCase();
    const role=p.post_name||(type==="OFFICER"?"पदाधिकारी":"सदस्य");
    return `<button type="button" class="wa-person-row chat-person" data-recipient-id="${esc(id)}" data-recipient-type="${esc(type)}">
      <span class="wa-avatar-wrap">${chatAvatar(p.photo_url,p.name,false)}</span>
      <span><strong>${esc(p.name||"")}</strong><small>${esc(role)}</small>${p.district?`<em>${esc(p.district)}</em>`:""}</span><i>›</i>
    </button>`;
  }).join("");
  return rows||`<div class="wa-empty compact"><div>🔎</div><strong>कोई सदस्य नहीं मिला</strong><small>नाम या सदस्यता जानकारी से खोजें।</small></div>`;
}

function renderChatGroupModal(){
  const people=state.chatPeople||[];
  return `<div class="wa-modal-backdrop" id="chat-group-modal">
    <div class="wa-modal" role="dialog" aria-modal="true">
      <div class="wa-modal-head"><button type="button" class="wa-icon-btn" data-modal-close>‹</button><div><strong>New Group</strong><small>सदस्य चुनें</small></div></div>
      <div class="wa-modal-body">
        <label class="wa-field"><span>Group का नाम</span><input id="chat-group-name" maxlength="80" placeholder="जैसे जिला किसान साथी"></label>
        <input id="chat-group-search" class="wa-search-input" placeholder="सदस्य खोजें…" autocomplete="off">
        <div id="chat-group-people" class="wa-select-list">${people.map(p=>{
          const id=p.id||p.member_id||p.officer_id||"";const type=String(p.chat_type||"MEMBER").toUpperCase();
          return `<label class="wa-select-person"><input type="checkbox" data-group-type="${esc(type)}" data-group-id="${esc(id)}"><span class="wa-avatar-wrap">${chatAvatar(p.photo_url,p.name,false)}</span><span><strong>${esc(p.name||"")}</strong><small>${esc(p.post_name||(type==="OFFICER"?"पदाधिकारी":"सदस्य"))}</small></span></label>`;
        }).join("")}</div>
      </div>
      <div class="wa-modal-foot"><button type="button" class="btn ghost" data-modal-close>रद्द करें</button><button type="button" class="btn primary" id="chat-create-group">Group बनाएं</button></div>
    </div>
  </div>`;
}

async function renderChat(){
  await refreshIdentity();
  const actorType=chatActorType();
  if(!actorType)throw new Error("Chat के लिए Member या पदाधिकारी login जरूरी है।");
  let people=[];let peopleError="";let threads=[];let threadsError="";
  try{people=await loadChatPeople();}catch(e){peopleError=e?.message||"Participants नहीं मिले।";}
  try{threads=await loadChatThreads();}catch(e){threadsError=e?.message||"Chats नहीं मिलीं।";}
  state.chatPeople=people;
  state.chatThreads=threads;
  state.chatFilter=state.chatFilter||"all";state.chatSearch=state.chatSearch||"";
  const unread=threads.filter(x=>Number(x.unread_count||0)>0).length;
  const groups=threads.filter(x=>x.is_group).length;
  return `<section class="wa-chat-screen">
    <header class="wa-chat-list-head">
      <div class="wa-chat-title"><strong>RKMS Chat</strong><small>सुरक्षित संगठनात्मक बातचीत</small></div>
      <div class="wa-head-actions"><button type="button" class="wa-icon-btn" id="chat-refresh" title="Refresh Chat">↻</button><button type="button" class="wa-icon-btn" id="chat-new-group" title="New Group">👥</button><button type="button" class="wa-icon-btn" id="chat-new-menu" title="New Chat">＋</button></div>
    </header>
    <div class="wa-chat-search"><span>⌕</span><input id="chat-list-search" value="${esc(state.chatSearch)}" placeholder="Search chats…" autocomplete="off"></div>
    <div class="wa-filters"><button class="${state.chatFilter==="all"?"active":""}" data-chat-filter="all">All</button><button class="${state.chatFilter==="unread"?"active":""}" data-chat-filter="unread">Unread${unread?` <b>${unread}</b>`:""}</button><button class="${state.chatFilter==="groups"?"active":""}" data-chat-filter="groups">Groups${groups?` <b>${groups}</b>`:""}</button></div>
    <div class="wa-chat-list" id="recent-chat-list">${threadsError?`<div class="wa-error"><strong>Chats लोड नहीं हुईं</strong><span>${esc(threadsError)}</span><button class="btn small" id="chat-retry-all">फिर कोशिश करें</button></div>`:renderChatRows(threads,state.chatFilter,state.chatSearch)}</div>
    <div class="wa-new-chat-panel" id="new-chat-panel">
      <div class="wa-new-chat-head"><button type="button" class="wa-icon-btn" id="chat-close-new">‹</button><div><strong>New Chat</strong><small>Member या अधिकृत पदाधिकारी चुनें</small></div></div>
      <div class="wa-chat-search"><span>⌕</span><input id="chat-people-search" placeholder="नाम खोजें…" autocomplete="off"></div>
      <div class="wa-chat-list" id="chat-people-list">${peopleError?`<div class="wa-error"><strong>Participants उपलब्ध नहीं</strong><span>${esc(peopleError)}</span><button class="btn small" id="chat-retry-people">फिर कोशिश करें</button></div>`:renderNewChatPeople(people)}</div>
    </div>
  </section>`;
}

async function openChatThread(conversationId){
  const actorType=chatActorType();
  if(!conversationId)return;
  try{
    const r=await rpc("rkms_chat_messages",{p_conversation_id:conversationId,p_actor_type:actorType});
    if(r?.error)throw r.error;if(r?.success===false)throw new Error(r.message||"Chat नहीं खुली।");
    const messages=Array.isArray(r?.data)?r.data:[];
    state.activeChatThreadId=conversationId;
    const meta=(state.chatThreads||[]).find(x=>String(x.conversation_id)===String(conversationId))||{};
    const html=renderChatConversation(conversationId,messages,meta);
    const app=document.querySelector("#app");if(app)app.innerHTML=html;
    requestAnimationFrame(()=>{const box=document.querySelector("#chat-messages");if(box)box.scrollTop=box.scrollHeight;});
    return html;
  }catch(e){console.error("openChatThread",e);toast(e?.message||"Chat खोलने में समस्या हुई।");}
}

async function openNewChat(recipientId,recipientType){
  try{
    const r=await rpc("rkms_chat_open",{p_actor_type:chatActorType(),p_other_type:recipientType,p_other_id:recipientId});
    if(r?.error)throw r.error;if(r?.success===false)throw new Error(r.message||"Chat conversation नहीं बन सकी।");
    const conversationId=r?.conversation_id;if(!conversationId)throw new Error("Chat conversation नहीं बन सकी।");
    state.activeChatThreadId=conversationId;
    await loadChatThreads().catch(()=>{});
    return openChatThread(conversationId);
  }catch(e){console.error("openNewChat",e);toast(e?.message||"Chat खोलने में समस्या हुई।");}
}

function renderChatAttachment(x){
  const url=x.attachment_url;if(!url)return "";
  const type=String(x.attachment_type||"").toLowerCase();const name=x.attachment_name||"Attachment";
  if(type.startsWith("image/"))return `<a class="wa-attachment wa-image" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy"></a>`;
  if(type.startsWith("video/"))return `<video class="wa-attachment wa-video" controls preload="metadata"><source src="${esc(url)}" type="${esc(type)}"></video>`;
  if(type.startsWith("audio/"))return `<div class="wa-audio"><audio controls src="${esc(url)}"></audio><small>${esc(name)}</small></div>`;
  return `<a class="wa-file" href="${esc(url)}" target="_blank" rel="noopener"><span>📄</span><span><strong>${esc(name)}</strong><small>${esc(type||"File")}</small></span>↗</a>`;
}

function renderChatConversation(conversationId,messages,meta={}){
  const name=meta.other_name||meta.name||"Chat";const role=meta.other_role||(meta.is_group?"Group":"सदस्य");
  const rows=messages.map(x=>{
    const mine=String(x.sender_auth_user_id||"")===String(state.user?.id||"");
    const deleted=x.deleted_for_everyone;
    const body=deleted?"यह संदेश हटा दिया गया है।":(x.body||"");
    const attachment=deleted?"":renderChatAttachment(x);
    return `<div class="wa-message-row ${mine?"mine":"theirs"}" data-message-id="${esc(x.id)}">
      <div class="wa-message-bubble ${deleted?"deleted":""}">
        ${!mine&&meta.is_group&&x.sender_name?`<div class="wa-group-sender">${esc(x.sender_name)}</div>`:""}${attachment}${body?`<div class="wa-message-body">${esc(body).replace(/\n/g,"<br>")}</div>`:""}
        <div class="wa-message-foot"><time>${esc(x.sent_at?new Date(x.sent_at).toLocaleTimeString("hi-IN",{hour:"2-digit",minute:"2-digit"}):"")}</time>${mine&&!deleted?`<span class="wa-ticks">${x.read_at?"✓✓":"✓"}</span>`:""}<button type="button" class="wa-message-menu" data-message-menu="${esc(x.id)}">⋮</button></div>
      </div>
    </div>`;
  }).join("");
  return `<section class="wa-conversation-screen">
    <header class="wa-conv-head"><button type="button" class="wa-icon-btn" id="chat-back-list">‹</button><span class="wa-avatar-wrap">${chatAvatar(meta.other_photo,name,!!meta.is_group)}</span><div class="wa-conv-title"><strong>${esc(name)}</strong><small>${esc(role)}${meta.member_count?` · ${esc(meta.member_count)} सदस्य`:``}</small></div><button type="button" class="wa-icon-btn" id="chat-conv-refresh" title="Refresh Chat">↻</button><button type="button" class="wa-icon-btn" id="chat-conv-menu">⋮</button></header>
    <main id="chat-messages" class="wa-messages">${rows||`<div class="wa-chat-empty-conv"><div>🔐</div><strong>संदेश सुरक्षित हैं</strong><small>बातचीत शुरू करने के लिए नीचे संदेश भेजें।</small></div>`}</main>
    <div class="wa-compose-wrap"><div class="wa-attachment-preview" id="chat-attachment-preview"></div><form id="chat-send-form" class="wa-compose"><button type="button" class="wa-plus" id="chat-attach">＋</button><input id="chat-file-input" type="file" hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"><input id="chat-message-input" autocomplete="off" placeholder="संदेश लिखें…"><button type="button" class="wa-mic" id="chat-mic" title="Voice message">🎙️</button><button class="wa-send" type="submit" title="Send">➤</button></form></div>
    <div class="wa-conv-menu" id="chat-conv-menu-pop"><button data-conv-action="clear">🧹 Chat साफ करें</button><button data-conv-action="delete">🗑️ Chat delete करें</button></div>
  </section>`;
}

async function uploadChatFile(file){
  if(!file)throw new Error("File चुनें।");
  const max=50*1024*1024;if(file.size<=0||file.size>max)throw new Error("Attachment 50 MB तक हो सकता है।");
  const allowedPrefixes=["image/","video/","audio/"];const allowedExt=/\.(pdf|doc|docx|txt)$/i;
  if(!allowedPrefixes.some(x=>file.type.startsWith(x))&&!allowedExt.test(file.name))throw new Error("यह file type Chat में स्वीकार नहीं है।");
  await validateFileSignature(file,"general");
  const ext=(file.name.split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"")||"bin";
  const safe=file.name.replace(/\.[^/.]+$/,"" ).replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,70)||"file";
  const path=`chat/${Date.now()}-${Math.random().toString(36).slice(2,9)}-${safe}.${ext}`;
  const r=await fetch(`${STORE}/object/rkms-media/${path}`,{method:"POST",headers:{apikey:ANON,Authorization:"Bearer "+token(),"Content-Type":file.type||"application/octet-stream","x-upsert":"false"},body:file});
  const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}if(!r.ok)throw new Error(d?.message||d?.error||t||"Attachment upload नहीं हुआ।");
  return {url:`${SUPA}/storage/v1/object/public/rkms-media/${path}`,name:file.name,type:file.type||"application/octet-stream",size:file.size};
}

async function sendChatMessage(){
  const input=document.getElementById("chat-message-input");const fileInput=document.getElementById("chat-file-input");const cid=state.activeChatThreadId;
  if(!cid)return;
  const body=String(input?.value||"").trim();const file=fileInput?.files?.[0]||null;
  if(!body&&!file)return;
  const send=document.querySelector(".wa-send");if(send)send.disabled=true;
  try{
    let a=null;if(file)a=await uploadChatFile(file);
    const r=await rpc("rkms_chat_send_message",{p_conversation_id:cid,p_actor_type:chatActorType(),p_body:body,p_attachment_url:a?.url||null,p_attachment_name:a?.name||null,p_attachment_type:a?.type||null});
    if(r?.error)throw r.error;if(r?.success===false)throw new Error(r.message||"Message send नहीं हुआ।");
    // The DB trigger also attempts dispatch. Calling the authenticated sender
    // endpoint here is a safe fallback for installations where pg_net is delayed.
    const pushIds=Array.isArray(r?.push_queue_ids)?r.push_queue_ids:[];
    for(const qid of pushIds){
      try{await request(`${SUPA}/functions/v1/rkms-fcm-push`,{method:"POST",headers:authHeaders(),body:JSON.stringify({action:"send_queue",queue_id:qid})});}catch(e){console.warn("RKMS push dispatch",e);}
    }
    if(input)input.value="";if(fileInput)fileInput.value="";document.querySelector("#chat-attachment-preview").innerHTML="";
    await openChatThread(cid);
  }catch(e){toast(e?.message||"Message send नहीं हुआ।");}finally{if(send)send.disabled=false;}
}

function showChatActionSheet(title,actions){
  document.querySelector("#chat-action-sheet")?.remove();
  const html=`<div class="wa-action-backdrop" id="chat-action-sheet"><div class="wa-action-sheet"><div class="wa-action-title">${esc(title)}</div>${actions.map(a=>`<button type="button" data-sheet-action="${esc(a.key)}" class="${a.danger?"danger":""}">${esc(a.label)}</button>`).join("")}<button type="button" data-sheet-close>रद्द करें</button></div></div>`;
  document.body.insertAdjacentHTML("beforeend",html);
  const box=document.querySelector("#chat-action-sheet");
  box?.addEventListener("click",e=>{if(e.target===box||e.target.closest("[data-sheet-close]")){box.remove();return;}const b=e.target.closest("[data-sheet-action]");if(!b)return;const a=actions.find(x=>x.key===b.dataset.sheetAction);box.remove();if(a?.run)a.run();});
}

async function deleteChatMessage(id,mode){
  if(!id)return;if(!confirm(mode==="EVERYONE"?"यह message सभी के लिए delete करें?":"यह message सिर्फ अपनी chat से delete करें?"))return;
  try{const r=await rpc("rkms_chat_delete_message",{p_message_id:id,p_actor_type:chatActorType(),p_mode:mode});if(r?.success===false)throw new Error(r.message||"Message delete नहीं हुआ।");await openChatThread(state.activeChatThreadId);}catch(e){toast(e.message||"Message delete नहीं हुआ।");}
}
async function hideChat(cid,action){
  if(!cid)return;const text=action==="DELETE"?"यह chat आपकी Recent Chats से delete हो जाएगी। दूसरी तरफ की chat सुरक्षित रहेगी।":"इस chat के पुराने messages आपकी screen से साफ हो जाएंगे।";
  if(!confirm(text+"\n\nजारी रखें?"))return;
  try{const r=await rpc("rkms_chat_hide",{p_conversation_id:cid,p_actor_type:chatActorType(),p_mode:action});if(r?.success===false)throw new Error(r.message||"Action नहीं हुआ।");state.activeChatThreadId=null;await render();}catch(e){toast(e.message||"Action नहीं हुआ।");}
}

async function createChatGroup(){
  const name=val("chat-group-name");const selected=[...document.querySelectorAll("#chat-group-people input:checked")].map(x=>({type:x.dataset.groupType,id:x.dataset.groupId}));
  if(!name){toast("Group का नाम लिखें।");return;}if(selected.length<1){toast("कम से कम एक सदस्य चुनें।");return;}
  const btn=document.querySelector("#chat-create-group");if(btn)btn.disabled=true;
  try{const r=await rpc("rkms_chat_create_group",{p_actor_type:chatActorType(),p_name:name,p_description:null,p_participants:selected,p_photo_url:null});if(r?.success===false)throw new Error(r.message||"Group नहीं बना।");document.querySelector("#chat-group-modal")?.remove();await loadChatThreads();return openChatThread(r.conversation_id);}catch(e){toast(e.message||"Group नहीं बना।");}finally{if(btn)btn.disabled=false;}
}

function bindChatScreen(){
  document.querySelectorAll("[data-chat-filter]").forEach(b=>b.onclick=()=>{state.chatFilter=b.dataset.chatFilter;render().catch(e=>toast(e.message));});
  document.querySelector("#chat-list-search")?.addEventListener("input",e=>{state.chatSearch=e.target.value;const box=document.querySelector("#recent-chat-list");if(box)box.innerHTML=renderChatRows(state.chatThreads||[],state.chatFilter||"all",state.chatSearch);});
  document.querySelector("#chat-new-menu")?.addEventListener("click",()=>document.querySelector("#new-chat-panel")?.classList.add("open"));
  document.querySelector("#chat-close-new")?.addEventListener("click",()=>document.querySelector("#new-chat-panel")?.classList.remove("open"));
  document.querySelector("#chat-new-group")?.addEventListener("click",()=>{document.body.insertAdjacentHTML("beforeend",renderChatGroupModal());bindChatGroupModal();});
  document.querySelector("#chat-refresh")?.addEventListener("click",async e=>{
    const b=e.currentTarget;if(b.dataset.busy==="1")return;b.dataset.busy="1";b.disabled=true;b.textContent="…";
    try{await render();}catch(err){toast(err?.message||"Chat refresh नहीं हुई।");}
    finally{b.disabled=false;b.dataset.busy="0";b.textContent="↻";}
  });
  document.querySelector("#chat-retry-all")?.addEventListener("click",()=>render().catch(e=>toast(e.message)));
  document.querySelector("#chat-retry-people")?.addEventListener("click",()=>render().catch(e=>toast(e.message)));
  document.querySelector("#chat-people-search")?.addEventListener("input",e=>{const box=document.querySelector("#chat-people-list");if(box)box.innerHTML=renderNewChatPeople(state.chatPeople||[],e.target.value);});
}
function bindChatGroupModal(){
  document.querySelectorAll("[data-modal-close]").forEach(b=>b.onclick=()=>document.querySelector("#chat-group-modal")?.remove());
  document.querySelector("#chat-create-group")?.addEventListener("click",createChatGroup);
  document.querySelector("#chat-group-search")?.addEventListener("input",e=>{const q=e.target.value.toLowerCase();document.querySelectorAll("#chat-group-people .wa-select-person").forEach(x=>x.style.display=x.textContent.toLowerCase().includes(q)?"grid":"none");});
}

async function renderPasswordResetRequests(){
 if(!["super_admin","officer"].includes(state.role)){await refreshIdentity();if(!["super_admin","officer"].includes(state.role))return loginScreen();}
 return `<section class="screen">${screenHead("Password Reset Requests","Member के password reset requests की सुरक्षित approval")}<div class="card"><div class="actions"><button class="btn" id="resetRefresh">↻ Refresh</button></div><div id="resetRequestList" class="grid" style="margin-top:14px"><div class="note">लोड हो रहा है…</div></div></div></section>`;
}
async function loadPasswordResetRequests(){
 const box=document.querySelector("#resetRequestList");if(!box)return;box.innerHTML='<div class="note">लोड हो रहा है…</div>';
 try{const r=await rpc("rkms_list_member_password_reset_requests",{p_status:"PENDING",p_limit:100});const rows=arrOf(r);box.innerHTML=rows.map(x=>`<article class="card"><h3>${esc(x.member_name||"")}</h3><p>Member ID: <b>${esc(x.member_id||"—")}</b></p><p>${esc(x.mobile||"")} · ${esc(x.email||"")}</p><p>${esc([x.state,x.mandal,x.district,x.tehsil,x.block,x.village].filter(Boolean).join(" / "))}</p><p>Request: ${esc(x.created_at||"")}</p><div class="actions"><button class="btn" data-reset-approve="${esc(x.id)}">Approve</button><button class="btn danger" data-reset-reject="${esc(x.id)}">Reject</button></div></article>`).join("")||cardEmpty("कोई Pending Password Reset Request नहीं है।");box.querySelectorAll("[data-reset-approve]").forEach(b=>b.onclick=()=>reviewPasswordReset(b.dataset.resetApprove,"APPROVED",b));box.querySelectorAll("[data-reset-reject]").forEach(b=>b.onclick=()=>reviewPasswordReset(b.dataset.resetReject,"REJECTED",b));}catch(e){box.innerHTML=`<div class="msg err">${esc(e.message||"Requests नहीं मिलीं।")}</div>`}
}
async function reviewPasswordReset(id,status,button){
 if(!confirm(status==="APPROVED"?"इस reset request को Approve करना है?":"इस reset request को Reject करना है?"))return;
 button.disabled=true;
 try{
   if(status==="APPROVED"){
     const r=await request(`${SUPA}/functions/v1/rkms-member-password`,{
       method:"POST",
       headers:{apikey:ANON,Authorization:"Bearer "+token(),"Content-Type":"application/json"},
       body:JSON.stringify({action:"pda_review_password_reset",request_id:id})
     });
     if(!r?.success)throw new Error(r?.message||"Password Reset approve नहीं हुआ।");
     toast("Password Reset Approved — नया Password अब Login के लिए active है।");
   }else{
     const reason=prompt("Reject का कारण लिखें")||"Reject";
     const r=await rpc("rkms_review_member_password_reset",{p_request_id:id,p_action:"REJECTED",p_reason:reason});
     if(!r?.success)throw new Error(r?.message||"Reject save नहीं हुआ।");
     toast("Password Reset Rejected");
   }
   await loadPasswordResetRequests();
 }catch(e){button.disabled=false;toast(e.message||"Action save नहीं हुआ।")}
}
function bindPasswordResetRequests(){document.querySelector("#resetRefresh")?.addEventListener("click",loadPasswordResetRequests);loadPasswordResetRequests();}

async function boot(){
 bindHistory();
 const initial=route();
 if(!history.state?.rkmsApp){
   history.replaceState({rkmsRoute:initial,rkmsIndex:0,rkmsApp:true,rkmsAuthenticated:!!token()},"","#"+initial);
 }else if(history.state.rkmsRoute!==initial){
   history.replaceState({...history.state,rkmsRoute:initial,rkmsApp:true},"",location.hash||("#"+initial));
 }
 writeScreenStack([initial]);
 document.querySelector("#menuBtn").onclick=()=>document.querySelector("#nav").classList.toggle("open");
 await setupOpening();
 await refreshIdentity();
 await render();
}
window.addEventListener("unhandledrejection",e=>{
  const msg=e?.reason?.message||"अचानक तकनीकी त्रुटि हुई। कृपया फिर कोशिश करें।";
  console.error("RKMS unhandled rejection:",e.reason);
  if(!document.querySelector(".toast")) toast(msg);
});
window.addEventListener("error",e=>{
  if(e?.error) console.error("RKMS runtime error:",e.error);
});

document.addEventListener("DOMContentLoaded",boot);

document.addEventListener("click", async e=>{
  const recent=e.target.closest?.(".recent-chat");
  if(recent){e.preventDefault();await openChatThread(recent.dataset.conversationId||"");return;}
  const person=e.target.closest?.(".chat-person");
  if(person){e.preventDefault();document.querySelector("#new-chat-panel")?.classList.remove("open");await openNewChat(person.dataset.recipientId||"",person.dataset.recipientType||"MEMBER");return;}
  const rowAction=e.target.closest?.("[data-chat-action]");
  if(rowAction){
    e.preventDefault();e.stopPropagation();
    const cid=rowAction.dataset.conversationId;
    if(rowAction.dataset.chatAction==="menu"){
      showChatActionSheet("Chat विकल्प",[
        {key:"clear",label:"🧹 Chat साफ करें",run:()=>hideChat(cid,"CLEAR")},
        {key:"delete",label:"🗑️ Chat delete करें",danger:true,run:()=>hideChat(cid,"DELETE")}
      ]);
    }
    return;
  }
  const msgMenu=e.target.closest?.("[data-message-menu]");
  if(msgMenu){
    e.preventDefault();e.stopPropagation();
    const id=msgMenu.dataset.messageMenu;
    const own=msgMenu.closest(".wa-message-row")?.classList.contains("mine");
    const actions=[{key:"me",label:"🗑️ Delete for me",run:()=>deleteChatMessage(id,"ME")}];
    if(own)actions.push({key:"everyone",label:"🗑️ Delete for everyone",danger:true,run:()=>deleteChatMessage(id,"EVERYONE")});
    showChatActionSheet("Message विकल्प",actions);
    return;
  }
  const back=e.target.closest?.("#chat-back-list");
  if(back){e.preventDefault();state.activeChatThreadId=null;await render();return;}
  const convRefresh=e.target.closest?.("#chat-conv-refresh");
  if(convRefresh){
    const cid=state.activeChatThreadId;if(!cid)return;
    convRefresh.disabled=true;convRefresh.textContent="…";
    try{await openChatThread(cid);}finally{convRefresh.disabled=false;convRefresh.textContent="↻";}
    return;
  }
  const convMenu=e.target.closest?.("#chat-conv-menu");
  if(convMenu){document.querySelector("#chat-conv-menu-pop")?.classList.toggle("open");return;}
  const convAction=e.target.closest?.("[data-conv-action]");
  if(convAction){document.querySelector("#chat-conv-menu-pop")?.classList.remove("open");await hideChat(state.activeChatThreadId,convAction.dataset.convAction==="delete"?"DELETE":"CLEAR");return;}
  const attach=e.target.closest?.("#chat-attach");
  if(attach){document.querySelector("#chat-file-input")?.click();return;}
  const mic=e.target.closest?.("#chat-mic");
  if(mic){await toggleChatRecorder(mic);return;}
});

document.addEventListener("change",e=>{
  if(!e.target.matches?.("#chat-file-input"))return;
  const file=e.target.files?.[0];const box=document.querySelector("#chat-attachment-preview");if(!box)return;
  box.innerHTML=file?`<span>📎 ${esc(file.name)}</span><button type="button" id="chat-remove-attachment">×</button>`:"";
});
document.addEventListener("click",e=>{
  if(e.target.closest?.("#chat-remove-attachment")){const f=document.querySelector("#chat-file-input");if(f)f.value="";document.querySelector("#chat-attachment-preview").innerHTML="";}
});

document.addEventListener("submit", async e=>{
  if(!e.target.matches?.("#chat-send-form"))return;
  e.preventDefault();await sendChatMessage();
});

let chatRecorder=null,chatRecordChunks=[];
async function toggleChatRecorder(button){
  if(chatRecorder&&chatRecorder.state==="recording"){
    chatRecorder.stop();button.textContent="🎙️";button.classList.remove("recording");return;
  }
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast("इस browser में voice recording उपलब्ध नहीं है।");return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    chatRecordChunks=[];chatRecorder=new MediaRecorder(stream);chatRecorder.ondataavailable=e=>{if(e.data.size)chatRecordChunks.push(e.data)};
    chatRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chatRecordChunks,{type:chatRecorder.mimeType||"audio/webm"});const file=new File([blob],`voice-${Date.now()}.webm`,{type:blob.type});const input=document.querySelector("#chat-file-input");if(input){const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;document.querySelector("#chat-attachment-preview").innerHTML=`<span>🎙️ Voice message तैयार है</span><button type="button" id="chat-remove-attachment">×</button>`;}}
    chatRecorder.start();button.textContent="⏹️";button.classList.add("recording");toast("Recording शुरू… फिर 🎙️ दबाकर भेजें।");
  }catch(e){toast("Microphone permission नहीं मिली।");}
}



/* Smooth SPA transition: prevents the black flash during route changes. */
(function installSmoothRouteTransition(){
  if(window.__rkmsSmoothRouteTransitionInstalled) return;
  window.__rkmsSmoothRouteTransitionInstalled=true;
  document.documentElement.classList.add("rkms-app-ready");
  let timer=null;
  window.rkmsBeginRouteTransition=function(){
    document.documentElement.classList.add("rkms-route-changing");
    clearTimeout(timer);
    timer=setTimeout(()=>document.documentElement.classList.remove("rkms-route-changing"),180);
  };
  window.rkmsEndRouteTransition=function(){
    clearTimeout(timer);
    document.documentElement.classList.remove("rkms-route-changing");
  };
})();






/* PDA officer directory hierarchy: senior organizational posts first. */
function rkmsPdaPostRank(post){
  const p=String(post||"").trim().toLowerCase()
    .replace(/\s+/g," ").replace(/।/g,"");
  const rules=[
    ["राष्ट्रीय अध्यक्ष",10],["national president",10],
    ["राष्ट्रीय उपाध्यक्ष",20],["national vice president",20],
    ["राष्ट्रीय महासचिव",30],["national general secretary",30],
    ["राष्ट्रीय सचिव",40],["national secretary",40],
    ["प्रदेश अध्यक्ष",50],["state president",50],
    ["प्रदेश उपाध्यक्ष",60],["state vice president",60],
    ["प्रदेश महासचिव",70],["state general secretary",70],
    ["प्रदेश सचिव",80],["state secretary",80],
    ["जिला अध्यक्ष",100],["district president",100],
    ["जिला उपाध्यक्ष",110],["district vice president",110],
    ["जिला महासचिव",120],["district general secretary",120],
    ["जिला सचिव",130],["district secretary",130],
    ["उप जिला अध्यक्ष",140],["उप-जिला अध्यक्ष",140],
    ["tehsil president",150],["तहसील अध्यक्ष",150],
    ["तहसील उपाध्यक्ष",160],["tehsil vice president",160],
    ["ब्लॉक अध्यक्ष",170],["block president",170],
    ["ब्लॉक उपाध्यक्ष",180],["block vice president",180],
    ["ग्राम अध्यक्ष",190],["village president",190],
    ["ग्राम उपाध्यक्ष",200],["village vice president",200],
  ];
  const hit=rules.find(([name])=>p===name || p.includes(name));
  return hit ? hit[1] : 900;
}
function rkmsSortPdaOfficers(list){
  return (Array.isArray(list)?list.slice():[]).sort((a,b)=>{
    const ar=rkmsPdaPostRank(a.post_name||a.post||a.designation||a.role);
    const br=rkmsPdaPostRank(b.post_name||b.post||b.designation||b.role);
    if(ar!==br) return ar-br;
    const an=String(a.district_name||a.district||a.mandal_name||a.mandal||a.name||"").localeCompare(
      String(b.district_name||b.district||b.mandal_name||b.mandal||b.name||""),"hi",{sensitivity:"base"});
    if(an!==0) return an;
    return String(a.name||a.full_name||"").localeCompare(String(b.name||b.full_name||""),"hi",{sensitivity:"base"});
  });
}



/* RKMS FINAL REPAIR: history and book navigation are handled by the live router above. */
