import {readFileSync,writeFileSync} from 'node:fs';
import {draftFromText} from '../src/media-extraction.mjs';
const root=process.argv[2]??'acceptance-media/private/quality-corpus';
const groups={};
for(const name of ['blister','bottle','sachet','voice']){
 const text=readFileSync(`${root}/${name}/prediction.txt`,'utf8').replace(/^\uFEFF/,'');
 const draft=JSON.parse(draftFromText(text,name==='voice'?'voice':'printed_label'));
 const item=draft.items[0];
 writeFileSync(`${root}/${name}/extraction-reviewed-pipeline.json`,JSON.stringify(draft,null,2));
 groups[name]={labelFound:item.fields.label.value!==null,strengthFound:item.fields.strength.value!==null,issues:item.issues};
}
console.log(JSON.stringify({providerCalls:0,scope:'cached_transcript_extraction',groups,fieldAccuracy:null,pilotReady:false},null,2));
