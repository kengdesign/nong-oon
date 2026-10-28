// Isolated synthetic-only worker: no LINE, care DB, public routes or real media.
const ID='synthetic-v1';
const KEY='synthetic-drill/fixed-v1.bin';
const check=r=>{if(r?.success!==true)throw Error('DRILL_DB_FAILED');return r;};
export async function seed(env){
  if(env.DRILL_ENABLED!=='true')return;
  const r=check(await env.DB.prepare("INSERT INTO drill_jobs(id,state) VALUES(?,'queued') ON CONFLICT DO NOTHING RETURNING id").bind(ID).all());
  if(r.results.length)await env.R2.put(KEY,new TextEncoder().encode('NONG OON SYNTHETIC ONLY'));
  // Retry dispatch until delivered; consumer is idempotent. Max 10 cron dispatches.
  const next=check(await env.DB.prepare("UPDATE drill_jobs SET dispatches=dispatches+1 WHERE id=? AND state='queued' AND dispatches<10 RETURNING id").bind(ID).all());
  if(next.results.length)await env.QUEUE.send({jobId:ID});
}
export async function consume(batch,env){
  if(env.DRILL_ENABLED!=='true'){batch.retryAll({delaySeconds:60});return;}
  for(const message of batch.messages){
    if(JSON.stringify(message.body)!==JSON.stringify({jobId:ID})){message.ack();continue;}
    try{
      const row=await env.DB.prepare('SELECT state FROM drill_jobs WHERE id=?').bind(ID).first();
      if(!row){message.ack();continue;}
      if(row.state==='deleted'){message.ack();continue;}
      const object=await env.R2.get(KEY);
      if(object&&await object.text()!=='NONG OON SYNTHETIC ONLY')throw Error('DRILL_CONTENT_MISMATCH');
      if(!object&&row.state==='queued'){
        // A previous delivery may have deleted the object before committing its receipt.
        const marker=await env.DB.prepare('SELECT delete_started FROM drill_jobs WHERE id=?').bind(ID).first();
        if(marker.delete_started!==1)throw Error('DRILL_OBJECT_MISSING');
      }
      check(await env.DB.prepare('UPDATE drill_jobs SET delete_started=1 WHERE id=?').bind(ID).run());
      await env.R2.delete(KEY);
      if(await env.R2.head(KEY))throw Error('DRILL_DELETE_FAILED');
      check(await env.DB.prepare("UPDATE drill_jobs SET state='deleted',completed_at=? WHERE id=?").bind(Date.now(),ID).run());
      message.ack();
    }catch{message.retry({delaySeconds:60});}
  }
}
async function ai(env){
  if(env.AI_DRILL_ENABLED!=='true')return;
  for(const kind of ['voice','image']){
    if(kind==='image'&&!env.GOOGLE_VISION_API_KEY)continue;
    const claim=check(await env.DB.prepare("INSERT INTO drill_ai(kind,state) VALUES(?,'started') ON CONFLICT DO NOTHING RETURNING kind").bind(kind).all());
    if(!claim.results.length)continue; // one paid attempt per kind, no automatic replay
    let state='failed';
    try{
      if(kind==='voice'){
        const r=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio:env.SYNTHETIC_WAV,task:'transcribe',language:'th',vad_filter:true});
        if(typeof r.text!=='string')throw Error();
      }else{
        const r=await fetch('https://vision.googleapis.com/v1/images:annotate',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json','x-goog-api-key':env.GOOGLE_VISION_API_KEY},body:JSON.stringify({requests:[{image:{content:env.SYNTHETIC_PNG},features:[{type:'DOCUMENT_TEXT_DETECTION'}]}]})});
        if(!r.ok)throw Error();const out=await r.json();if(!Array.isArray(out.responses)||out.responses.length!==1||out.responses[0].error)throw Error();
        if(!out.responses[0].fullTextAnnotation?.text?.includes('SYNTHETIC'))throw Error();
      }
      state='passed';
    }catch{} // fixed state only: never persist transcripts, key or provider error bodies
    check(await env.DB.prepare('UPDATE drill_ai SET state=? WHERE kind=?').bind(state,kind).run());
  }
}
export default {fetch(){return new Response('Not found',{status:404});},queue:consume,
  async scheduled(_event,env){await seed(env);await ai(env);}};
