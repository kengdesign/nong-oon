// Generates scoped SELECT only; never exports OCR/source text or identities.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
try{
 const m=JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
 const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
 if(m.syntheticOnly!==true||!id(m.patientId)||!Array.isArray(m.jobs)||m.jobs.length!==2||!m.jobs.every(id)||new Set(m.jobs).size!==2)throw Error();
 const sql=`WITH scoped AS (SELECT j.* FROM media_jobs j JOIN patients p ON p.id=j.patient_id WHERE p.display_name='SYNTHETIC E2E' AND p.id='${m.patientId}' AND j.id IN ('${m.jobs.join("','")}')) SELECT COUNT(*) AS jobs_found, SUM(state='confirmed') AS confirmed, SUM(state='cancelled') AS cancelled, SUM(draft_json IS NOT NULL OR message_id IS NOT NULL) AS uncleared_payloads, (SELECT COUNT(*) FROM media_reviews WHERE job_id IN (SELECT id FROM scoped)) AS remaining_reviews, (SELECT COUNT(*) FROM media_receipts WHERE job_id IN (SELECT id FROM scoped)) AS replay_receipts FROM scoped;`;
 mkdirSync('acceptance-media/private',{recursive:true});
 writeFileSync('acceptance-media/private/e2e-proof.sql',sql,{flag:'wx'});
 console.log(JSON.stringify({readOnly:true,file:'acceptance-media/private/e2e-proof.sql',physicalR2Deletion:'not_verified'}));
}catch{console.log(JSON.stringify({state:'blocked',code:'MANIFEST_INVALID_OR_PROOF_FILE_EXISTS'}));process.exitCode=1;}
