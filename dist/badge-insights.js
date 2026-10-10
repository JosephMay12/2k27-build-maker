import {badgeTier,badgeBranches,predicate} from './rules.js';

const sum=values=>values.reduce((a,b)=>a+b,0);
const changes=(data,before,after)=>data.attrs.flatMap((a,i)=>before[i]===after[i]?[]:[{attribute:i,label:a.label,from:before[i],to:after[i],delta:after[i]-before[i]}]);

// Choose a complete AND branch. OR alternatives remain separate choices.
export function requirementIncrease(data,requirements,ratings,caps){
  const options=badgeBranches({requirements}).map(branch=>{
    const next=ratings.slice();for(const [i,min]of branch)next[i]=Math.max(next[i],min);
    const edits=changes(data,ratings,next),points=sum(edits.map(c=>c.delta));
    return {points,changes:edits,blocked:edits.some(c=>c.to>caps[c.attribute])};
  });
  options.sort((a,b)=>Number(a.blocked)-Number(b.blocked)||a.points-b.points);
  return options[0]??null;
}
// To lose an OR qualification, every currently satisfied branch must fail.
export function requirementDecrease(data,requirements,ratings,isLost=v=>!predicate(requirements,v)){
  if(!requirements.length||!predicate(requirements,ratings))return null;
  const branches=badgeBranches({requirements}).filter(branch=>branch.every(([i,min])=>ratings[i]>=min));
  let candidates=[ratings.slice()];
  for(const branch of branches){
    const next=[];
    for(const vector of candidates){
      if(branch.some(([i,min])=>vector[i]<min)){next.push(vector);continue;}
      for(const [i,min]of branch){if(min<=25)continue;const v=vector.slice();v[i]=Math.min(v[i],min-1);next.push(v);}
    }
    candidates=[...new Map(next.map(v=>[v.join(','),v])).values()];
  }
  candidates=candidates.filter(isLost);
  candidates.sort((a,b)=>sum(ratings.map((r,i)=>r-a[i]))-sum(ratings.map((r,i)=>r-b[i])));
  const next=candidates[0];if(!next)return null;
  const edits=changes(data,ratings,next);
  return {points:sum(edits.map(c=>-c.delta)),changes:edits,next};
}

export function badgeUpgrade(data,badge,height,ratings,caps){
  if(!badge.allowed||height<badge.height_inches[0]||height>badge.height_inches[1])return null;
  const current=badgeTier(badge,height,ratings),tier=current+1;
  if(tier>=badge.tiers.length)return null;
  const upgrade=requirementIncrease(data,badge.tiers[tier].requirements,ratings,caps);
  return upgrade?{badge:badge.badge,label:badge.label,current,tier,...upgrade}:null;
}

export function badgeDowngrade(data,badge,height,ratings){
  const tier=badgeTier(badge,height,ratings);if(tier<0)return null;
  const drop=requirementDecrease(data,badge.tiers[tier].requirements,ratings,v=>!predicate(badge.tiers[tier].requirements,v)&&badgeTier(badge,height,v)<tier);
  if(!drop)return null;
  return {badge:badge.badge,label:badge.label,tier,afterTier:badgeTier(badge,height,drop.next),points:drop.points,changes:drop.changes};
}

export function badgeInsights(data,height,ratings,caps,window=3){
  const close=[],barely=[];
  for(const badge of data.badges){
    const upgrade=badgeUpgrade(data,badge,height,ratings,caps),downgrade=badgeDowngrade(data,badge,height,ratings);
    if(upgrade&&upgrade.points>0&&upgrade.points<=window)close.push(upgrade);
    if(downgrade&&downgrade.points<=window)barely.push(downgrade);
  }
  const sort=(a,b)=>a.points-b.points||a.label.localeCompare(b.label);
  return {window,close:close.sort(sort),barely:barely.sort(sort)};
}

export function badgeChanges(data,height,before,after){
  return data.badges.flatMap(badge=>{
    const from=badgeTier(badge,height,before),to=badgeTier(badge,height,after);
    return from===to?[]:[{badge:badge.badge,label:badge.label,from,to}];
  });
}
