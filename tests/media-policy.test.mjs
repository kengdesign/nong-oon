import test from 'node:test';
import assert from 'node:assert/strict';
import {MEDIA_CONSENT_VERSION,MEDIA_TTL_MS,mediaAccessDecision} from '../src/media-policy.mjs';
const fixture=()=>({now:10_000,enabled:true,principal:{actorId:'owner-test',profileId:'profile-test',canManage:true,blocked:false},
  consent:{actorId:'owner-test',profileId:'profile-test',version:MEDIA_CONSENT_VERSION,purpose:'media_extraction',grantedAt:1000,expiresAt:100_000,revokedAt:null},
  job:{actorId:'owner-test',profileId:'profile-test',sourceKind:'voice',state:'queued',createdAt:2000,expiresAt:90_000,unsentAt:null}});
test('media is disabled by default and only explicit current scoped consent enables processing',()=>{
  assert.equal(mediaAccessDecision().allowed,false);
  const f=fixture();assert.equal(mediaAccessDecision(f).allowed,true);
  for(const patch of [{enabled:false},{enabled:'true'},{consent:null},{now:NaN}])assert.equal(mediaAccessDecision({...f,...patch}).allowed,false);
  for(const patch of [{version:'care-consent-v1'},{purpose:'care_management'},{revokedAt:5000},{revokedAt:undefined},
    {grantedAt:20_000},{expiresAt:10_000}])assert.equal(mediaAccessDecision({...f,consent:{...f.consent,...patch}}).allowed,false);
});
test('cross-account, cross-profile, blocked and non-manager access never grants media processing',()=>{
  const f=fixture();
  for(const patch of [{actorId:'outsider'},{profileId:'other'},{blocked:true},{blocked:undefined},{canManage:false}])
    assert.equal(mediaAccessDecision({...f,principal:{...f.principal,...patch}}).allowed,false);
  for(const section of ['consent','job'])for(const patch of [{actorId:'other'},{profileId:'other'}])
    assert.equal(mediaAccessDecision({...f,[section]:{...f[section],...patch}}).allowed,false);
});
test('unsend, expiry and terminal states deny queued work without changing confirmed schedules',()=>{
  const f=fixture();const before=JSON.stringify(f);
  for(const patch of [{unsentAt:9000},{unsentAt:undefined},{expiresAt:f.now},{state:'cancelled'},
    {state:'confirmed'},{state:'expired'},{state:'failed'},{state:'invented'}])
    assert.equal(mediaAccessDecision({...f,job:{...f.job,...patch}}).allowed,false);
  assert.equal(JSON.stringify(f),before);
});
test('lifetime is bounded by source consent and 24 hours; revoked access is re-evaluated',()=>{
  const f=fixture();
  for(const patch of [{createdAt:0},{createdAt:f.now+1},{expiresAt:200_000},{expiresAt:Number.MAX_SAFE_INTEGER},
    {expiresAt:f.job.createdAt+MEDIA_TTL_MS+1},{expiresAt:f.job.createdAt},{sourceKind:'remote_url'}])
    assert.equal(mediaAccessDecision({...f,job:{...f.job,...patch}}).allowed,false);
  assert.equal(mediaAccessDecision(f).allowed,true);f.consent.revokedAt=f.now;
  const denied=mediaAccessDecision(f);assert.equal(denied.allowed,false);
  assert.doesNotMatch(JSON.stringify(denied),/owner-test|profile-test/);
});
