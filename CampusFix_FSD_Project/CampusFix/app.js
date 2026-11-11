const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "campusfix_data_v1";
const USERS = {
  "student@campusfix.demo": {name:"Rasheed Shaik", role:"Student", initials:"RS"},
  "admin@campusfix.demo": {name:"Campus Admin", role:"Admin", initials:"CA"}
};
const seedData = {
  complaints:[
    {id:"CF-1048",title:"Projector not working",category:"Classroom Equipment",location:"Block A · Room 204",priority:"High",description:"The classroom projector is not turning on. The power indicator blinks, but there is no display.",status:"In Progress",date:"2026-11-10",by:"Aarav Kumar"},
    {id:"CF-1047",title:"Water leakage near washroom",category:"Water",location:"Block B · Ground floor",priority:"Urgent",description:"There is continuous water leakage near the washroom entrance. The floor is slippery.",status:"Pending",date:"2026-11-09",by:"Rasheed Shaik"},
    {id:"CF-1046",title:"Wi-Fi signal is weak",category:"Wi-Fi / Internet",location:"Central Library",priority:"Normal",description:"The Wi-Fi connection is unstable in the reading area.",status:"Resolved",date:"2026-11-08",by:"Meera Reddy"},
    {id:"CF-1045",title:"Classroom lights not working",category:"Electrical",location:"Block C · Room 102",priority:"Normal",description:"Two tube lights are not working.",status:"Pending",date:"2026-11-07",by:"Rasheed Shaik"},
    {id:"CF-1044",title:"Dustbins need cleaning",category:"Cleanliness",location:"Cafeteria",priority:"Normal",description:"Please arrange cleaning around the cafeteria bins.",status:"Resolved",date:"2026-11-06",by:"Kiran Rao"}
  ],
  items:[
    {id:"LF-201",type:"Found",category:"Electronics",name:"Black wireless earbuds case",place:"Central Library · 1st floor",contact:"library@campusfix.demo",date:"2026-11-10",emoji:"🎧"},
    {id:"LF-202",type:"Lost",category:"Books & Notes",name:"Data Structures notebook",place:"Block A · Room 204",contact:"student@campusfix.demo",date:"2026-11-09",emoji:"📓"},
    {id:"LF-203",type:"Found",category:"Accessories",name:"Blue water bottle",place:"Sports Ground",contact:"sports@campusfix.demo",date:"2026-11-08",emoji:"🧴"},
    {id:"LF-204",type:"Lost",category:"Personal items",name:"Silver keychain with 2 keys",place:"Cafeteria",contact:"student@campusfix.demo",date:"2026-11-07",emoji:"🔑"}
  ]
};
let data = loadData();
let currentUser = null;
let activeFilter = "All";
let activeComplaintId = null;

function loadData(){
  try { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved) : structuredClone(seedData); }
  catch(e){ return structuredClone(seedData); }
}
function saveData(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function today(){ return new Date().toISOString().slice(0,10); }
function niceDate(value){ return new Date(value+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); }
function escapeHTML(value=""){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600);}
function statusClass(status){return status==="Resolved"?"status-resolved":status==="In Progress"?"status-progress":"status-pending";}
function statusBadge(status){return `<span class="status ${statusClass(status)}">${escapeHTML(status)}</span>`;}
function categoryIcon(category){return ({"Infrastructure":"⌂","Electrical":"ϟ","Cleanliness":"✧","Water":"♧","Wi-Fi / Internet":"⌁","Classroom Equipment":"▣","Other":"◈"})[category]||"◈";}

