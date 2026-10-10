import {DISCIPLINES,TIERS,badgeTier,legalWingspans} from './rules.js';
import {normalizeGoals,misses} from './optimizer.js';
import {badgeInsights,badgeChanges} from './badge-insights.js';
import {takeoverInsights,takeoverChanges} from './takeover-insights.js';
const $=id=>document.getElementById(id);
const title=s=>s.split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
const heightLabel=h=>`${Math.floor(h/12)}′${h%12}″`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const total=a=>a.reduce((s,v)=>s+v,0);
const STORAGE='2k27-goals-v1',OBS='2k27-observations-v1';
let data,validation,selectedBadges=[],worker,result,activeBuild,observations={};
const loadStorage=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const saveStorage=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{toast('Browser storage is unavailable. You can still export your recipe.');}};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,3500);}
function rawGoals(){return {height:+$('height').value,wingspan:$('wingspan').value===''?null:+$('wingspan').value,general:+$('general').value,specialization:$('specialization').value,nearby:$('nearby').checked,required:data.attrs.map(a=>$(`required-${a.index}`).value||null),ideal:data.attrs.map(a=>$(`ideal-${a.index}`).value||null),priority:data.attrs.map(a=>$(`priority-${a.index}`).value||0),badges:selectedBadges};}
function persist(){if(data)saveStorage(STORAGE,rawGoals());}
function applyGoals(g){
  $('height').value=g.height??77;$('general').value=g.general??5;$('specialization').value=g.specialization??'auto';$('nearby').checked=g.nearby!==false;
  updateWingspanOptions(g.wingspan??'');
  for(const a of data.attrs)for(const k of ['required','ideal','priority']){const value=g[k]?.[a.index];$(`${k}-${a.index}`).value=value==null||(k==='priority'&&!+value)||(k==='required'&&+value===25)?'':value;}
  selectedBadges=(g.badges??[]).filter(s=>data.badges.some(b=>b.badge===+s.badge));renderBadgeGoals();updateBadgeAvailability();persist();
}
function renderBadgeGoals(){
  $('required-badges').innerHTML=selectedBadges.map(s=>{const b=data.badges.find(b=>b.badge===+s.badge);return `<span class="badge-chip">${esc(b.label)} · ${title(TIERS[s.tier])}<button type="button" data-remove-badge="${s.badge}" aria-label="Remove ${esc(b.label)}">×</button></span>`;}).join('');
}
function updateBadgeAvailability(){for(const option of $('badge-select').options){const b=data.badges.find(b=>b.badge===+option.value),height=+$('height').value;option.textContent=b.label+(height<b.height_inches[0]||height>b.height_inches[1]?' · height restricted':'');}}
function updateWingspanOptions(selection=$('wingspan').value){
  const spans=legalWingspans(data,+$('height').value),value=selection==='auto'?'':String(selection),invalid=value!==''&&!spans.includes(+value);
  $('wingspan').innerHTML='<option value="">Auto — optimize for me</option>'+spans.map(s=>`<option value="${s}">${heightLabel(s)} (${s} in)</option>`).join('')+(invalid?`<option value="${esc(value)}">${esc(value)} in · not legal at this height</option>`:'');
  $('wingspan').value=value;
  const message=invalid?'Your selected wingspan is not legal at this height. Choose another wingspan or Auto.':'';
  $('wingspan').setCustomValidity(message);$('wingspan').setAttribute('aria-invalid',String(invalid));
  $('wingspan-help').textContent=message||(value===''?'Auto chooses the best wingspan for your goals.':'Fixed for all builds, including nearby heights where legal.');
  $('wingspan-help').classList.toggle('invalid',invalid);
}
function requiredTokens(build,final,goals=result.goals){
  const tokens=[];goals.required.forEach((r,i)=>{if(r>25)tokens.push(`<span class="goal-token ${final[i]<r?'miss':''}">${esc(data.attrs[i].label)} ${final[i]} / ${r}</span>`);});
  for(const s of goals.badges){const b=data.badges.find(b=>b.badge===+s.badge),tier=badgeTier(b,build.body.height,final);tokens.push(`<span class="goal-token ${tier<+s.tier?'miss':''}">${esc(b.label)} · ${tier>=0?title(TIERS[tier]):'Not qualified'} / ${title(TIERS[s.tier])}</span>`);}
  return tokens.join('');
}
function checkObserved(build,goals=result.goals){
  const saved=observations[build.id]??{};let seen=0,mismatch=0,locked=0;
  const final=build.base.map((base,i)=>{
    let gain=0;for(let step=0;step<build.counts[i];step++){const observed=saved[i]?.[step];if(observed!=null){seen++;if(observed!==build.sequences[i][step])mismatch++;if(observed===0)locked++;}gain+=observed??build.sequences[i][step];}return base+gain;
  });
  const missing=misses(data,goals,build.body.height,final),all=seen===total(build.counts)&&seen>0;
  return {final,seen,mismatch,locked,all,missing};
}
function recipeRows(build,final,goals=result.goals){
  const saved=observations[build.id]??{};
  return data.attrs.map((a,i)=>{
    const gains=Array.from({length:build.counts[i]},(_,step)=>saved[i]?.[step]??build.sequences[i][step]);
    return `<tr data-attribute="${i}" class="${final[i]<goals.required[i]?'miss-row':build.counts[i]?'changed':''}"><td>${esc(a.label)}</td><td>${build.base[i]}</td><td>${build.pool.general[i]||'—'}</td><td>${build.pool.spec[i]||'—'}</td><td class="rating-gain">${gains.length?`<strong>+${final[i]-build.base[i]}</strong><small>Steps: ${gains.map(g=>`+${g}`).join(' → ')}</small>`:'—'}</td><td>${final[i]}</td></tr>`;
  }).join('');
}
const tierLabel=tier=>tier<0?'Not qualified':title(TIERS[tier]);
function thresholdBadges(build,final){
  const insights=badgeInsights(data,build.body.height,final,build.caps);
  const edits=changes=>changes.map(c=>`${esc(c.label)} ${c.from} → ${c.to} (${c.delta>0?'+':''}${c.delta})`).join(' and ');
  return `<details class="badge-thresholds" open><summary>Badge thresholds · ${insights.close.length} close / ${insights.barely.length} barely qualified</summary><p>Within ${insights.window} total rating points of gaining or losing a tier. Based on final ratings after breakers.</p>
  <div class="threshold-grid"><section><h4>On the verge</h4>${insights.close.length?`<ul>${insights.close.map(b=>`<li><strong>${esc(b.label)} · ${tierLabel(b.tier)}</strong><span>Needs ${edits(b.changes)}.</span>${b.blocked?'<span class="threshold-blocked">Blocked by this body’s attribute cap.</span>':''}</li>`).join('')}</ul>`:'<p>No next badge tiers within 3 rating points.</p>'}</section>
  <section><h4>Barely getting</h4>${insights.barely.length?`<ul>${insights.barely.map(b=>`<li><strong>${esc(b.label)} · ${tierLabel(b.tier)}</strong><span>Loses this tier if ${edits(b.changes)}.</span></li>`).join('')}</ul>`:'<p>No qualified tiers within 3 rating points of being lost.</p>'}</section></div><p>These are threshold comparisons. An upgrade still needs builder room or available breakers; equipping badges needs tokens and slots.</p></details>`;
}
function takeoverPanel(build,final){
  const insights=takeoverInsights(data,final,build.caps);
  const requirements=t=>t.requirements.map((r,i)=>`${esc(data.attrs[r.attribute].label)} ${r.minimum}${i<t.requirements.length-1?` ${r.operator_to_next} `:''}`).join('')||'No rating gate';
  const edits=changes=>changes.map(c=>`${esc(c.label)} ${c.from} → ${c.to} (${c.delta>0?'+':''}${c.delta})`).join(' and ');
  const missingRow=t=>`<li data-takeover="${t.id}" data-takeover-status="${t.points<=insights.window?'close':'locked'}"><strong>${esc(t.label)} · ${title(t.discipline)}</strong><span>Needs ${edits(t.changes)}.</span>${t.blocked?'<span class="threshold-blocked">Blocked by this body’s attribute cap.</span>':''}</li>`;
  const other=insights.locked.filter(t=>t.points>insights.window);
  return `<details class="takeover-panel" open><summary>Takeovers · ${insights.qualified.length} specialist qualifications</summary><p>Based on final ratings after breakers. In-game progression and purchased upgrades also determine what you can equip.</p>
  <h4>Takeovers this build qualifies for</h4><div class="takeover-qualifications">${DISCIPLINES.filter(d=>d!=='physicals').map(d=>{
    const available=insights.qualified.filter(t=>t.discipline===d);
    return `<section><h5>${title(d)}</h5>${available.length?`<ul>${available.map(t=>`<li data-takeover="${t.id}" data-takeover-status="qualified"><strong>${esc(t.label)}</strong><span>${requirements(t)}</span></li>`).join('')}</ul>`:'<p>No specialist rating qualifications.</p>'}</section>`;
  }).join('')}</div>
  <p class="takeover-defaults"><strong>No rating gate:</strong> ${insights.defaults.map(t=>esc(t.label)).join(', ')}; ${insights.universal.map(t=>`${esc(t.label)} (${title(t.discipline)})`).join(', ')}. Progression requirements still apply.</p>
  <div class="threshold-grid"><section class="takeover-close"><h4>On the verge · ${insights.close.length}</h4>${insights.close.length?`<ul>${insights.close.map(missingRow).join('')}</ul>`:`<p>No locked specialist takeovers within ${insights.window} total rating points.</p>`}</section>
  <section class="takeover-barely"><h4>Barely qualifying · ${insights.barely.length}</h4>${insights.barely.length?`<ul>${insights.barely.map(t=>`<li data-takeover="${t.id}" data-takeover-status="barely"><strong>${esc(t.label)} · ${title(t.discipline)}</strong><span>Loses qualification if ${edits(t.changes)}.</span></li>`).join('')}</ul>`:`<p>No specialist qualifications within ${insights.window} total rating points of being lost.</p>`}</section></div>
  ${other.length?`<details><summary>Other locked takeover requirements (${other.length})</summary><ul class="takeover-locked">${other.map(missingRow).join('')}</ul></details>`:''}
  <p>Close and barely qualifying use a ${insights.window}-point window. Increases still need builder room or available breakers. <a href="${esc(data.takeoverMeta.url)}" target="_blank" rel="noreferrer">Named requirements</a> checked ${data.takeoverMeta.checked}; confirm in 2K.</p></details>`;
}
function recipeTable(build,final,goals=result.goals,seen=false){
  return `<div class="recipe"><table><thead><tr><th scope="col">Attribute</th><th scope="col">Builder</th><th scope="col">General<br>breakers</th><th scope="col">Spec.<br>breakers</th><th scope="col">Rating gain${seen?'*':''}</th><th scope="col">Final${seen?'*':''}</th></tr></thead><tbody>${recipeRows(build,final,goals)}</tbody></table></div>`;
}
function adjustmentPanel(near){
  if(!near.adjustments?.length)return '<div class="warning">No validated rating-cut recipe was found for this near miss. Try fewer required ratings, a lower badge tier, or another height.</div>';
  return `<section class="adjustments"><h4>How to make this creation valid</h4><p>These alternatives keep this body, specialization, and breaker budget. Each recipe fits the modeled 99 OVR budget after the listed cuts, with remaining room used for secondary stats. Your original goals stay in place until you choose revised goals.</p>${near.adjustments.map((a,index)=>{
    const b=a.build,check=checkObserved(b,a.goals),impact=badgeChanges(data,b.body.height,near.final,check.final),takeoverImpact=takeoverChanges(data,near.final,check.final);
    return `<div class="adjustment-option"><h4>Option ${index+1} · ${esc(a.label)}</h4><p><strong>${b.ovr.uncapped.toFixed(2)} modeled builder OVR</strong> · ${b.pool.generalUsed} general + ${b.pool.specUsed} specialization breakers.</p>
    <div class="adjustment-table"><table><thead><tr><th scope="col">Attribute</th><th scope="col">Builder</th><th scope="col">Final</th><th scope="col">Required goal</th></tr></thead><tbody>${a.changes.map(c=>`<tr><td>${esc(c.label)}</td><td>${c.builderFrom} → ${c.builderTo}</td><td>${c.finalFrom} → ${check.final[c.attribute]}</td><td>${c.requiredFrom===c.requiredTo?'Unchanged':`${c.requiredFrom} → ${c.requiredTo}`}</td></tr>`).join('')||'<tr><td colspan="4">No rating cuts needed. See the complete recipe and any required badge changes below.</td></tr>'}</tbody></table></div>
    ${a.requiredBadges.length?`<p class="required-changes"><strong>Required badge changes:</strong> ${a.requiredBadges.map(c=>`${esc(c.label)} ${tierLabel(c.from)} → ${c.to<0?'Remove requirement':tierLabel(c.to)}`).join('; ')}.</p>`:'<p>All required badge tiers are preserved.</p>'}
    <p><strong>Badge impact:</strong> ${impact.some(c=>c.to<c.from)?impact.filter(c=>c.to<c.from).map(c=>`${esc(c.label)} ${tierLabel(c.from)} → ${tierLabel(c.to)}`).join('; '):'No badge qualifications lost.'}</p>
    ${impact.some(c=>c.to>c.from)?`<details><summary>Badges gained or upgraded (${impact.filter(c=>c.to>c.from).length})</summary><div class="badge-list">${impact.filter(c=>c.to>c.from).map(c=>`<span>${esc(c.label)} ${tierLabel(c.from)} → ${tierLabel(c.to)}</span>`).join('')}</div></details>`:''}
    <p><strong>Takeover impact:</strong> ${takeoverImpact.some(t=>!t.to)?`Loses ${takeoverImpact.filter(t=>!t.to).map(t=>esc(t.label)).join(', ')}.`:'No specialist takeover qualifications lost.'}${takeoverImpact.some(t=>t.to)?` Gains ${takeoverImpact.filter(t=>t.to).map(t=>esc(t.label)).join(', ')}.`:''}</p>
    ${check.seen?`<div class="${check.missing.length||check.locked?'warning':'note-box'}">Observed ${check.seen}/${total(b.counts)} planned steps. ${check.missing.length||check.locked?'This adjusted recipe needs another check; an observed step is locked or a revised goal is missed.':'All revised hard goals still met.'}</div>`:''}
    <details><summary>Complete adjusted recipe, badges, and takeovers</summary>${recipeTable(b,check.final,a.goals,check.seen)}${thresholdBadges(b,check.final)}${takeoverPanel(b,check.final)}</details>
    <div class="card-actions"><button type="button" class="button ghost" data-adjust-near="${esc(near.id)}" data-adjust-index="${index}">Use these revised goals</button><button type="button" class="text-button" data-verify="${esc(b.id)}">Verify adjusted recipe</button><button type="button" class="text-button" data-export="${esc(b.id)}">Export adjusted recipe</button></div></div>`;
  }).join('')}</section>`;
}
function buildEntry(id){
  for(const build of [...result.primary,...result.alternatives])if(build.id===id)return {build,goals:result.goals};
  for(const near of result.nearMisses)for(const adjustment of near.adjustments??[])if(adjustment.build.id===id)return {build:adjustment.build,goals:adjustment.goals,adjustment,near};
}
function buildCard(build,index,near=false){
  const body=build.body,check=build.id?checkObserved(build):{final:build.final,seen:0,missing:build.missing},final=check.final;
  const badgeList=data.badges.map(b=>({...b,tier:badgeTier(b,body.height,final)})).filter(b=>b.tier>=0);
  const ranking=result.goals.priority.map((p,i)=>({p,i})).filter(x=>x.p).sort((a,b)=>a.p-b.p).slice(0,4);
  const note=check.seen?`Observed ${check.seen}/${total(build.counts)} planned steps. ${check.mismatch} differ from the projection.${check.locked?' A planned step is locked.':''} ${check.missing.length?'This recipe misses a hard goal.':'All hard goals still met.'}`:'';
  const label=near?'Near miss':check.all?(check.missing.length||check.locked?'Check failed':'Observed gains'):'Projected';
  const changed=check.seen&&check.mismatch;
  return `<article class="result-card"><div class="card-header"><div><h3>${heightLabel(body.height)} ${esc(body.position)} · ${body.weight} lb</h3><p>${heightLabel(body.wingspan)} wingspan · ${title(build.spec)} specialization${body.positions?.length>1?`<br>Also legal at ${body.positions.filter(p=>p!==body.position).join(', ')}`:''}</p></div><span class="tag ${near||check.missing.length?'failed':check.all?'':'projection'}">${label}</span></div>
  <div class="metrics"><div class="metric"><strong>${(near?build.ovr.uncapped:build.ovr.value).toFixed(2)}</strong><span>Modeled builder OVR</span></div><div class="metric"><strong>${build.pool.generalUsed} + ${build.pool.specUsed}</strong><span>General + specialization used</span></div><div class="metric"><strong>${badgeList.length}</strong><span>Badge qualifications</span></div></div>
  <div class="card-body">${near?`<div class="warning">${esc(build.reason)}</div>`:''}${note?`<div class="${changed||check.missing.length?'warning':'note-box'}">${esc(note)}</div>`:''}
  <p>${near?'This alternative does not meet every requirement.':`${index===0?'Best found':'Another option'} for your priorities: ${ranking.length?ranking.map(x=>`${esc(data.attrs[x.i].label)} ${final[x.i]}`).join(' · '):'balanced improvements across your ideal ratings and remaining attributes'}. ${result.goals.general-build.pool.generalUsed} general and ${2-build.pool.specUsed} specialization breakers remain.`}</p>
  <div class="goals-summary">${requiredTokens(build,final)}</div>
  ${near?`<ul class="score-list">${build.missing.map(m=>`<li>${esc(m.label)}: ${m.kind==='stat'?`${m.actual}, needs ${m.need}`:`needs ${title(TIERS[m.need])}`}</li>`).join('')}</ul>`:''}
  ${near?adjustmentPanel(build):''}
  <details ${index===0&&!near?'open':''}><summary>${near?'Original near-miss recipe':'Builder recipe and breaker placements'}</summary>${recipeTable(build,final,result.goals,check.seen)}<p class="muted">General and Spec. show how many breakers to use. Rating gain shows their total boost and each step in order${check.seen?', including your observed gains':''}. One breaker can add multiple rating points; later gains can shrink as the rating rises or reaches its body cap.</p></details>
  ${thresholdBadges(build,final)}
  <details><summary>Badge qualifications (${badgeList.length})</summary><div class="badge-list">${badgeList.map(b=>`<span>${esc(b.label)} · ${title(TIERS[b.tier])}</span>`).join('')}</div><p>These are rating and height qualifications. Equipping badges also needs tokens and discipline slots; the slot allocation formula is unresolved.</p></details>
  ${takeoverPanel(build,final)}
  <details><summary>Why this build ranks here</summary><ul class="score-list">${ranking.map(x=>`<li>Priority ${x.p}: ${esc(data.attrs[x.i].label)} reaches ${final[x.i]}${result.goals.ideal[x.i]?` toward an ideal of ${result.goals.ideal[x.i]}`:''}.</li>`).join('')}<li>Higher priorities carry more weight. Reaching related badge tiers earns a score bonus.</li><li>Ideal ratings stop adding score after they are reached. All required ratings and badges are checked first.</li><li>Search score: ${build.score?.toFixed(1)??'not feasible'}. This is the best found within a bounded search.</li></ul></details>
  ${near?'':`<div class="card-actions"><button type="button" class="button ghost" data-verify="${esc(build.id)}">Verify in 2K</button><button type="button" class="text-button" data-export="${esc(build.id)}">Export recipe</button></div>`}</div></article>`;
}
function renderResults(){
  const {primary,alternatives,nearMisses,goals}=result;
  let html=`<p class="results-subtitle">${result.surveyed.toLocaleString()} legal body combinations surveyed · ${result.deepSearched} distinct profiles searched in depth. Results use projected cap breaker gains.</p>`;
  if(goals.wingspan!==null)html+=`<p class="alternatives-note">Wingspan fixed at ${heightLabel(goals.wingspan)} (${goals.wingspan} in) for these results.</p>`;
  if(result.limitations.length)html+=`<div class="warning">${[...new Set(result.limitations)].map(esc).join('<br>')}</div>`;
  if(primary.length){html+=`<h3 class="section-title">Your height · ${heightLabel(goals.height)}</h3>`+primary.map((b,i)=>buildCard(b,i)).join('');}
  else{html+=`<div class="impossible"><h3>No valid build found at ${heightLabel(goals.height)}</h3>${result.explanations.filter(e=>e.height===goals.height).map(e=>`<p>${esc(e.message)}</p>`).join('')}<p>Hard goals have not been relaxed. Change a required rating, badge tier, or breaker budget and search again.</p></div>`;}
  if(alternatives.length){html+=`<h3 class="section-title">Nearby height alternatives</h3><p class="alternatives-note">Separate suggestions at ±1 inch. These still meet your hard goals under the model.</p>`+alternatives.map((b,i)=>buildCard(b,i+1)).join('');}
  if(nearMisses.length)html+=`<h3 class="section-title">Near misses and suggested changes</h3>`+nearMisses.map((b,i)=>buildCard(b,i,true)).join('');
  const nearbyFailures=result.explanations.filter(e=>e.height!==goals.height);if(nearbyFailures.length)html+=`<details ${goals.wingspan!==null?'open':''}><summary>Nearby height notes</summary>${nearbyFailures.map(e=>`<p class="muted">${heightLabel(e.height)}: ${esc(e.message)}</p>`).join('')}</details>`;
  $('results').innerHTML=html;
}
function stopSearch(){worker?.terminate();worker=null;$('search').disabled=false;$('cancel').hidden=true;$('progress').hidden=true;}
async function runSearch(event){
  event.preventDefault();$('form-error').hidden=true;
  let goals;try{goals=normalizeGoals(rawGoals());}catch(error){$('form-error').textContent=error.message;$('form-error').hidden=false;return;}
  persist();stopSearch();$('search').disabled=true;$('cancel').hidden=false;$('progress').hidden=false;$('progress-bar').style.width='0%';$('progress-message').textContent='Surveying legal bodies…';$('search-status').textContent='Searching';
  worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onmessage=event=>{
    const m=event.data;if(m.kind==='progress'){$('progress-bar').style.width=m.percent+'%';$('progress-message').textContent=m.message;}
    else if(m.kind==='result'){result=m.result;stopSearch();$('search-status').textContent='Search complete';renderResults();if(innerWidth<820)$('results').scrollIntoView({behavior:'smooth',block:'start'});}
    else{stopSearch();$('search-status').textContent='';$('form-error').textContent=m.message;$('form-error').hidden=false;}
  };
  worker.onerror=()=>{stopSearch();$('form-error').textContent='The search could not run. Reload the page and try again.';$('form-error').hidden=false;};worker.postMessage(goals);
}
function openVerify(id){
  activeBuild=buildEntry(id)?.build;if(!activeBuild)return;
  const b=activeBuild,saved=observations[id]??{};$('verify-context').textContent=`${heightLabel(b.body.height)} ${b.body.position} · ${b.body.weight} lb · ${heightLabel(b.body.wingspan)} wingspan · ${title(b.spec)}`;
  $('verify-rows').innerHTML=data.attrs.filter(a=>b.counts[a.index]).map(a=>{const i=a.index;return `<div class="verify-row"><strong>${esc(a.label)}<br><span class="muted">Builder: ${b.base[i]}</span></strong><div class="verify-steps">${Array.from({length:b.counts[i]},(_,step)=>`<label>Step ${step+1}<span class="projected-gain">Projected +${b.sequences[i][step]}</span><input type="number" data-observe="${i}" data-step="${step}" min="0" max="74" value="${saved[i]?.[step]??''}" placeholder="+${b.sequences[i][step]}" aria-label="${esc(a.label)} step ${step+1} observed gain"></label>`).join('')}</div></div>`;}).join('')||'<p>This build uses no breakers. Check the builder ratings and body caps in game.</p>';
  $('verify-error').hidden=true;$('verify-dialog').showModal();
}
function exportRecipe(id){
  const entry=buildEntry(id);if(!entry)return;
  const {build,goals,adjustment,near}=entry,check=checkObserved(build,goals);
  const payload={dataset:data.meta,goals,originalGoals:adjustment?result.goals:undefined,changes:adjustment?.changes,requiredBadgeChanges:adjustment?.requiredBadges,takeoverChanges:near?takeoverChanges(data,near.final,check.final):undefined,build,observed:observations[id]??{},check,badgeThresholds:badgeInsights(data,build.body.height,check.final,build.caps),takeovers:takeoverInsights(data,check.final,build.caps)};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),link=document.createElement('a');
  link.href=URL.createObjectURL(blob);link.download=`2k27-${build.body.height}-${build.body.weight}-recipe.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
try{
  [data,validation]=await Promise.all([fetch('./data/rules.json').then(r=>{if(!r.ok)throw new Error('The game rules could not load.');return r.json();}),fetch('./data/validation.json').then(r=>r.json())]);
  $('height').innerHTML=Array.from({length:20},(_,i)=>`<option value="${69+i}">${heightLabel(69+i)}</option>`).join('');
  $('specialization').innerHTML+=DISCIPLINES.map(d=>`<option value="${d}">${title(d)} (+2)</option>`).join('');
  $('stat-inputs').innerHTML=DISCIPLINES.map(d=>`<tr class="group-heading"><th colspan="4" scope="colgroup">${title(d)}</th></tr>`+data.attrs.filter(a=>a.discipline===d).map(a=>`<tr><td><label for="required-${a.index}">${esc(a.label)}</label></td>${['required','ideal','priority'].map(k=>`<td><input id="${k}-${a.index}" type="number" min="${k==='priority'?1:25}" max="${k==='priority'?21:99}" aria-label="${esc(a.label)} ${k}" placeholder="—"></td>`).join('')}</tr>`).join('')).join('');
  $('badge-select').innerHTML=[...data.badges].sort((a,b)=>a.label.localeCompare(b.label)).map(b=>`<option value="${b.badge}">${esc(b.label)}</option>`).join('');
  observations=loadStorage(OBS)??{};let initial=loadStorage(STORAGE)??{height:77,general:5};
  if(location.hash.startsWith('#goals=')){try{initial=JSON.parse(atob(decodeURIComponent(location.hash.slice(7))));normalizeGoals(initial);}catch{toast('This goal link is invalid. Using your saved goals.');}}
  applyGoals(initial);
  $('data-version').textContent=`Dataset captured ${data.meta.captured} · API ${data.meta.api_version} · tuning ${data.meta.live_tuning_version}`;
  $('data-notes').innerHTML=`<p>All recommendations need a check in the live 2K builder. This dataset describes one tuning version.</p><ul><li>Body cap sample: ${validation.bodyCaps.matched}/${validation.bodyCaps.total} matched.</li><li>OVR: ${validation.ovr.matched}/${validation.ovr.total} samples matched within 0.0001.</li><li>Recovered cap breaker formula: ${validation.breakerMeasurements.matched.toLocaleString()}/${validation.breakerMeasurements.total.toLocaleString()} original steps matched; ${validation.hqSequences.matched}/${validation.hqSequences.total} full sequences in one HQ build.</li><li>Three other HQ builds: ${validation.additionalHQ.matchedSteps}/${validation.additionalHQ.totalSteps} steps matched. The maximum-weight lookup remains incomplete.</li><li>Builder OVR is a model; live completion and affordability boundaries can differ. Results use a modeled 99 budget.</li><li>Zero-delta Speed With Ball → Speed constraints are unresolved and excluded. Badge discipline slot allocation is unresolved.</li></ul><p>Sources: <a href="https://github.com/lightmatmul/nba2k27-builder-dataset" target="_blank" rel="noreferrer">original dataset</a>, <a href="https://github.com/souledxxout/NBA2K27-MyPlayer-Build-Lab" target="_blank" rel="noreferrer">formula research</a>, <a href="https://github.com/jackturner7/nba-2k27-build-optimizer" target="_blank" rel="noreferrer">HQ build tables</a>.</p>`;
  $('loading').hidden=true;$('app').hidden=false;
  $('goals-form').addEventListener('submit',runSearch);$('goals-form').addEventListener('input',persist);$('goals-form').addEventListener('change',persist);
  $('height').addEventListener('change',()=>{updateBadgeAvailability();updateWingspanOptions();});
  $('wingspan').addEventListener('change',()=>updateWingspanOptions());
  $('add-badge').onclick=()=>{const s={badge:+$('badge-select').value,tier:+$('badge-tier').value};selectedBadges=selectedBadges.filter(b=>b.badge!==s.badge);selectedBadges.push(s);renderBadgeGoals();persist();};
  $('required-badges').onclick=event=>{const id=event.target.dataset.removeBadge;if(id){selectedBadges=selectedBadges.filter(b=>b.badge!==+id);renderBadgeGoals();persist();}};
  $('reset').onclick=()=>{stopSearch();applyGoals({height:77,general:5});$('form-error').hidden=true;toast('Goals reset.');};
  $('example').onclick=()=>{const required=Array(21).fill(null),priority=Array(21).fill(null),ideal=Array(21).fill(null);required[6]=90;required[9]=85;required[8]=75;required[17]=80;priority[12]=1;priority[17]=2;priority[13]=3;priority[18]=4;ideal[12]=92;ideal[17]=90;ideal[13]=85;ideal[18]=90;applyGoals({height:77,general:5,required,priority,ideal});toast('Example goals loaded. Press Find my builds.');};
  $('cancel').onclick=()=>{stopSearch();$('search-status').textContent='Canceled';};
  $('share').onclick=async()=>{try{const link=new URL(location.href);link.hash='goals='+encodeURIComponent(btoa(JSON.stringify(rawGoals())));await navigator.clipboard.writeText(link.href);toast('Goal link copied.');}catch{toast('Clipboard unavailable. Export a result recipe after searching.');}};
  $('results').onclick=event=>{const button=event.target.closest('button');if(button?.dataset.verify)openVerify(button.dataset.verify);if(button?.dataset.export)exportRecipe(button.dataset.export);if(button?.dataset.adjustNear){const near=result.nearMisses.find(b=>b.id===button.dataset.adjustNear),adjustment=near?.adjustments[+button.dataset.adjustIndex];if(adjustment){stopSearch();applyGoals(adjustment.goals);$('form-error').hidden=true;$('search-status').textContent='Revised goals loaded — search again';$('goals-form').scrollIntoView({behavior:'smooth',block:'start'});toast('Revised goals loaded. Press Find my builds to search again.');}}};
  $('close-verify').onclick=()=>$('verify-dialog').close();
  $('clear-verification').onclick=()=>{delete observations[activeBuild.id];saveStorage(OBS,observations);$('verify-dialog').close();renderResults();};
  $('verify-form').onsubmit=event=>{event.preventDefault();const saved={};let bad=false;for(const input of document.querySelectorAll('[data-observe]')){const i=+input.dataset.observe,step=+input.dataset.step;if(input.value==='')continue;const value=+input.value;if(!Number.isInteger(value)||value<0||value>74){bad=true;break;}(saved[i]??=[])[step]=value;}
    for(const [i,steps]of Object.entries(saved)){let final=activeBuild.base[+i];for(let step=0;step<activeBuild.counts[+i];step++)final+=steps[step]??activeBuild.sequences[+i][step];if(final>99)bad=true;}
    if(bad){$('verify-error').textContent='Enter whole-number gains from 0 to 74. The resulting rating cannot exceed 99.';$('verify-error').hidden=false;return;}observations[activeBuild.id]=saved;saveStorage(OBS,observations);$('verify-dialog').close();renderResults();toast('Observed gains saved for this exact recipe.');};
}catch(error){$('loading').textContent=error.message;}
