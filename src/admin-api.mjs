import { json } from './http.mjs';
import { deliveryWindowOpen } from './delivery.mjs';

const actor = value => typeof value === 'string' && /^U[0-9a-f]{32}$/.test(value);
const token = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), b => b.toString(16).padStart(2,'0')).join('');
const fail = (status, code) => { throw Object.assign(new Error(code),{ status, code, adminError:true }); };
const checked = result => { if (result?.success !== true) throw Error('ADMIN_STORAGE_FAILED'); return result; };
const all = async (db, query, args=[]) => checked(await db.prepare(query).bind(...args).all()).results;
const stmt = (db, query, args=[]) => db.prepare(query).bind(...args);
async function body(request, keys) {
  let value; try { const text=await request.text(); if(text.length>2048) fail(413,'PAYLOAD_TOO_LARGE'); value=JSON.parse(text); }
  catch(error) { if(error.adminError) throw error; fail(400,'INVALID_ADMIN_INPUT'); }
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==keys.length
    || keys.some(key=>!Object.hasOwn(value,key))) fail(400,'INVALID_ADMIN_INPUT');
  return value;
}
export const ADMIN_INVITE_TTL = 24*60*60*1000;
export async function handleAdminApi(request, env, {actorId,now=Date.now()}={}) {
  try {
    if(env.SERVICE_ADMIN_ENABLED!=='true' || !actor(env.SERVICE_OWNER_ACTOR_ID)) return json(503,{error:'ADMIN_DISABLED'});
    if(!actor(actorId)) fail(401,'UNAUTHENTICATED');
    if(!Number.isSafeInteger(now) || now<0) throw Error('INVALID_CLOCK');
    const db=env.DB, owner=env.SERVICE_OWNER_ACTOR_ID;
    if((await all(db,'SELECT actor_id FROM accounts WHERE actor_id=? AND blocked_at IS NULL',[actorId])).length!==1) fail(401,'UNAUTHENTICATED');
    // A blocked service owner freezes administrative access, including outstanding invitations.
    if((await all(db,'SELECT actor_id FROM accounts WHERE actor_id=? AND blocked_at IS NULL',[owner])).length!==1) fail(403,'ADMIN_FORBIDDEN');
    const role=actorId===owner ? 'owner' : (await all(db,
      'SELECT actor_id FROM service_admins WHERE actor_id=? AND granted_by=? AND revoked_at IS NULL',[actorId,owner])).length===1 ? 'admin' : 'none';
    const path=new URL(request.url).pathname, method=request.method;
    if(path==='/api/admin/session' && method==='GET') return json(200,{role,actorId});
    if(path==='/api/admin/invites/accept' && method==='POST') {
      const input=await body(request,['code']);
      if(!token(input.code) || actorId===owner) fail(400,'ADMIN_INVITE_INVALID');
      const digest=await hash(input.code), claim=random();
      const result=await db.batch([
        stmt(db,`UPDATE service_admin_invites SET consumed_at=?,claim_id=? WHERE code_hash=?
          AND target_actor_id=? AND issued_by=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?
          AND EXISTS(SELECT 1 FROM accounts WHERE actor_id=? AND blocked_at IS NULL)
          AND EXISTS(SELECT 1 FROM accounts WHERE actor_id=? AND blocked_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM service_admins WHERE actor_id=? AND revoked_at IS NULL)
          AND (SELECT COUNT(*) FROM service_admins WHERE revoked_at IS NULL)<5 RETURNING code_hash`,
        [now,claim,digest,actorId,owner,now,actorId,owner,actorId]),
        stmt(db,`INSERT INTO service_admins(actor_id,granted_by,granted_at)
          SELECT target_actor_id,issued_by,? FROM service_admin_invites WHERE claim_id=?
          ON CONFLICT(actor_id) DO UPDATE SET granted_by=excluded.granted_by,granted_at=excluded.granted_at,revoked_at=NULL,revoked_by=NULL
          WHERE service_admins.revoked_at IS NOT NULL RETURNING actor_id`,[now,claim]),
      ]);
      result.forEach(checked);
      if(result[0].results?.length!==1 || result[1].results?.length!==1) fail(409,'ADMIN_INVITE_INVALID');
      return json(200,{role:'admin'});
    }
    if(role==='none') fail(403,'ADMIN_FORBIDDEN');
    if(path==='/api/admin/status' && method==='GET') return json(200,{
      environment:env.APP_ENV??'unknown',deliveryEnabled:deliveryWindowOpen(env,now),
      schedulerEnabled:env.SCHEDULER_ENABLED==='true',
      operations:await all(db,'SELECT task,last_ok_at AS lastOkAt,rows_processed AS rowsProcessed FROM operation_health ORDER BY task LIMIT 20'),
    });
    // Partners can inspect operational health; only the configured owner manages membership.
    if(role!=='owner') fail(403,'ADMIN_OWNER_REQUIRED');
    if(path==='/api/admin/members' && method==='GET') return json(200,{
      members:await all(db,'SELECT actor_id AS actorId,granted_at AS grantedAt,revoked_at AS revokedAt FROM service_admins ORDER BY granted_at DESC LIMIT 100'),
      invitations:await all(db,`SELECT code_hash AS id,target_actor_id AS targetActorId,expires_at AS expiresAt FROM service_admin_invites
        WHERE issued_by=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 10`,[owner,now]),
    });
    if(path==='/api/admin/audit' && method==='GET') return json(200,{events:await all(db,
      'SELECT action,actor_id AS actorId,target_actor_id AS targetActorId,created_at AS createdAt FROM service_admin_audit ORDER BY created_at DESC,event_id LIMIT 100')});
    if(path==='/api/admin/invites' && method==='POST') {
      const input=await body(request,['targetActorId']);
      if(!actor(input.targetActorId) || input.targetActorId===owner) fail(400,'INVALID_ADMIN_INPUT');
      const code=random(), digest=await hash(code), expiresAt=now+ADMIN_INVITE_TTL;
      const saved=await all(db,`INSERT INTO service_admin_invites(code_hash,target_actor_id,issued_by,created_at,expires_at)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE actor_id=? AND blocked_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM service_admins WHERE actor_id=? AND revoked_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM service_admin_invites WHERE target_actor_id=? AND issued_by=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?)
          AND (SELECT COUNT(*) FROM service_admin_invites WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?)<10
          AND (SELECT COUNT(*) FROM service_admins WHERE revoked_at IS NULL)<5 RETURNING code_hash`,
      [digest,input.targetActorId,owner,now,expiresAt,input.targetActorId,input.targetActorId,input.targetActorId,owner,now,now]);
      if(saved.length!==1) fail(409,'ADMIN_INVITE_UNAVAILABLE');
      return json(201,{code,expiresAt,targetActorId:input.targetActorId});
    }
    const invite=/^\/api\/admin\/invites\/([0-9a-f]{64})$/.exec(path);
    if(invite && method==='DELETE') {
      const changed=await all(db,`UPDATE service_admin_invites SET revoked_at=? WHERE code_hash=? AND issued_by=? AND consumed_at IS NULL AND revoked_at IS NULL RETURNING code_hash`,[now,invite[1],owner]);
      if(changed.length!==1) fail(404,'ADMIN_NOT_FOUND');
      return json(200,{revoked:true});
    }
    const member=/^\/api\/admin\/members\/(U[0-9a-f]{32})$/.exec(path);
    if(member && method==='DELETE') {
      if(member[1]===owner) fail(403,'ADMIN_OWNER_REQUIRED');
      const result=await db.batch([
        stmt(db,`UPDATE service_admins SET revoked_at=?,revoked_by=? WHERE actor_id=? AND revoked_at IS NULL RETURNING actor_id`,[now,owner,member[1]]),
        stmt(db,`UPDATE service_admin_invites SET revoked_at=? WHERE target_actor_id=? AND consumed_at IS NULL AND revoked_at IS NULL`,[now,member[1]]),
      ]);
      result.forEach(checked);
      if(result[0].results?.length!==1) fail(404,'ADMIN_NOT_FOUND');
      return json(200,{revoked:true});
    }
    fail(404,'NOT_FOUND');
  } catch(error) { return json(error.adminError?error.status:503,{error:error.adminError?error.code:'ADMIN_UNAVAILABLE'}); }
}
