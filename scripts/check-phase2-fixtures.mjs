import { readFile } from 'node:fs/promises';
import { assessCommand, assessDraft } from '../src/draft-contract.mjs';

// Synthetic annotations only; not a speech/OCR benchmark or a live AI call.
const corpus=JSON.parse(await readFile(new URL('../tests/fixtures/phase2-thai.json',import.meta.url),'utf8'));
let passed=0;
for(const example of corpus.cases){
  const actual=example.kind==='command'?assessCommand(example.input,example.context):assessDraft(example.input);
  const matches=Object.entries(example.expected).every(([key,value])=>JSON.stringify(actual[key])===JSON.stringify(value));
  if(matches)passed++;
}
console.log(JSON.stringify({dataset:corpus.version,synthetic:true,cases:corpus.cases.length,passed,failed:corpus.cases.length-passed,
  establishes:'contract-policy-only',aiCalls:0}));
process.exitCode=passed===corpus.cases.length?0:1;
