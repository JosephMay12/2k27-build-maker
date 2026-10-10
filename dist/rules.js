export const DISCIPLINES=['finishing','shooting','playmaking','defense','rebounding','physicals'];
export const TIERS=['bronze','silver','gold','hall_of_fame'];
export const FLOOR=()=>Array(21).fill(25);
export const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
export function legalWingspans(data,height){
  const spans=new Set();
  for(const position of data.bodies)for(const frame of position.bodies)if(frame.height_inches===height){
    for(let span=frame.wingspan_inches[0];span<=frame.wingspan_inches[1];span++)spans.add(span);
  }
  return [...spans].sort((a,b)=>a-b);
}
export function roundEven(n){const floor=Math.floor(n),diff=n-floor;return diff===.5?floor+(floor%2):Math.round(n);}
export function bodyCaps(data,body){
  const h=data.heights[body.height];
  const interpolate=(rows,x,i)=>{
    let a=rows[0],b=rows.at(-1);
    for(let j=1;j<rows.length;j++)if(rows[j].at>=x){a=rows[j-1];b=rows[j];break;}
    const t=b.at===a.at?0:clamp((x-a.at)/(b.at-a.at),0,1);
    return (a.values[i]??1)+t*((b.values[i]??1)-(a.values[i]??1));
  };
  return data.attrs.map((_,i)=>h.height[i]==null?25:clamp(roundEven(25+74*h.height[i]*interpolate(h.weight,body.weight,i)*interpolate(h.wingspan,body.wingspan,i)),25,99));
}
export function associated(data,height,ratings){
  const result=ratings.slice();
  for(let round=0;round<22;round++){
    let changed=false;
    for(const [source,target,delta]of data.heights[height].constraints){const min=Math.max(25,result[source]-delta);if(min>result[target]){result[target]=min;changed=true;}}
    if(!changed)break;
  }
  return result;
}
export function overall(data,height,ratings){
  const h=data.heights[height];let best=-Infinity,type=0;
  for(let t=0;t<h.weights.length;t++){
    let num=0,den=0; const w=h.weights[t];
    for(let i=0;i<21;i++){const weighted=w[i]*data.scales[i][ratings[i]];num+=weighted*ratings[i];den+=weighted;}
    if(!den)continue;
    const raw=num/den, ovr=h.lerp[1][0]+(raw-h.lerp[0][0])/(h.lerp[0][1]-h.lerp[0][0])*(h.lerp[1][1]-h.lerp[1][0]);
    if(ovr>best){best=ovr;type=t;}
  }
  return {uncapped:best,value:clamp(best,25,99),type};
}
export function breakerSequence(data,height,ratings,caps,index,type=overall(data,height,ratings).type){
  const w=data.heights[height].weights[type],max=Math.max(...w);let current=ratings[index];const gains=[];
  for(let step=0;step<5;step++){
    const factor=15+Math.trunc((350-14*current)/74);
    const gain=current>=caps[index]?0:Math.min(caps[index]-current,Math.max(1,roundEven((max-w[index])/max*factor)));
    gains.push(gain);current+=gain;
  }
  return gains;
}
export function applyBreakers(data,height,base,caps,counts,type=overall(data,height,base).type){
  return base.map((r,i)=>r+breakerSequence(data,height,base,caps,i,type).slice(0,counts[i]).reduce((a,b)=>a+b,0));
}
// AND binds within OR branches. The operator belongs to the preceding condition.
export function predicate(requirements,ratings){
  let term=true,result=false;
  for(let j=0;j<requirements.length;j++){
    const r=requirements[j];term=term&&ratings[r.attribute]>=r.minimum;
    if(j===requirements.length-1||r.operator_to_next==='OR'){result=result||term;term=true;}
  }
  return result;
}
export function badgeTier(badge,height,ratings){
  if(!badge.allowed||height<badge.height_inches[0]||height>badge.height_inches[1])return -1;
  let tier=-1;badge.tiers.forEach((t,j)=>{if(predicate(t.requirements,ratings))tier=j;});return tier;
}
export function badgeBranches(tier){
  const branches=[];let branch=[];
  for(let j=0;j<tier.requirements.length;j++){const r=tier.requirements[j];branch.push([r.attribute,r.minimum]);if(j===tier.requirements.length-1||r.operator_to_next==='OR'){branches.push(branch);branch=[];}}
  return branches;
}
export function splitPools(data,counts,specialization,generalBudget,specBudget=2){
  const eligible=counts.map((n,i)=>data.attrs[i].discipline===specialization||i===7?n:0);
  const spec=Array(21).fill(0);let left=specBudget;
  eligible.forEach((n,i)=>{spec[i]=Math.min(n,left);left-=spec[i];});
  const general=counts.map((n,i)=>n-spec[i]);
  return {general,spec,generalUsed:general.reduce((a,b)=>a+b,0),specUsed:spec.reduce((a,b)=>a+b,0),valid:counts.every(n=>Number.isInteger(n)&&n>=0&&n<=5)&&general.reduce((a,b)=>a+b,0)<=generalBudget};
}
