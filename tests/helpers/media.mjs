import { createTestDb } from './db.mjs';
import { handleCareApi,CONSENT_VERSION } from '../../src/care-api.mjs';
import { grantMediaConsent } from '../../src/media-store.mjs';
import { DRAFT_FIELDS } from '../../src/draft-contract.mjs';
export const owner='U'+'1'.repeat(32),other='U'+'2'.repeat(32);
export async function mediaFixture(){
  const f=createTestDb(),now=Date.now(),objects=new Map(),messages=[];
  for(const a of [owner,other])f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(a,a,now-2000);
  const r=await handleCareApi(new Request('https://example.test/api/patients',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({displayName:'Synthetic media test',consent:true,consentVersion:CONSENT_VERSION})}),{DB:f.db},{actorId:owner,now:now-2000});
  const patientId=(await r.json()).patient.id;
  await grantMediaConsent(f.db,{patientId,actorId:owner,providerId:'google-vision-v1',now:now-1000});
  return {...f,now,patientId,objects,messages,env:{DB:f.db,APP_ENV:'staging',MEDIA_API_ENABLED:'true',MEDIA_PROCESSING_ENABLED:'true',
    MEDIA_PROVIDER_ID:'google-vision-v1',LINE_CHANNEL_ACCESS_TOKEN:'fixture-token',
    MEDIA_QUEUE:{async send(v){messages.push(v);}},
    MEDIA_R2:{async put(key,bytes,options){objects.set(key,{bytes:bytes.slice(),options});},async delete(key){objects.delete(key);},
      async get(key){const value=objects.get(key);return value?{body:value.bytes}:null;}}}};
}
export const mediaEvent=(now,id='123')=>({webhookEventId:`fixture_${id}`,type:'message',timestamp:now,source:{type:'user',userId:owner},message:{type:'image',id}});
export const unsendEvent=(id='123')=>({type:'unsend',source:{type:'user',userId:owner},unsend:{messageId:id}});
export const png=()=>new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
export const fakeFetch=async()=>new Response(png(),{headers:{'content-type':'image/png'}});
export const extraction=()=>JSON.stringify({schemaVersion:1,sourceKind:'printed_label',items:[{fields:Object.fromEntries(DRAFT_FIELDS.map(k=>[k,{value:null,evidence:null}])),issues:[]}]});
