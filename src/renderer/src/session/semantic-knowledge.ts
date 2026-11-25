import { findKnowledgeMatches, type KnowledgeEntry } from './knowledge'

export interface SemanticKnowledgeRequest {
  question:string
  entries:{id:string;text:string}[]
  consent:boolean
}
export type KnowledgeSelection =
  | {mode:'embedding'|'llm'|'keyword';entries:KnowledgeEntry[]}
  | {mode:'empty';entries:[]}
  | {mode:'stale';entries:[]}

const platforms=[/linkedin|领英/iu,/youtube|油管/iu,/facebook|脸书/iu,/instagram|照片墙/iu,/threads/iu,/tiktok|海外抖音/iu,/reddit|红迪/iu,/discord/iu,/(?:^|[^a-z0-9])x(?:[^a-z0-9]|$)|twitter|推特/iu]

/** Interpret one observed ASR error only when the surrounding topic identifies a platform.
 * Keep the raw transcript separately for display; this is only a query/prompt interpretation.
 */
export function interpretKnowledgeQuestion(question:string):string {
  if(!question.includes('令英'))return question
  if(/(?:名字(?:是|叫)?|名叫|叫|同事|同学|朋友|老师|先生|女士|小姐|经理|负责人|我和|我跟|与|给|找|请|让|由)\s*令英|令英(?:的|本人|负责|说|认为|告诉|分享|回答|经历|来自|加入|参加|做过)/u.test(question))return question
  const socialContext=/(?:linkedin|领英|社媒|社交媒体|社交平台|海外社交)/iu.test(question)
  const platformComparison=/(?:油管|youtube)/iu.test(question)&&/(?:发|发布|运营|内容|账号|渠道|帖子|视频|营销)/u.test(question)
  if(!socialContext&&!platformComparison)return question
  return question.replace(/令英\s*河\s*(?=油管|youtube)/giu,'领英和').replace(/令英/gu,'领英')
}

/** Keep both sides of an explicitly named platform comparison visible. */
function coverPlatforms(question:string,semantic:KnowledgeEntry[],snapshot:readonly KnowledgeEntry[]):KnowledgeEntry[] {
  const named=platforms.filter(pattern=>pattern.test(question))
  if(named.length<2 || !semantic.length)return semantic
  const keyword=findKnowledgeMatches(question,snapshot)
  const selected:KnowledgeEntry[]=[]
  for(const platform of named) {
    const matching=(entry:KnowledgeEntry):boolean=>entry.kind==='guidance'&&platform.test(`${entry.title} ${entry.tags.join(' ')}`)
    const entry=semantic.find(matching)??keyword.find(matching)
    if(entry&&!selected.includes(entry))selected.push(entry)
    if(selected.length===3)break
  }
  for(const entry of semantic){if(selected.length===3)break;if(!selected.includes(entry))selected.push(entry)}
  return selected
}

/** Keep retrieval tied to both the current question and current library contents. */
export async function selectKnowledge(
  question:string,
  consent:boolean,
  deps:{
    entries:()=>readonly KnowledgeEntry[]
    isCurrent:()=>boolean
    search:(request:SemanticKnowledgeRequest)=>Promise<{matches:{id:string;score:number}[];method:'embedding'|'llm'}>
  },
):Promise<KnowledgeSelection> {
  for(let attempt=0;attempt<2;attempt++) {
    if(!deps.isCurrent()) return {mode:'stale',entries:[]}
    const snapshot=deps.entries()
    if(!snapshot.length) return {mode:'empty',entries:[]}
    try {
      const result=await deps.search({question,consent,entries:snapshot.map(entry=>({
        id:entry.id,text:[entry.title.slice(0,200),entry.tags.join('、').slice(0,500),entry.content.slice(0,650)].filter(Boolean).join('\n'),
      }))})
      if(!deps.isCurrent()) return {mode:'stale',entries:[]}
      if(snapshot!==deps.entries()) continue
      if(result.method!=='embedding'&&result.method!=='llm')throw new Error('Invalid semantic search method')
      const byId=new Map(snapshot.map(entry=>[entry.id,entry]))
      const seen=new Set<string>()
      const entries=result.matches.flatMap(match=>{
        if(!Number.isFinite(match.score)||seen.has(match.id))return []
        const entry=byId.get(match.id);if(!entry)return []
        seen.add(match.id);return [entry]
      }).slice(0,3)
      return {mode:result.method,entries:coverPlatforms(question,entries,snapshot)}
    } catch {
      if(!deps.isCurrent()) return {mode:'stale',entries:[]}
      if(snapshot!==deps.entries()) continue
      return {mode:'keyword',entries:findKnowledgeMatches(question,snapshot)}
    }
  }
  if(!deps.isCurrent()) return {mode:'stale',entries:[]}
  return {mode:'keyword',entries:findKnowledgeMatches(question,deps.entries())}
}
