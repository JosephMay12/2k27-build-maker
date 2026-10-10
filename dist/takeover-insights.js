import {predicate} from './rules.js';
import {requirementIncrease,requirementDecrease} from './badge-insights.js';

export function takeoverQualified(takeover,ratings){
  if(takeover.kind==='default'||takeover.kind==='universal')return true;
  return takeover.requirements.length>0&&predicate(takeover.requirements,ratings);
}

export function takeoverInsights(data,ratings,caps,window=3){
  const qualified=[],defaults=[],universal=[],close=[],barely=[],locked=[];
  for(const t of data.takeovers){
    if(t.kind==='default'){defaults.push(t);continue;}
    if(t.kind==='universal'){universal.push(t);continue;}
    if(takeoverQualified(t,ratings)){
      qualified.push(t);
      const loss=requirementDecrease(data,t.requirements,ratings);
      if(loss&&loss.points<=window)barely.push({...t,points:loss.points,changes:loss.changes});
    }else{
      const increase=requirementIncrease(data,t.requirements,ratings,caps);
      if(!increase)continue;
      const missing={...t,...increase};locked.push(missing);
      if(increase.points>0&&increase.points<=window)close.push(missing);
    }
  }
  const sort=(a,b)=>(a.points??0)-(b.points??0)||a.label.localeCompare(b.label);
  return {source:data.takeoverMeta,window,qualified:qualified.sort(sort),defaults,universal,close:close.sort(sort),barely:barely.sort(sort),locked:locked.sort(sort)};
}

export function takeoverChanges(data,before,after){
  return data.takeovers.filter(t=>t.kind==='specialist').flatMap(t=>{
    const from=takeoverQualified(t,before),to=takeoverQualified(t,after);
    return from===to?[]:[{id:t.id,label:t.label,discipline:t.discipline,from,to}];
  });
}
