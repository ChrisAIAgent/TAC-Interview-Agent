// Run without network: node scripts/evaluate-knowledge-retrieval.mjs
// Compare another retriever: node scripts/evaluate-knowledge-retrieval.mjs path/to/results.json
// Results format: { "case-id": ["knowledge-entry-id", ...], ... }.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const guide=JSON.parse(fs.readFileSync(path.join(project,'src/renderer/src/session/social-guide.json'),'utf8'))
const cases=JSON.parse(fs.readFileSync(path.join(project,'tests/fixtures/knowledge-retrieval-eval.json'),'utf8'))
const ids=new Set(guide.map(entry=>entry.id))
const uniqueCases=new Set()
for(const item of cases){
  if(!item.id||uniqueCases.has(item.id)||!item.question||!Array.isArray(item.expectedGroups))throw new Error(`Invalid case ${item.id}`)
  uniqueCases.add(item.id)
  for(const group of item.expectedGroups){
    if(!group.length||group.some(id=>!ids.has(id)))throw new Error(`Invalid relevance label in ${item.id}`)
  }
}
let predictions
if(process.argv[2]) {
  predictions=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
  for(const item of cases){
    if(!Array.isArray(predictions[item.id])||predictions[item.id].some(id=>!ids.has(id)))throw new Error(`Missing or invalid prediction for ${item.id}`)
  }
} else {
  const source=fs.readFileSync(path.join(project,'src/renderer/src/session/knowledge.ts'),'utf8')
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  const mod={exports:{}}
  new Function('exports','require','module',js)(mod.exports,request=>{if(request==='./social-guide.json')return guide;throw new Error('Unexpected dependency: '+request)},mod)
  predictions=Object.fromEntries(cases.map(item=>[item.id,mod.exports.findKnowledgeMatches(item.question,guide).map(entry=>entry.id)]))
}
let relevant=0,covered=0,groups=0,groupsHit=0,unrelated=0,rejected=0
for(const item of cases){
  const got=predictions[item.id].slice(0,3)
  if(item.expectedGroups.length){
    relevant++
    let hit=0
    for(const group of item.expectedGroups)if(group.some(id=>got.includes(id)))hit++
    groups+=item.expectedGroups.length;groupsHit+=hit
    if(hit===item.expectedGroups.length)covered++
    else console.log(`MISS ${item.id}: ${item.question}\n  actual: ${got.join(', ')||'(none)'}\n  expected: ${item.expectedGroups.map(group=>group.join(' OR ')).join(' AND ')}`)
  } else {
    unrelated++
    if(!got.length)rejected++
    else console.log(`FALSE MATCH ${item.id}: ${item.question}\n  actual: ${got.join(', ')}`)
  }
}
console.log(`Relevant questions with all required topics in top 3: ${covered}/${relevant}`)
console.log(`Required topics found in top 3: ${groupsHit}/${groups}`)
console.log(`Unrelated questions correctly left unmatched: ${rejected}/${unrelated}`)
