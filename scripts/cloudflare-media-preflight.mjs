// Read-only API checks. Credential comes from the process environment; never logged.
import {readFileSync} from 'node:fs';
export async function mediaPreflight({token,accountId,worker,bucket,queue,fetcher=fetch}={}){
  if(typeof token!=='string'||!token.trim()||!/^\w{32}$/.test(accountId??'')||![worker,bucket,queue].every(v=>typeof v==='string'&&/^[a-z0-9-]{1,63}$/.test(v)))throw Error('PREFLIGHT_INPUT_REQUIRED');
  const request=async path=>{
    try{const r=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`,{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!r.ok){await r.body?.cancel();return {ok:false,status:r.status};}
      const body=await r.json();return body.success===true?{ok:true,result:body.result}:{ok:false,status:502};
    }catch{return {ok:false,status:0};}
  };
  const settings=await request(`workers/scripts/${worker}/settings`);
  const bindings=settings.ok&&Array.isArray(settings.result?.bindings)?settings.result.bindings:[];
  const expected=['DB','MEDIA_R2','MEDIA_QUEUE','AI','GOOGLE_VISION_API_KEY'];
  const found=Object.fromEntries(expected.map(name=>[name,bindings.some(b=>b.name===name)]));
  const switches=Object.fromEntries(['APP_ENV','MEDIA_API_ENABLED','MEDIA_PROCESSING_ENABLED','MEDIA_PROVIDER_ENABLED'].map(name=>{
    const b=bindings.find(v=>v.name===name&&v.type==='plain_text');
    return [name,name==='APP_ENV'?b?.text==='staging':b?.text==='true'];
  }));
  const r2=await request(`r2/buckets/${bucket}`),q=await request('queues?per_page=100');
  const listed=q.ok&&Array.isArray(q.result)?q.result:[];
  const queueFound=listed.some(v=>v.queue_name===queue);
  return {readOnly:true,checkedAt:new Date().toISOString(),settingsReadable:settings.ok,settingsStatus:settings.ok?200:settings.status,
    bindings:found,gates:switches,bucketReadable:r2.ok,bucketStatus:r2.ok?200:r2.status,queueListed:queueFound,
    queueListStatus:q.ok?200:q.status,queueListLimitedToFirst100:true,
    readyForDrill:settings.ok&&Object.values(found).every(Boolean)&&r2.ok&&queueFound,
    limitations:['Does not send queue messages or write/delete R2 objects','Does not prove binding resource targets, migration state, provider access, consumer delivery or purge','readyForDrill is not pilot or release approval']};
}
if(process.argv[1]?.endsWith('cloudflare-media-preflight.mjs')){
  try{
    // Config contains resource names only, never credentials. API token stays in memory.
    const config=JSON.parse(readFileSync(process.argv[2]??'', 'utf8'));
    const report=await mediaPreflight({...config,token:process.env.CLOUDFLARE_API_TOKEN});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }catch{process.stderr.write('PREFLIGHT_INPUT_OR_ACCESS_FAILED\n');process.exitCode=1;}
}
