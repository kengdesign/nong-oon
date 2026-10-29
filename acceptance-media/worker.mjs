import {measureSample} from './quality.mjs';
export default {async fetch(request,env){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/measure')return new Response('Not found',{status:404});
  if(!env.ACCEPTANCE_TOKEN||request.headers.get('authorization')!==`Bearer ${env.ACCEPTANCE_TOKEN}`)return new Response('Denied',{status:403});
  try{
    const reader=request.body?.getReader();if(!reader)throw Error();let size=0;const chunks=[];
    for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>7200000){await reader.cancel();throw Error();}chunks.push(r.value);}
    const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
    const result=await measureSample(env,JSON.parse(new TextDecoder().decode(bytes)));
    return Response.json(result,{headers:{'cache-control':'no-store'}});
  }catch{return Response.json({state:'failed',code:'SAMPLE_OR_PROVIDER_REJECTED',pilotReady:false},{status:422,headers:{'cache-control':'no-store'}});}
}};
