import {draftFromText} from '../src/media-extraction.mjs';
import {cases} from '../acceptance-media/synthetic-regression.mjs';
export function runSyntheticRegression(){
 const groups={};let assertions=0,failures=0;
 for(const c of cases){const fields=JSON.parse(draftFromText(c.text,c.kind)).items[0].fields;
  const group=groups[c.layout]??={cases:0,assertions:0,failures:0};group.cases++;
  for(const [key,expected] of Object.entries(c.known)){assertions++;group.assertions++;if(JSON.stringify(fields[key].value)!==JSON.stringify(expected)){failures++;group.failures++;}}
 }
 return {kind:'synthetic_transcript_regression',cases:cases.length,assertions,failures,groups,providerCalls:0,ocrAccuracy:null,speechAccuracy:null,pilotReady:false};
}
const report=runSyntheticRegression();console.log(JSON.stringify(report));if(report.failures)process.exitCode=1;
