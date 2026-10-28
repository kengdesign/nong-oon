import {json} from './http.mjs';
import {MEDIA_CONSENT_VERSION} from './media-policy.mjs';
import {MediaError,PROVIDERS,all,stmt,checked,requireMediaOwner,grantMediaConsent,reject,liveJobSQL} from './media-store.mjs';
import {readMediaJob,saveMediaReview,confirmMediaReview} from './media-review.mjs';
async function body(request){
  const text=await request.text();if(new TextEncoder().encode(text).length>16_384)reject('BODY_TOO_LARGE',413);
  try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch{reject('INVALID_MEDIA_BODY');}
}
export async function handleMediaApi(request,env,{actorId,now=Date.now()}={}){
  try{
    if(env.APP_ENV!=='staging'||env.MEDIA_API_ENABLED!=='true')return json(503,{error:'MEDIA_DISABLED'});
    if(!PROVIDERS[env.MEDIA_PROVIDER_ID])return json(503,{error:'MEDIA_PROVIDER_NOT_CONFIGURED'});
    const path=new URL(request.url).pathname,method=request.method;
    const m=/^\/api\/media\/patients\/([A-Za-z0-9_-]{1,128})(?:\/(.*))?$/.exec(path);
    if(!m)return json(404,{error:'NOT_FOUND'});
    const patientId=m[1],tail=m[2]??'',currentVersion=await requireMediaOwner(env.DB,patientId,actorId);
    if(tail==='consent'){
      if(method==='GET'){
        const consent=(await all(env.DB,'SELECT version,provider_id,expires_at,revoked_at FROM media_consents WHERE patient_id=? AND actor_id=?',[patientId,actorId]))[0];
        return json(200,{version:MEDIA_CONSENT_VERSION,provider:PROVIDERS[env.MEDIA_PROVIDER_ID],
          consented:Boolean(consent&&consent.version===MEDIA_CONSENT_VERSION&&consent.provider_id===env.MEDIA_PROVIDER_ID&&consent.revoked_at===null&&consent.expires_at>now)});
      }
      if(method==='POST'){
        const data=await body(request);if(Object.keys(data).sort().join(',')!=='consent,version'||data.consent!==true||data.version!==MEDIA_CONSENT_VERSION)reject('MEDIA_CONSENT_REQUIRED');
        return json(201,await grantMediaConsent(env.DB,{patientId,actorId,providerId:env.MEDIA_PROVIDER_ID,now}));
      }
      if(method==='DELETE'){
        checked(await stmt(env.DB,'UPDATE media_consents SET revoked_at=? WHERE patient_id=? AND actor_id=? AND revoked_at IS NULL',[now,patientId,actorId]).run());
        return json(200,{revoked:true});
      }
    }
    if(tail==='jobs'&&method==='GET'){
      const jobs=await all(env.DB,`SELECT id,source_kind AS sourceKind,state,created_at AS createdAt,expires_at AS expiresAt FROM media_jobs
        WHERE patient_id=? AND actor_id=? AND expires_at>? AND provider_id=? AND ${liveJobSQL} ORDER BY created_at DESC LIMIT 20`,[patientId,actorId,now,env.MEDIA_PROVIDER_ID,now]);
      return json(200,{jobs,currentVersion});
    }
    const j=/^jobs\/([A-Za-z0-9_-]{1,128})(?:\/(source|reviews\/(\d+)(\/confirm)?))?$/.exec(tail);
    if(j){
      const jobId=j[1],context={jobId,patientId,actorId,now,providerId:env.MEDIA_PROVIDER_ID};
      if(!j[2]&&method==='GET'){
        const view=await readMediaJob(env.DB,context);
        return json(200,{jobId,sourceKind:view.row.source_kind,draft:view.draft,currentVersion:view.currentVersion,expiresAt:view.row.expires_at,
          reviews:view.reviews.map(r=>({itemIndex:r.item_index,version:r.version,confirmed:r.confirmed_at!==null,expiresAt:r.expires_at,snapshot:JSON.parse(r.snapshot_json)}))});
      }
      if(j[2]==='source'&&method==='GET'){
        const view=await readMediaJob(env.DB,context),object=await env.MEDIA_R2.get(view.row.object_key);
        if(!object)reject('MEDIA_SOURCE_UNAVAILABLE',404);
        await readMediaJob(env.DB,context);
        return new Response(object.body,{headers:{'content-type':view.row.content_type??'application/octet-stream','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
      }
      if(j[3]!==undefined){
        const itemIndex=Number(j[3]);
        if(!j[4]&&method==='PUT')return json(200,await saveMediaReview(env.DB,{...context,itemIndex,input:await body(request)}));
        if(j[4]&&method==='POST'){
          const result=await confirmMediaReview(env.DB,{...context,itemIndex,input:await body(request)});
          const response=json(200,result);response.headers.set('x-nongoon-wake-patient',patientId);return response;
        }
      }
    }
    return json(404,{error:'NOT_FOUND'});
  }catch(error){return json(error instanceof MediaError?error.status:503,{error:error instanceof MediaError?error.code:'MEDIA_UNAVAILABLE'});}
}
