import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
const root='acceptance-media/private/quality-corpus';
const cases=[];
for(const layout of ['blister','bottle','sachet','voice']){
 const folder=`${root}/${layout}`;mkdirSync(folder,{recursive:true});
 const files={'reference.txt':'','prediction.txt':'','review.json':JSON.stringify({humanReviewed:false,scope:'unknown'},null,2)};
 for(const [file,value] of Object.entries(files))if(!existsSync(`${folder}/${file}`))writeFileSync(`${folder}/${file}`,value);
 cases.push({layout,sourceKind:layout==='voice'?'voice':'printed_label',folder});
}
writeFileSync(`${root}/README.txt`,['PRIVATE INPUTS: never commit these files.','Place deidentified source.jpg in blister/bottle/sachet and source.wav in voice.','reference.txt: independently transcribed by a human, including omissions/negation.','prediction.txt: actual provider output for that same file; do not copy reference into it.','review.json: set humanReviewed=true and scope=full only after complete human review.','Optional referenceDraft must follow draft-contract and be independently annotated.','Run: node scripts/evaluate-quality-corpus.mjs','No provider calls are made. Results are transcript/extraction scores only; not proof of a live provider run.'].join('\n'));
console.log(JSON.stringify({folder:root,layouts:cases.map(c=>c.layout),providerCalls:0,pilotReady:false}));
