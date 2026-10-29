import { DRAFT_FIELDS, SOURCE_KINDS, INTENTS } from './draft-contract.mjs';
const string = max => ({type:'string',minLength:1,maxLength:max,pattern:'^(?!.*[\\u0000-\\u001f\\u007f])\\S(?:[\\s\\S]*\\S)?$'});
const object = properties => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const field = schema => ({oneOf:[object({value:{type:'null'},evidence:{type:'null'}}),object({value:schema,evidence:string(500)})]});
const time = {type:'string',pattern:'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'};
const date = {type:'string',format:'date',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'};
const fields = Object.fromEntries(DRAFT_FIELDS.map(key=>[key,field(
  key==='times'?{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:time}:
  key==='weekdays'?{type:'array',minItems:1,maxItems:7,uniqueItems:true,items:{type:'integer',minimum:0,maximum:6}}:
  ['startDate','endDate'].includes(key)?date:key==='useMode'?{enum:['scheduled','as_needed']}:string(key==='instructions'?500:120)
)]));
export const draftJsonSchema = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  title:'Nong Oon untrusted extraction draft v1',
  description:'Shape contract only. Runtime calendar, date ordering, PRN and pill-photo checks remain required. Never authorizes a write.',
  ...object({schemaVersion:{const:1},sourceKind:{enum:[...SOURCE_KINDS]},items:{type:'array',minItems:1,maxItems:20,
    items:object({fields:object(fields),issues:{type:'array',maxItems:8,uniqueItems:true,
      items:{enum:['unreadable','ambiguous','conflicting','possible_duplicate','unsupported_regimen']}}})}}),
};
export const commandJsonSchema = {$schema:draftJsonSchema.$schema,title:'Nong Oon untrusted command v1',
  ...object({schemaVersion:{const:1},intent:{enum:[...INTENTS]},targetLabel:{oneOf:[{type:'null'},string(120)]},ambiguous:{type:'boolean'}})};
