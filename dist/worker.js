import {optimize} from './optimizer.js';
let data;
self.onmessage=async event=>{
  try{data??=await fetch('./data/rules.json').then(r=>{if(!r.ok)throw new Error('Cannot load game data.');return r.json();});
    const result=await optimize(data,event.data,p=>self.postMessage({kind:'progress',...p}));self.postMessage({kind:'result',result});
  }catch(error){self.postMessage({kind:'error',message:error.message});}
};
