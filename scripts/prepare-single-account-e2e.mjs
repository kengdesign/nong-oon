import {mkdirSync,writeFileSync} from 'node:fs';
const [suffix,databaseId]=process.argv.slice(2);
if(!/^\d{14}-[a-f0-9]{6}$/.test(suffix??'')||!/^\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(databaseId??''))throw Error('INVALID_ISOLATED_RESOURCE_ARGUMENTS');
const name='nong-oon-e2e-'+suffix,dir='acceptance-media/private/single-account';
mkdirSync(dir,{recursive:true});
const config={name,main:'../../single-account-e2e.mjs',compatibility_date:'2026-10-25',workers_dev:false,preview_urls:false,vars:{E2E_ENV:'isolated-single-account'},triggers:{crons:['*/5 * * * *']},d1_databases:[{binding:'E2E_DB',database_name:name,database_id:databaseId,migrations_dir:'../../../migrations'}],r2_buckets:[{binding:'E2E_R2',bucket_name:name}],observability:{enabled:false}};
writeFileSync(dir+'/wrangler.json',JSON.stringify(config,null,2),{flag:'wx'});
console.log(JSON.stringify({worker:name,database:name,bucket:name,publicRoutes:false,lineBindings:false}));
