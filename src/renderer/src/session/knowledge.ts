import socialGuide from './social-guide.json'

export interface KnowledgeSource { title:string; url:string }
export interface KnowledgeEntry {
  id:string
  title:string
  content:string
  tags:string[]
  sources:KnowledgeSource[]
  verifiedAt:string
  kind:'guidance'|'case'|'experience'
  document:string
}
export const KNOWLEDGE_KEY='tac-knowledge-v1'
const IMPORT_KEY='tac-social-guide-imported-v1'

/** Seed is imported once; subsequent edits and deletions are kept. */
export function loadKnowledge():KnowledgeEntry[] {
  try {
    const saved:unknown=JSON.parse(localStorage.getItem(KNOWLEDGE_KEY)||'[]')
    const entries=Array.isArray(saved)?saved.filter(isKnowledgeEntry):[]
    if(localStorage.getItem(IMPORT_KEY))return entries
    const ids=new Set(entries.map(entry=>entry.id))
    const merged=[...entries,...(socialGuide as KnowledgeEntry[]).filter(entry=>isKnowledgeEntry(entry)&&!ids.has(entry.id))]
    localStorage.setItem(KNOWLEDGE_KEY,JSON.stringify(merged))
    localStorage.setItem(IMPORT_KEY,'1')
    return merged
  } catch { return [] }
}
function isKnowledgeEntry(value:unknown):value is KnowledgeEntry {
  if(!value||typeof value!=='object')return false
  const row=value as Partial<KnowledgeEntry>
  return typeof row.id==='string'&&typeof row.title==='string'&&typeof row.content==='string'&&Array.isArray(row.tags)&&row.tags.every(tag=>typeof tag==='string')&&Array.isArray(row.sources)&&row.sources.every(source=>source&&typeof source.title==='string'&&typeof source.url==='string')&&typeof row.verifiedAt==='string'&&typeof row.document==='string'&&['guidance','case','experience'].includes(String(row.kind))
}

type Concept={name:string;pattern:RegExp;entity?:boolean}
const concepts:Concept[]=[
  {name:'x',pattern:/(?:^|[^a-z0-9])x(?:[^a-z0-9]|$)|twitter|推特/iu,entity:true},
  {name:'linkedin',pattern:/linkedin|领英/iu,entity:true},
  {name:'facebook',pattern:/facebook|脸书/iu,entity:true},
  {name:'instagram',pattern:/instagram|照片墙/iu,entity:true},
  {name:'threads',pattern:/threads/iu,entity:true},
  {name:'youtube',pattern:/youtube|油管/iu,entity:true},
  {name:'tiktok',pattern:/tiktok|海外抖音/iu,entity:true},
  {name:'reddit',pattern:/reddit|红迪/iu,entity:true},
  {name:'discord',pattern:/discord/iu,entity:true},
  {name:'meta',pattern:/(?:^|[^a-z])meta(?:[^a-z]|$)/iu,entity:true},
  {name:'kimi',pattern:/kimi|moonshot|月之暗面/iu,entity:true},
  {name:'claude',pattern:/claude|anthropic/iu,entity:true},
  {name:'openai',pattern:/openai/iu,entity:true},
  {name:'社媒',pattern:/社媒|社交媒体|社交平台|social\s*media/iu},
  {name:'社区',pattern:/社区|社群|群组|community|用户互助/iu},
  {name:'开源',pattern:/开源|github|生态合作|开发者生态/iu},
  {name:'合作',pattern:/赞助|合作|伙伴|共创|创作者|kol|影响者/iu},
  {name:'指标',pattern:/衡量|指标|评估|效果|复盘|数据|kpi|roi|成效|表现/iu},
  {name:'曝光',pattern:/曝光|声量|知名度|触达|传播|品牌/iu},
  {name:'线索',pattern:/线索|商机|获客|销售|转化|客户咨询/iu},
  {name:'活动',pattern:/活动|展会|工作坊|直播|线上线下|webinar|ama/iu},
  {name:'内容',pattern:/内容|教程|视频|演示|案例|工作流/iu},
  {name:'平台',pattern:/平台|渠道|跨平台|各平台|不同平台/iu},
  {name:'运营',pattern:/运营|运作|推广|开展|怎么做|如何做|打法|策略/iu},
]
function normalize(value:string):string {
  return value.toLowerCase().replace(/社交媒体|社交平台/gu,'社媒').replace(/获客线索|销售线索|商机获取|获客/gu,'线索').replace(/品牌声量|品牌知名度/gu,'品牌曝光').replace(/社区运营|社群运营/gu,'社区运营').replace(/领英/gu,'linkedin').replace(/脸书/gu,'facebook').replace(/油管/gu,'youtube').replace(/推特|twitter/gu,'x').replace(/红迪/gu,'reddit').replace(/[\p{P}\p{S}\s]/gu,'')
}
function grams(value:string):Set<string> {
  const chars=Array.from(normalize(value));return new Set(chars.slice(0,-1).map((char,index)=>char+chars[index+1]))
}
function overlap(query:Set<string>,text:string):number {
  if(!query.size)return 0
  const target=grams(text);let hits=0;for(const gram of query)if(target.has(gram))hits++
  return hits/query.size
}

/** Bounded local topic retrieval; it is not a claim of general semantic search. */
export function findKnowledgeMatches(question:string,entries:readonly KnowledgeEntry[]):KnowledgeEntry[] {
  const q=question.trim();if(!q)return []
  const query=grams(q)
  const found=concepts.filter(concept=>concept.pattern.test(q))
  const entities=found.filter(concept=>concept.entity)
  const substantive=found.filter(concept=>!concept.entity&&!['运营','平台','内容'].includes(concept.name))
  const asksCase=/案例|借鉴|竞品|赞助|合作案例/iu.test(q)
  const ranked=entries.map(entry=>{
    const header=`${entry.title} ${entry.tags.join(' ')}`
    const all=`${header} ${entry.content}`
    // A question about a named platform/company must not pull an unrelated one.
    if(entities.length&&!entities.some(concept=>concept.pattern.test(all)))return {entry,score:0}
    const entityHits=entities.filter(concept=>concept.pattern.test(header)).length
    const related=substantive.filter(concept=>concept.pattern.test(all)).length
    const headerRelated=substantive.filter(concept=>concept.pattern.test(header)).length
    const direct=overlap(query,header)
    const body=overlap(query,entry.content)
    const score=(entityHits?0.48:entities.length?0.28:0)+Math.min(related*0.16,0.48)+Math.min(headerRelated*0.08,0.24)+direct*0.42+body*0.18+(!asksCase&&entry.kind==='guidance'?0.08:0)
    return {entry,score}
  }).filter(item=>item.score>=0.26).sort((a,b)=>b.score-a.score||a.entry.title.localeCompare(b.entry.title,'zh-CN'))
  // A platform comparison needs coverage of each explicitly named platform,
  // not three high-scoring records about the first one.
  const selected:KnowledgeEntry[]=[]
  if(entities.length>1){
    for(const entity of entities){
      const match=ranked.find(({entry})=>!selected.includes(entry)&&entry.kind==='guidance'&&entity.pattern.test(`${entry.title} ${entry.tags.join(' ')}`))
      if(match)selected.push(match.entry)
      if(selected.length===3)break
    }
  }
  for(const {entry} of ranked){if(selected.length===3)break;if(!selected.includes(entry))selected.push(entry)}
  return selected
}
