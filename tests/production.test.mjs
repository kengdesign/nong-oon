import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mediaEnvironment} from '../src/app-environment.mjs';
import worker from '../src/webhook.mjs';
test('production bindings are isolated and outbound delivery starts disabled',()=>{
 const prod=JSON.parse(readFileSync('wrangler.production.jsonc'));
 const stage=JSON.parse(readFileSync('wrangler.jsonc'));
 assert.equal(prod.d1_databases[0].binding,'DB');
 assert.notEqual(prod.d1_databases[0].database_id,stage.d1_databases[0].database_id);
 assert.equal(prod.r2_buckets[0].binding,'MEDIA_R2');
 assert.notEqual(prod.r2_buckets[0].bucket_name,stage.r2_buckets[0].bucket_name);
 assert.equal(prod.queues.producers[0].binding,'MEDIA_QUEUE');
 assert.notEqual(prod.queues.producers[0].queue,stage.queues.producers[0].queue);
 assert.equal(prod.vars.DELIVERY_ENABLED,'false');
 assert.equal(prod.vars.SYNTHETIC_INGESTION_ENABLED,'false');
 assert.equal(prod.routes[0].pattern,'nongoon.com');
});
test('media environments fail closed for unknown deployment names',()=>{
 for(const APP_ENV of ['staging','production'])assert.equal(mediaEnvironment({APP_ENV}),true);
 for(const APP_ENV of [undefined,'preview','Production',''])assert.equal(mediaEnvironment({APP_ENV}),false);
});
test('production health reports its environment and disabled delivery',async()=>{
 const response=await worker.fetch(new Request('https://nongoon.com/health'),{APP_ENV:'production',DELIVERY_ENABLED:'false'},{});
 assert.deepEqual(await response.json(),{status:'production',deliveryEnabled:false});
});
