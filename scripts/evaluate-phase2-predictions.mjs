import {evaluateMediaPredictions} from '../src/media-evaluation.mjs';
try{let input='';let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>1_048_576)throw Error();input+=chunk;}
  console.log(JSON.stringify(evaluateMediaPredictions(JSON.parse(input))));
}catch{console.log('{"error":"INVALID_OR_OVERSIZED_EVALUATION"}');process.exitCode=1;}
