import {readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
const args=process.argv.slice(2);
const kindIndex=args.indexOf('--kind');
const selected=kindIndex>=0?args[kindIndex+1]:'all';
const retryFailed=args.includes('--retry-failed');
const accepted=kindIndex>=0?['--kind',selected,...(retryFailed?['--retry-failed']:[])]:retryFailed?['--retry-failed']:[];
if(!['all','image','voice'].includes(selected)||args.length!==accepted.length||args.some(a=>!accepted.includes(a)))throw Error('USE_KIND_IMAGE_OR_VOICE_AND_OPTIONAL_RETRY_FAILED');
const folder='acceptance-media/private';
const vars=readFileSync('acceptance-media/.dev.vars','utf8');
const token=/^ACCEPTANCE_TOKEN="([a-f0-9]+)"/m.exec(vars)?.[1];if(!token)throw Error('RUN_SETUP_FIRST');
const results=[];
for(const [kind,file,type] of [['image','image.jpg','image/jpeg'],['voice','voice.wav','audio/wav']]){
  if(selected!=='all'&&selected!==kind)continue;
  if(!existsSync(`${folder}/${file}`)||!existsSync(`${folder}/${kind}.txt`)){results.push({kind,state:'blocked',code:'INPUT_FILES_REQUIRED'});continue;}
  const bytes=readFileSync(`${folder}/${file}`);if(bytes.length>5*1024*1024)throw Error('SAMPLE_TOO_LARGE');
  const reference=readFileSync(`${folder}/${kind}.txt`,'utf8').replace(/^\uFEFF/,'').trim();
  if(!reference||reference.includes('REPLACE_')){results.push({kind,state:'blocked',code:'REFERENCE_REQUIRED'});continue;}
  // A receipt blocks accidental paid replays; remove only deliberately for a new sample.
  const receipt=`${folder}/${kind}.attempt.json`;
  if(existsSync(receipt)){
    const previous=JSON.parse(readFileSync(receipt,'utf8'));
    if(!retryFailed||previous.state!=='failed'||previous.code!=='SAMPLE_OR_PROVIDER_REJECTED'){
      results.push({kind,state:'blocked',code:'ATTEMPT_ALREADY_RECORDED'});continue;
    }
    const archive=`${receipt}.${Date.now()}.previous.json`;
    writeFileSync(archive,JSON.stringify(previous,null,2),{flag:'wx'});
    // Preserve the original receipt too until the archive has been written successfully.
    renameSync(receipt,`${archive}.original`);
  }
  writeFileSync(receipt,JSON.stringify({kind,state:'started',at:new Date().toISOString()}));
  try{
    const response=await fetch('http://127.0.0.1:8798/measure',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({kind,base64:bytes.toString('base64'),contentType:type,reference}),signal:AbortSignal.timeout(90000)});
    const result=await response.json();writeFileSync(receipt,JSON.stringify(result,null,2));results.push(result);
  }catch{const result={kind,state:'failed',code:'PREVIEW_UNREACHABLE_OR_TIMEOUT'};writeFileSync(receipt,JSON.stringify(result));results.push(result);}
}
const report={at:new Date().toISOString(),results,pilotReady:false};
if(existsSync(`${folder}/aggregate-report.json`))writeFileSync(`${folder}/aggregate-report.${Date.now()}.previous.json`,readFileSync(`${folder}/aggregate-report.json`),{flag:'wx'});
writeFileSync(`${folder}/aggregate-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(results.some(r=>r.screen!=='passed'))process.exitCode=1;
