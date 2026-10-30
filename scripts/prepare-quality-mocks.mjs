import {mkdirSync,writeFileSync} from 'node:fs';
import assets from '../acceptance-media/mock-assets.mjs';
const folder='acceptance-media/private/mocks';mkdirSync(folder,{recursive:true});
for(const a of assets){writeFileSync(`${folder}/${a.file}`,Buffer.from(a.base64,'base64'));writeFileSync(`${folder}/${a.file}.txt`,a.reference);}
writeFileSync(`${folder}/manifest.json`,JSON.stringify({synthetic:true,humanReviewed:false,pilotReady:false,cases:assets.map(({base64,...a})=>a)},null,2));
console.log(JSON.stringify({folder,images:3,speechSamples:0,negativeAudioSamples:1,pilotReady:false}));