$("loginForm").addEventListener("submit",e=>{
  e.preventDefault(); const email=$("loginEmail").value.trim().toLowerCase(), pass=$("loginPassword").value;
  if(pass!=="campus123" || !USERS[email]){toast("Invalid demo login. Use one of the demo accounts.");return;}
  login(USERS[email]);
});
$("studentDemo").onclick=()=>{$("loginEmail").value="student@campusfix.demo";$("loginPassword").value="campus123";};
$("adminDemo").onclick=()=>{$("loginEmail").value="admin@campusfix.demo";$("loginPassword").value="campus123";};
$("togglePassword").onclick=()=>{const p=$("loginPassword");p.type=p.type==="password"?"text":"password";$("togglePassword").textContent=p.type==="password"?"Show":"Hide";};
function login(user){currentUser=user;$("loginScreen").classList.add("hidden");$("app").classList.remove("hidden");$("userName").textContent=user.name;$("userRole").textContent=user.role;$("userAvatar").textContent=user.initials;$("roleChip").textContent=user.role.toUpperCase();$("welcomeTitle").innerHTML=`Good to see you, ${escapeHTML(user.name.split(" ")[0])} <span>✦</span>`;$("todayLabel").textContent=new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"}).toUpperCase();renderAll();showPage("overview");}
$("logoutBtn").onclick=()=>{currentUser=null;$("app").classList.add("hidden");$("loginScreen").classList.remove("hidden");};
function showPage(page){document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));$(page+"Page").classList.remove("hidden");document.querySelectorAll(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.page===page));$("crumbPage").textContent=page==="lostfound"?"Lost & Found":page==="complaints"?"Complaints":"Overview";$("sidebar").classList.remove("open");if(page==="complaints")renderComplaints();if(page==="lostfound")renderItems();}
document.querySelectorAll(".nav-link").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.goto)));
$("menuToggle").onclick=()=>$("sidebar").classList.toggle("open");
$("themeToggle").onclick=()=>{document.body.classList.toggle("dark");localStorage.setItem("campusfix_theme",document.body.classList.contains("dark")?"dark":"light");};
if(localStorage.getItem("campusfix_theme")==="dark")document.body.classList.add("dark");

function renderAll(){renderStats();renderRecent();renderComplaints();renderItems();}
function renderStats(){
 const c=data.complaints, total=c.length, pending=c.filter(x=>x.status==="Pending").length, progress=c.filter(x=>x.status==="In Progress").length, resolved=c.filter(x=>x.status==="Resolved").length, pct=total?Math.round(resolved/total*100):0;
 $("statTotal").textContent=total;$("statPending").textContent=pending;$("statProgress").textContent=progress;$("statResolved").textContent=resolved;$("navComplaintCount").textContent=pending;$("filterAll").textContent=total;$("resolvedPercent").textContent=pct+"%";$("legendResolved").textContent=resolved;$("legendPending").textContent=pending;$("legendProgress").textContent=progress;$("donutChart").style.background=`conic-gradient(var(--green) ${pct*3.6}deg, #edf0f6 ${pct*3.6}deg)`;
}
function renderRecent(){
 const list=[...data.complaints].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
 $("recentComplaints").innerHTML=list.map(c=>`<div class="recent-item"><div class="issue-icon">${categoryIcon(c.category)}</div><div><b>${escapeHTML(c.title)}</b><small>${escapeHTML(c.id)} · ${escapeHTML(c.location)}</small></div><div class="recent-right">${statusBadge(c.status)}<small>${niceDate(c.date)}</small></div></div>`).join("")||'<p class="muted">No complaints yet.</p>';
}
function renderComplaints(){
 const q=($("searchInput").value||"").toLowerCase();
 const rows=[...data.complaints].filter(c=>(activeFilter==="All"||c.status===activeFilter)&&[c.title,c.id,c.category,c.location,c.by].join(" ").toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date));
 $("complaintsTable").innerHTML=rows.map(c=>`<tr><td>${escapeHTML(c.title)}<small>${escapeHTML(c.id)} · ${escapeHTML(c.by)}</small></td><td><span class="category-tag">${escapeHTML(c.category)}</span></td><td>${escapeHTML(c.location)}</td><td>${niceDate(c.date)}</td><td>${statusBadge(c.status)}</td><td><button class="action-link" data-view="${c.id}">View details →</button></td></tr>`).join("");
 $("emptyComplaints").classList.toggle("hidden",rows.length>0);
 document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>openDetails(b.dataset.view));
 document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.filter===activeFilter));
}
$("filterTabs").addEventListener("click",e=>{const b=e.target.closest("[data-filter]");if(!b)return;activeFilter=b.dataset.filter;renderComplaints();});
$("searchInput").addEventListener("input",renderComplaints);

