import {applyBreakers,splitPools,associated,overall} from './rules.js';

export function specializationBranches(data,spec){
  const branches=data.specializations?.[spec];
  if(!branches?.length)throw new Error(`Missing unlock requirements for ${spec} specialization.`);
  return branches;
}
export function specializationQualified(data,spec,ratings){
  return specializationBranches(data,spec).some(branch=>branch.every(([i,min])=>ratings[i]>=min));
}
export function specializationEligibility(data,spec,ratings){
  const branches=specializationBranches(data,spec).map(branch=>branch.map(([i,min])=>({attribute:i,label:data.attrs[i].label,minimum:min,actual:ratings[i],met:ratings[i]>=min})));
  const qualified=branches.some(branch=>branch.every(r=>r.met));
  return {specialization:spec,qualified,ratingsBeforeSpecialization:ratings,branches,evaluation:data.specializationMeta.evaluation};
}
export function specializationMissing(eligibility){
  if(eligibility.qualified)return [];
  const paths=eligibility.branches.map(branch=>branch.filter(r=>!r.met).map(r=>`${r.label} ${r.actual}, needs ${r.minimum}`).join(' AND ')).join(' OR ');
  return [{kind:'specialization',label:`${eligibility.specialization} specialization`,message:`Unlock before using specialization breakers: ${paths}.`}];
}
// General steps precede specialization steps on each attribute. Try alternative
// assignments of the two restricted applications before raising builder ratings.
export function specializationPools(data,body,base,caps,counts,spec,generalBudget,type){
  const original=splitPools(data,counts,spec,generalBudget);
  const check=pool=>{
    const before=applyBreakers(data,body.height,base,caps,pool.general,type);
    return {...pool,eligible:specializationQualified(data,spec,before),beforeSpecialization:before};
  };
  const first=check(original);
  if(first.eligible||!first.valid)return {...first,valid:first.valid&&first.eligible};
  const eligible=counts.flatMap((n,i)=>n&&(data.attrs[i].discipline===spec||i===7)?[i]:[]);
  const allocations=[Array(21).fill(0)];
  for(const i of eligible){const one=Array(21).fill(0);one[i]=1;allocations.push(one);
    for(const j of eligible.filter(j=>j>=i)){if(i===j&&counts[i]<2)continue;const two=one.slice();two[j]++;allocations.push(two);}
  }
  allocations.sort((a,b)=>b.reduce((s,n)=>s+n,0)-a.reduce((s,n)=>s+n,0));
  for(const restricted of allocations){
    const general=counts.map((n,i)=>n-restricted[i]),generalUsed=general.reduce((s,n)=>s+n,0);
    if(generalUsed>generalBudget)continue;
    const candidate=check({general,spec:restricted,generalUsed,specUsed:restricted.reduce((s,n)=>s+n,0),valid:true});
    if(candidate.eligible)return candidate;
  }
  return {...first,valid:false};
}
// Restore unlock ratings while preserving linked builder attributes. Considering
// every alternative matters for finishing, playmaking, defense, and rebounding.
export function unlockSpecialization(data,body,base,caps,counts,spec,generalBudget,type){
  if(specializationQualified(data,spec,base))return base;
  if(specializationPools(data,body,base,caps,counts,spec,generalBudget,type).eligible)return base;
  let best=null,price=Infinity;
  for(const branch of specializationBranches(data,spec)){
    if(branch.some(([i,min])=>caps[i]<min))continue;
    let candidate=base;
    for(let pass=0;pass<8;pass++){
      const pool=specializationPools(data,body,candidate,caps,counts,spec,generalBudget,type);
      if(pool.eligible)break;
      const raised=candidate.slice();
      for(const [i,min] of branch)if(pool.beforeSpecialization[i]<min)raised[i]=Math.min(min,raised[i]+min-pool.beforeSpecialization[i]);
      candidate=associated(data,body.height,raised);
    }
    if(candidate.some((r,i)=>r>caps[i])||!specializationPools(data,body,candidate,caps,counts,spec,generalBudget,type).eligible)continue;
    const cost=overall(data,body.height,candidate).uncapped;
    if(cost<price){best=candidate;price=cost;}
  }
  return best??base;
}
