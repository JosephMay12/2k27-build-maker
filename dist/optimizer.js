import {DISCIPLINES,FLOOR,associated,overall,bodyCaps,legalWingspans,breakerSequence,applyBreakers,badgeTier,badgeBranches} from './rules.js';
import {badgeChanges} from './badge-insights.js';
import {specializationBranches,specializationPools,specializationEligibility,specializationMissing,unlockSpecialization} from './specialization.js';
const sum=a=>a.reduce((x,y)=>x+y,0);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function normalizeGoals(input){
  const goals={height:Math.round(Number(input.height)),wingspan:input.wingspan==null||input.wingspan===''||input.wingspan==='auto'?null:Number(input.wingspan),general:Math.round(Number(input.general)),specialization:input.specialization||'auto',required:Array(21).fill(25),ideal:Array(21).fill(null),priority:Array(21).fill(0),badges:input.badges??[],nearby:input.nearby!==false};
  if(!Number.isInteger(goals.height)||goals.height<69||goals.height>88)throw new Error('Choose a height from 5′9″ to 7′4″.');
  if(goals.wingspan!==null&&(!Number.isInteger(goals.wingspan)||goals.wingspan<=0))throw new Error('Choose Auto or a wingspan in whole inches.');
  if(!Number.isInteger(goals.general)||goals.general<0||goals.general>103)throw new Error('Enter 0–103 general cap breakers. Specialization adds two.');
  if(goals.specialization!=='auto'&&!DISCIPLINES.includes(goals.specialization))throw new Error('Choose a valid specialization.');
  for(let i=0;i<21;i++){
    for(const field of ['required','ideal']){
      const v=input[field]?.[i];if(v==null||v==='')continue;
      if(!Number.isInteger(Number(v))||Number(v)<25||Number(v)>99)throw new Error('Attribute ratings must be whole numbers from 25 to 99.');
      goals[field][i]=Number(v);
    }
    const p=Number(input.priority?.[i]||0);if(!Number.isInteger(p)||p<0||p>21)throw new Error('Secondary priorities must be whole numbers from 1 to 21, or blank.');goals.priority[i]=p;
    if(goals.ideal[i]!=null&&goals.ideal[i]<goals.required[i])throw new Error('An ideal rating cannot be lower than its required minimum.');
  }
  const ranks=goals.priority.filter(Boolean);if(new Set(ranks).size!==ranks.length)throw new Error('Give each secondary stat a different priority number.');
  return goals;
}
function targetVariants(data,goals,height){
  let variants=[goals.required.slice()];
  for(const selection of goals.badges){
    const badge=data.badges.find(b=>b.badge===Number(selection.badge));const tier=Number(selection.tier);
    if(!badge||!Number.isInteger(tier)||tier<0||tier>3)throw new Error('Choose a valid badge and tier.');
    if(height<badge.height_inches[0]||height>badge.height_inches[1]||!badge.allowed)return {variants:[],reason:`${badge.label} is unavailable at this height. It requires ${Math.floor(badge.height_inches[0]/12)}′${badge.height_inches[0]%12}″–${Math.floor(badge.height_inches[1]/12)}′${badge.height_inches[1]%12}″. Choose an eligible height or remove this required badge.`};
    const branches=badgeBranches(badge.tiers[tier]),next=[];
    for(const vector of variants)for(const branch of branches){const v=vector.slice();for(const [i,min]of branch)v[i]=Math.max(v[i],min);if(v.every(n=>n<=99))next.push(v);}
    variants=[...new Map(next.map(v=>[v.join(','),v])).values()].slice(0,32);
    if(!variants.length)return {variants:[],reason:`${badge.label} has no achievable requirement branch at this tier.`};
  }
  return {variants};
}
function statWeights(goals){return goals.priority.map((rank,i)=>rank?1/Math.pow(rank,.65):goals.ideal[i]!=null?.22:.025);}
function utility(data,goals,height,ratings,weights){
  let score=0;
  for(let i=0;i<21;i++){const target=goals.ideal[i]??99;const r=Math.min(ratings[i],target);score+=weights[i]*74*Math.sqrt(Math.max(0,r-25)/74);}
  // Threshold bonuses follow ranked attributes and evaluate the complete predicate.
  for(const b of data.badges){let relevance=0;for(const t of b.tiers)for(const r of t.requirements)relevance=Math.max(relevance,goals.priority[r.attribute]?weights[r.attribute]:0);
    if(relevance){const tier=badgeTier(b,height,ratings);if(tier>=0)score+=relevance*(tier+1)*2.25;}}
  return score;
}
export function misses(data,goals,height,final){
  const out=[];
  goals.required.forEach((r,i)=>{if(final[i]<r)out.push({kind:'stat',attribute:i,label:data.attrs[i].label,need:r,actual:final[i]});});
  for(const s of goals.badges){const b=data.badges.find(b=>b.badge===+s.badge),tier=badgeTier(b,height,final);if(tier<+s.tier)out.push({kind:'badge',badge:b.badge,label:b.label,need:+s.tier,actual:tier});}
  return out;
}
function inverse(data,height,caps,target,type){
  const options=Array.from({length:21},()=>[]);
  for(let i=0;i<21;i++)for(let count=0;count<=5;count++){
    if(target[i]>caps[i]){options[i][count]=target[i];continue;}
    let lo=25,hi=target[i];
    while(lo<hi){const mid=Math.floor((lo+hi)/2),v=FLOOR();v[i]=mid;const final=mid+sum(breakerSequence(data,height,v,caps,i,type).slice(0,count));if(final>=target[i])hi=mid;else lo=mid+1;}
    options[i][count]=lo;
  }
  return options;
}
function requiredPlan(data,goals,body,caps,target,type,spec){
  const counts=Array(21).fill(0),opts=inverse(data,body.height,caps,target,type);
  const make=c=>unlockSpecialization(data,body,associated(data,body.height,c.map((n,i)=>opts[i][n])),caps,c,spec,goals.general,type);
  let base=make(counts),price=overall(data,body.height,base).uncapped;
  for(const pool of ['spec','general']){
    const budget=pool==='spec'?2:goals.general;
    for(let step=0;step<budget;step++){
      let best=null;
      for(let i=0;i<21;i++){
        if(counts[i]>=5||(pool==='spec'&&data.attrs[i].discipline!==spec&&i!==7))continue;
        const c=counts.slice();c[i]++;const b=make(c);if(b.some((r,j)=>r>caps[j]))continue;
        if(!specializationPools(data,body,b,caps,c,spec,goals.general,type).valid)continue;
        const p=overall(data,body.height,b).uncapped,saving=price-p;
        if(saving>1e-7&&(!best||saving>best.saving))best={counts:c,base:b,price:p,saving};
      }
      if(!best)break;counts.splice(0,21,...best.counts);base=best.base;price=best.price;
    }
  }
  const pool=specializationPools(data,body,base,caps,counts,spec,goals.general,type);
  return {body,caps,base,counts,spec,price,pool,target,type};
}
function finalize(data,goals,plan){
  const ovr=overall(data,plan.body.height,plan.base);const final=applyBreakers(data,plan.body.height,plan.base,plan.caps,plan.counts,ovr.type);
  const pool=specializationPools(data,plan.body,plan.base,plan.caps,plan.counts,plan.spec,goals.general,ovr.type);
  const eligibility=specializationEligibility(data,plan.spec,pool.beforeSpecialization);
  const missing=[...misses(data,goals,plan.body.height,final),...specializationMissing(eligibility)];
  const sequences=plan.base.map((_,i)=>breakerSequence(data,plan.body.height,plan.base,plan.caps,i,ovr.type));
  return {...plan,ovr,final,missing,pool,sequences,eligibility,valid:missing.length===0&&ovr.uncapped<=99.000001&&pool.valid&&plan.base.every((r,i)=>r<=plan.caps[i])};
}
function repair(data,goals,plan){
  let p=finalize(data,goals,plan);
  // Restore hard goals after the actual winning archetype differs from the seed.
  for(let pass=0;pass<8;pass++){
    let changed=false;const base=p.base.slice();
    p.target.forEach((target,i)=>{if(p.final[i]<target){base[i]+=target-p.final[i];changed=true;}});
    const unlocked=unlockSpecialization(data,p.body,associated(data,p.body.height,base),p.caps,p.counts,p.spec,goals.general);
    if(!changed&&unlocked.every((r,i)=>r===p.base[i]))break;
    p=finalize(data,goals,{...p,base:unlocked});
  }
  return p;
}
function fill(data,goals,seed,weights){
  let p=repair(data,goals,seed);if(!p.valid)return p;
  let score=utility(data,goals,p.body.height,p.final,weights);
  for(let iteration=0;iteration<1500;iteration++){
    let best=null;
    for(let i=0;i<21;i++){
      if(p.base[i]>=p.caps[i])continue;
      const b=p.base.slice();b[i]++;const base=associated(data,p.body.height,b);if(base.some((r,j)=>r>p.caps[j]))continue;
      const ovr=overall(data,p.body.height,base);if(ovr.uncapped>99.000001)continue;
      if(!specializationPools(data,p.body,base,p.caps,p.counts,p.spec,goals.general,ovr.type).valid)continue;
      const final=applyBreakers(data,p.body.height,base,p.caps,p.counts,ovr.type);if(misses(data,goals,p.body.height,final).length)continue;
      const nextScore=utility(data,goals,p.body.height,final,weights),delta=nextScore-score;
      if(delta<=0)continue;
      const efficiency=delta/Math.max(.015,ovr.uncapped-p.ovr.uncapped);
      if(!best||efficiency>best.efficiency)best={base,ovr,final,score:nextScore,efficiency};
    }
    if(!best)break;p={...p,base:best.base,ovr:best.ovr,final:best.final};score=best.score;
  }
  // Spend any breakers left after meeting the hard goals on useful secondary gains.
  for(let step=0;step<goals.general+2;step++){
    let best=null;
    for(let i=0;i<21;i++){
      if(p.counts[i]>=5)continue;const counts=p.counts.slice();counts[i]++;
      if(!specializationPools(data,p.body,p.base,p.caps,counts,p.spec,goals.general,p.ovr.type).valid)continue;
      const final=applyBreakers(data,p.body.height,p.base,p.caps,counts,p.ovr.type),gain=utility(data,goals,p.body.height,final,weights)-score;
      if(gain>1e-7&&(!best||gain>best.gain))best={counts,final,gain};
    }
    if(!best)break;p={...p,counts:best.counts,final:best.final};score+=best.gain;
  }
  return {...finalize(data,goals,p),score};
}
// Lower linked source ratings too, so the builder will not force the cut back up.
export function lowerBuilder(data,height,ratings,index,value){
  const base=ratings.slice();base[index]=Math.max(25,Math.min(base[index],value));
  for(let pass=0;pass<22;pass++){
    let changed=false;
    for(const [source,target,delta]of data.heights[height].constraints){
      const max=base[target]+delta;if(base[source]>max){base[source]=max;changed=true;}
    }
    if(!changed)break;
  }
  return base;
}
function recipeId(p){return `${p.body.position}-${p.body.height}-${p.body.weight}-${p.body.wingspan}-${p.spec}-${p.base.join('.')}-${p.counts.join('.')}`;}
function revisedGoals(data,goals,p){
  return {...goals,height:p.body.height,required:goals.required.map((r,i)=>Math.min(r,p.final[i])),badges:goals.badges.flatMap(s=>{
    const badge=data.badges.find(b=>b.badge===+s.badge),tier=badgeTier(badge,p.body.height,p.final);
    return tier<0?[]:[{badge:+s.badge,tier:Math.min(+s.tier,tier)}];
  })};
}
export function suggestAdjustments(data,input,seed){
  const goals=normalizeGoals(input),height=seed.body.height,weights=statWeights(goals),options=[];
  const desired=seed.final.map((r,i)=>Math.max(r,goals.required[i]));
  // Body ceilings are mandatory. Propagating cuts keeps linked attributes legal.
  let clipped=seed.base.slice();
  for(let i=0;i<21;i++)if(clipped[i]>seed.caps[i])clipped=lowerBuilder(data,height,clipped,i,seed.caps[i]);
  clipped=unlockSpecialization(data,seed.body,clipped,seed.caps,seed.counts,seed.spec,goals.general);
  const baseline=finalize(data,goals,{...seed,base:clipped});
  if(!baseline.pool.valid)return [];
  const modes=[{label:'Protect required badges',badgePenalty:5000},{label:'Favor your ranked stats',badgePenalty:40},{label:'Alternative rating cuts',badgePenalty:5000,avoid:[]}];
  for(const mode of modes){
    if(mode.avoid&&options[0])mode.avoid=options[0].changes.filter(c=>c.requiredTo<c.requiredFrom).map(c=>c.attribute);
    const cost=p=>{
      let value=sum(desired.map((r,i)=>Math.max(0,r-p.final[i])*(goals.priority[i]?3*weights[i]:1)*(mode.avoid?.includes(i)?5:1)));
      for(const s of goals.badges){const badge=data.badges.find(b=>b.badge===+s.badge);value+=Math.max(0,+s.tier-badgeTier(badge,height,p.final))*mode.badgePenalty;}
      // A small preference for retaining the other badge qualifications too.
      for(const b of data.badges)value+=Math.max(0,badgeTier(b,height,seed.final)-badgeTier(b,height,p.final))*2;
      return value;
    };
    let p=baseline,loss=cost(p);
    for(let step=0;step<1600&&p.ovr.uncapped>99.000001;step++){
      let best=null;
      for(let i=0;i<21;i++){
        if(p.base[i]<=25)continue;
        const base=lowerBuilder(data,height,p.base,i,p.base[i]-1),candidate=finalize(data,goals,{...p,base});
        if(!candidate.pool.valid)continue;
        const saving=p.ovr.uncapped-candidate.ovr.uncapped;if(saving<=1e-9)continue;
        const nextLoss=cost(candidate),efficiency=(Math.max(0,nextLoss-loss)+.01)/saving;
        if(!best||efficiency<best.efficiency)best={p:candidate,loss:nextLoss,efficiency};
      }
      if(!best)break;p=best.p;loss=best.loss;
    }
    const minimums=revisedGoals(data,goals,p);
    p=finalize(data,minimums,{...p,target:minimums.required});
    if(p.valid)p=fill(data,minimums,p,weights);
    const revised=revisedGoals(data,goals,p);
    p=finalize(data,revised,{...p,target:revised.required,id:recipeId(p)});
    if(!p.valid||!associated(data,height,p.base).every((r,i)=>r===p.base[i]))continue;
    if(options.some(o=>o.build.base.every((r,i)=>r===p.base[i])&&o.build.counts.every((n,i)=>n===p.counts[i])))continue;
    const changes=data.attrs.flatMap((a,i)=>seed.base[i]<=p.base[i]&&desired[i]<=p.final[i]&&goals.required[i]===revised.required[i]?[]:[{
      attribute:i,label:a.label,builderFrom:seed.base[i],builderTo:p.base[i],finalFrom:desired[i],finalTo:p.final[i],requiredFrom:goals.required[i],requiredTo:revised.required[i]
    }]);
    const requiredBadges=goals.badges.flatMap(s=>{
      const next=revised.badges.find(b=>b.badge===+s.badge),to=next?.tier??-1;
      return to===+s.tier?[]:[{badge:+s.badge,label:data.badges.find(b=>b.badge===+s.badge).label,from:+s.tier,to}];
    });
    options.push({label:mode.label,goals:revised,build:p,changes,requiredBadges,badgeChanges:badgeChanges(data,height,seed.final,p.final)});
  }
  return options;
}
function distinct(plans,limit){
  const result=[];
  for(const p of plans){if(result.every(q=>Math.abs(p.body.weight-q.body.weight)>=8||Math.abs(p.body.wingspan-q.body.wingspan)>=2||sum(p.base.map((r,i)=>Math.abs(r-q.base[i])))>=35))result.push(p);if(result.length>=limit)break;}
  return result;
}
export async function optimize(data,input,progress=()=>{}){
  const goals=normalizeGoals(input),weights=statWeights(goals),allHeights=goals.nearby?[goals.height,goals.height-1,goals.height+1]:[goals.height];
  const result={goals,primary:[],alternatives:[],nearMisses:[],explanations:[],surveyed:0,deepSearched:0,limitations:[]};
  for(const height of allHeights.filter(h=>h>=69&&h<=88)){
    if(goals.wingspan!==null&&!legalWingspans(data,height).includes(goals.wingspan)){
      const spans=legalWingspans(data,height),range=spans.map(s=>`${s} in`).join(', ');
      const message=`The fixed ${goals.wingspan} in wingspan is not legal at this height. Choose Auto or a legal wingspan (${range}).`;
      if(height===goals.height)throw new Error(message);
      result.explanations.push({height,message});continue;
    }
    let {variants,reason}=targetVariants(data,goals,height);
    if(reason){
      result.explanations.push({height,message:reason});
      const possible=goals.badges.filter(s=>{const b=data.badges.find(b=>b.badge===+s.badge);return b.allowed&&height>=b.height_inches[0]&&height<=b.height_inches[1]&&badgeBranches(b.tiers[+s.tier]).some(branch=>branch.every(([,n])=>n<=99));});
      variants=targetVariants(data,{...goals,badges:possible},height).variants;
    }
    const specs=goals.specialization==='auto'?DISCIPLINES:[goals.specialization];
    const candidates=specs.flatMap(spec=>variants.flatMap(vector=>specializationBranches(data,spec).map(branch=>{
      const target=vector.slice();for(const [i,min] of branch)target[i]=Math.max(target[i],min);
      return {spec,target};
    })));
    const unique=new Map(),maxCaps=FLOOR();
    for(const pos of data.bodies)for(const frame of pos.bodies.filter(b=>b.height_inches===height&&(goals.wingspan===null||(goals.wingspan>=b.wingspan_inches[0]&&goals.wingspan<=b.wingspan_inches[1]))))for(let weight=frame.weight_lb[0];weight<=frame.weight_lb[1];weight++)for(let wingspan=goals.wingspan??frame.wingspan_inches[0];wingspan<=(goals.wingspan??frame.wingspan_inches[1]);wingspan++){
      result.surveyed++;const body={position:pos.position,height,weight,wingspan},caps=bodyCaps(data,body);caps.forEach((c,i)=>maxCaps[i]=Math.max(c,maxCaps[i]));
      const key=caps.join(',');if(unique.has(key))continue;
      const applicable=candidates.filter(v=>v.target.every((n,i)=>n<=caps[i]));
      const deficit=Math.min(...candidates.map(v=>sum(v.target.map((n,i)=>Math.max(0,n-caps[i])))));
      const scout=dot(caps.map((c,i)=>Math.min(c,goals.ideal[i]??99)-25),weights)-deficit*500;
      const positions=data.bodies.filter(p=>p.bodies.some(f=>f.height_inches===height&&weight>=f.weight_lb[0]&&weight<=f.weight_lb[1]&&wingspan>=f.wingspan_inches[0]&&wingspan<=f.wingspan_inches[1])).map(p=>p.position);
      unique.set(key,{body:{...body,positions},caps,variants:applicable,scout,deficit});
    }
    const bodies=[...unique.values()].sort((a,b)=>b.scout-a.scout);const feasible=bodies.filter(b=>b.variants.length);
    if(!feasible.length){
      const impossible=goals.required.map((r,i)=>r>maxCaps[i]?`${data.attrs[i].label}: requested ${r}, highest modeled cap ${maxCaps[i]}`:null).filter(Boolean);
      const unlockImpossible=specs.filter(spec=>!specializationBranches(data,spec).some(branch=>branch.every(([i,min])=>maxCaps[i]>=min)));
      result.explanations.push({height,message:impossible.length?impossible.join('; '):unlockImpossible.length?`No body can unlock the selected ${unlockImpossible.join(', ')} specialization at this height and wingspan. Change the specialization or body settings.`:'No body at this height supports the combined required badge, rating, and specialization unlock thresholds.'});
    }
    // Survey every body; investigate diverse promising profiles and budget plans.
    const shortlist=distinct((feasible.length?feasible:bodies).map(b=>({...b,base:FLOOR()})),36);
    const seeds=[];
    for(let n=0;n<shortlist.length;n++){
      const b=shortlist[n];result.deepSearched++;
      for(const spec of specs)for(const {target} of (b.variants.length?b.variants:candidates).filter(v=>v.spec===spec).slice(0,8)){
        const clipped=target.map((r,i)=>Math.min(r,b.caps[i]));
        for(let type=0;type<15;type++){
          const p=repair(data,goals,requiredPlan(data,goals,b.body,b.caps,clipped,type,spec));const headroom=99-p.ovr.uncapped;const potential=dot(b.caps.map((r,i)=>Math.min(r,goals.ideal[i]??99)-p.final[i]),weights);p.seedScore=headroom+potential*.08-p.missing.length*500;seeds.push(p);
        }
      }
      progress({height,percent:Math.round((n+1)/shortlist.length*75),message:`Comparing weight, wingspan, and breaker allocations at ${height} inches…`});
      if(n%4===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    const legal=seeds.filter(p=>p.valid).sort((a,b)=>b.seedScore-a.seedScore);
    const selected=distinct(legal,10),filled=[];
    for(let n=0;n<selected.length;n++){const p=fill(data,goals,selected[n],weights);if(p.valid)filled.push(p);progress({height,percent:75+Math.round((n+1)/selected.length*25),message:'Improving secondary stats and badge thresholds…'});await new Promise(resolve=>setTimeout(resolve,0));}
    filled.sort((a,b)=>b.score-a.score||a.pool.generalUsed-b.pool.generalUsed);
    const uniqueRecipes=[...new Map(filled.map(p=>[`${p.final.join(',')}-${p.counts.join(',')}-${p.spec}`,p])).values()];
    const top=distinct(uniqueRecipes,3).map(p=>({...p,id:recipeId(p),badges:data.badges.map(b=>({badge:b.badge,label:b.label,discipline:b.discipline,tier:badgeTier(b,height,p.final),baseTier:badgeTier(b,height,p.base)})).filter(b=>b.tier>=0)}));
    if(height===goals.height)result.primary=top;else result.alternatives.push(...top.slice(0,1));
    if(!top.length){
      const nearest=seeds.sort((a,b)=>sum(a.missing.map(m=>m.kind==='stat'?m.need-m.actual:10))-sum(b.missing.map(m=>m.kind==='stat'?m.need-m.actual:10))||Math.max(0,a.ovr.uncapped-99)-Math.max(0,b.ovr.uncapped-99));
      for(const p of distinct(nearest,height===goals.height?3:1)){
        progress({height,percent:95,message:'Finding rating cuts that make near misses legal…'});
        result.nearMisses.push({...p,id:`near-${recipeId(p)}`,adjustments:suggestAdjustments(data,goals,p),reason:p.ovr.uncapped>99?`Requires ${p.ovr.uncapped.toFixed(2)} modeled builder OVR; the budget is 99.`:'The available breakers and modeled body caps do not meet every hard goal.'});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(feasible.length)result.explanations.push({height,message:'No valid build was found in the bounded search. This can reflect the 99 OVR budget, breaker limits, or search coverage; it is not proof that every possible allocation is impossible.'});
    }
    if(height<73)result.limitations.push('Standing Dunk ceilings below 6′1″ are missing from this tuning export. These results use 25 and require an in-game check.');
  }
  return result;
}