function openDetails(id){
 const c=data.complaints.find(x=>x.id===id);if(!c)return;activeComplaintId=id;$("detailTitle").textContent=c.title;
 let adminControls=currentUser.role==="Admin"?`<div class="admin-status"><b>Update status:</b><select id="statusSelect"><option ${c.status==="Pending"?"selected":""}>Pending</option><option ${c.status==="In Progress"?"selected":""}>In Progress</option><option ${c.status==="Resolved"?"selected":""}>Resolved</option></select><button class="btn btn-primary" id="saveStatus">Save</button></div>`:"";
 $("detailContent").innerHTML=`<div class="detail-grid"><div class="detail-cell"><small>COMPLAINT ID</small><b>${escapeHTML(c.id)}</b></div><div class="detail-cell"><small>STATUS</small>${statusBadge(c.status)}</div><div class="detail-cell"><small>CATEGORY</small><b>${escapeHTML(c.category)}</b></div><div class="detail-cell"><small>PRIORITY</small><b>${escapeHTML(c.priority)}</b></div><div class="detail-cell"><small>LOCATION</small><b>${escapeHTML(c.location)}</b></div><div class="detail-cell"><small>REPORTED BY</small><b>${escapeHTML(c.by)}</b></div></div><div class="detail-description"><b>Description</b><p>${escapeHTML(c.description)}</p><small>Reported on ${niceDate(c.date)}</small></div>${adminControls}`;
 $("detailModal").classList.remove("hidden");
 if(currentUser.role==="Admin")$("saveStatus").onclick=()=>{c.status=$("statusSelect").value;saveData();$("detailModal").classList.add("hidden");renderAll();toast("Complaint status updated successfully.");};
}
function openModal(id){$(id).classList.remove("hidden");}
function closeModal(id){$(id).classList.add("hidden");}
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
document.querySelectorAll(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.add("hidden");}));
function newId(prefix){return prefix+"-"+Math.floor(1000+Math.random()*9000);}
["newComplaintBtn","complaintsNewBtn","quickReport","tipReport"].forEach(id=>$(id).onclick=()=>openModal("complaintModal"));
$("complaintForm").addEventListener("submit",e=>{
 e.preventDefault();const c={id:newId("CF"),title:$("issueTitle").value.trim(),category:$("issueCategory").value,location:$("issueLocation").value.trim(),priority:$("issuePriority").value,description:$("issueDescription").value.trim(),status:"Pending",date:today(),by:currentUser.name};
 data.complaints.unshift(c);saveData();e.target.reset();closeModal("complaintModal");renderAll();showPage("complaints");toast("Your complaint was submitted successfully.");
});
$("addItemBtn").onclick=()=>openModal("itemModal");
$("itemForm").addEventListener("submit",e=>{
 e.preventDefault();const type=$("itemType").value,category=$("itemCategory").value;
 const emoji=({"Electronics":"🎧","Books & Notes":"📚","Accessories":"🧢","Personal items":"🔑","Other":"📦"})[category];
 data.items.unshift({id:newId("LF"),type,category,name:$("itemName").value.trim(),place:$("itemPlace").value.trim(),contact:$("itemContact").value.trim(),date:today(),emoji});
 saveData();e.target.reset();closeModal("itemModal");renderItems();toast("Item published to the campus board.");
});
function renderItems(){
 const q=($("itemSearch").value||"").toLowerCase();const list=data.items.filter(x=>[x.name,x.category,x.place,x.type].join(" ").toLowerCase().includes(q));
 $("itemCount").textContent=list.length+" items";
 $("itemsGrid").innerHTML=list.map(x=>`<article class="item-card"><div class="item-card-top"><div class="item-emoji">${x.emoji||"📦"}</div><span class="item-type ${x.type==="Found"?"type-found":"type-lost"}">${escapeHTML(x.type.toUpperCase())}</span></div><h3>${escapeHTML(x.name)}</h3><p>${escapeHTML(x.category)} · ${escapeHTML(x.place)}</p><div class="item-meta"><span>Posted ${niceDate(x.date)}</span><b>${escapeHTML(x.id)}</b></div><div class="item-meta"><span>Contact</span><b>${escapeHTML(x.contact)}</b></div></article>`).join("");
 $("emptyItems").classList.toggle("hidden",list.length>0);
}
$("itemSearch").addEventListener("input",renderItems);
