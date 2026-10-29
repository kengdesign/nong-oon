// Localhost-only browser acceptance against real review handlers and disposable SQLite.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {mediaFixture,mediaEvent,owner,extraction} from '../tests/helpers/media.mjs';
import {ingestMediaEvents} from '../src/media-store.mjs';
import {processMediaJob} from '../src/media-pipeline.mjs';
import {handleMediaApi} from '../src/media-api.mjs';
const f=await mediaFixture(),csrf=crypto.randomUUID();
const fixtures=JSON.parse(readFileSync('platform-media/fixtures.json','utf8'));
await ingestMediaEvents(f.db,[mediaEvent(f.now)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
const jobId=f.sql.prepare('SELECT id FROM media_jobs').get().id;
await processMediaJob(f.env,jobId,{clock:()=>f.now,fetcher:async()=>new Response(Buffer.from(fixtures.png,'base64'),{headers:{'content-type':'image/png'}}),infer:async()=>extraction()});
const files={'/':'media-review.html','/media-review.html':'media-review.html','/media-review.mjs':'media-review.mjs','/media-review.css':'media-review.css','/app.css':'app.css','/privacy.html':'privacy.html'};
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!=='127.0.0.1:8799'){res.writeHead(403).end();return;}
    const path=new URL(req.url,'http://127.0.0.1:8799').pathname;
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    if(req.method==='GET'&&files[path]){
      const name=files[path];let bytes=readFileSync('public/'+name);
      if(name==='media-review.html')bytes=Buffer.from(bytes.toString().replace('<h1>','<p style="background:#ffe0a0;padding:16px">LOCAL SYNTHETIC TEST ONLY — ไม่เชื่อม LINE หรือ Cloudflare</p><h1>'));
      res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8','cache-control':'no-store'});res.end(bytes);return;
    }
    if(path==='/api/session'&&req.method==='GET'){send(200,{authenticated:true,csrf});return;}
    if(path==='/api/patients'&&req.method==='GET'){send(200,{patients:[{id:f.patientId,role:'owner',displayName:'SYNTHETIC ONLY'}]});return;}
    if(!['GET','PUT','POST','DELETE'].includes(req.method)){send(405,{error:'METHOD_NOT_ALLOWED'});return;}
    if(req.method!=='GET'&&(req.headers['x-csrf-token']!==csrf||req.headers.origin!=='http://127.0.0.1:8799')){send(403,{error:'CSRF'});return;}
    let body='';for await(const c of req){body+=c;if(Buffer.byteLength(body)>16384){send(413,{error:'BODY_TOO_LARGE'});return;}}
    const request=new Request('http://127.0.0.1:8799'+req.url,{method:req.method,headers:{'content-type':'application/json'},...(body?{body}:{})});
    const response=await handleMediaApi(request,f.env,{actorId:owner,now:Date.now()});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    if(path.endsWith('/confirm')&&response.ok){const n=f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n;console.log('LOCAL_CONFIRM_RESULT schedules='+n);}
  }catch{res.writeHead(503,{'content-type':'application/json'}).end('{"error":"LOCAL_TEST_FAILED"}');}
});
server.listen(8799,'127.0.0.1',()=>console.log('Open http://127.0.0.1:8799 — disposable synthetic DB; Ctrl+C stops.'));
process.on('SIGINT',()=>server.close(()=>{f.close();process.exit(0);}));
