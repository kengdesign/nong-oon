import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const folder='acceptance-media/private';
const vars=readFileSync('acceptance-media/.dev.vars','utf8');
const token=/^ACCEPTANCE_TOKEN="([a-f0-9]+)"/m.exec(vars)?.[1];if(!token)throw Error('RUN_SETUP_FIRST');
const results=[];
for(const [kind,file,type] of [['image','image.jpg','image/jpeg'],['voice','voice.wav','audio/wav']]){
  if(!existsSync(`${folder}/${file}`)||!existsSync(`${folder}/${kind}.txt`)){results.push({kind,state:'blocked',code:'INPUT_FILES_REQUIRED'});continue;}
  const bytes=readFileSync(`${folder}/${file}`);if(bytes.length>5*1024*1024)throw Error('SAMPLE_TOO_LARGE');
  const reference=readFileSync(`${folder}/${kind}.txt`,'utf8').replace(/^\uFEFF/,'').trim();
  if(!reference||reference.includes('REPLACE_')){results.push({kind,state:'blocked',code:'REFERENCE_REQUIRED'});continue;}
  // A receipt blocks accidental paid replays; remove only deliberately for a new sample.
  const receipt=`${folder}/${kind}.attempt.json`;
  if(existsSync(receipt)){results.push({kind,state:'blocked',code:'ATTEMPT_ALREADY_RECORDED'});continue;}
  writeFileSync(receipt,JSON.stringify({kind,state:'started',at:new Date().toISOString()}));
  try{
    const response=await fetch('http://127.0.0.1:8798/measure',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({kind,base64:bytes.toString('base64'),contentType:type,reference}),signal:AbortSignal.timeout(90000)});
    const result=await response.json();writeFileSync(receipt,JSON.stringify(result,null,2));results.push(result);
  }catch{const result={kind,state:'failed',code:'PREVIEW_UNREACHABLE_OR_TIMEOUT'};writeFileSync(receipt,JSON.stringify(result));results.push(result);}
}
const report={at:new Date().toISOString(),results,pilotReady:false};
writeFileSync(`${folder}/aggregate-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(results.some(r=>r.screen!=='passed'))process.exitCode=1;
