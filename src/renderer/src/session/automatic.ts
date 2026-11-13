import { selectPublicSearchTopic, type PublicSearchTopic } from '../../../shared/public-search'
import { findQuestionBankMatches, type QuestionBankEntry } from './question-bank'
import type { Resume } from '../shared/resume'

type Kind='personal'|'math'|'general'|'external'
interface Classification {isQuestion:boolean;kind:Kind;question:string}
interface Sources {summary:string;sources:{title:string;url:string}[]}
type Outcome={type:'ignored'|'stale';message:string}|{type:'ready';question:string;kind:Kind;bank:QuestionBankEntry[];webReference?:string;webUnavailable:boolean;sources:Sources['sources'];message:string}
export async function resolveAutomaticTurn(input:{utterance:string;context:string;resume:Resume;bank:QuestionBankEntry[];webEnabled:()=>boolean}, deps:{classify:(utterance:string,context:string)=>Promise<Classification>;search:(topic:PublicSearchTopic)=>Promise<Sources>;isCurrent:()=>boolean;status:(value:string)=>void}):Promise<Outcome> {
  deps.status('正在判断是否为问题…')
  const result=await deps.classify(input.utterance,input.context)
  if(!deps.isCurrent())return {type:'stale',message:''}
  if(!result.isQuestion)return {type:'ignored',message:'正在聆听'}
  const bank=result.kind==='math'?[]:findQuestionBankMatches(result.question,input.bank)
  let webReference:string|undefined,webUnavailable=false,message='';let sources:Sources['sources']=[]
  if(result.kind==='external') {
    const resume=input.resume
    const terms=[resume.personal.fullName,resume.personal.phone,resume.personal.email,resume.personal.location,...resume.experiences.map(item=>item.company),...resume.projects.map(item=>item.name),...resume.education.map(item=>item.school)].filter((value):value is string=>Boolean(value))
    const topic=selectPublicSearchTopic(input.utterance,terms),rewritten=selectPublicSearchTopic(result.question,terms)
    if(input.webEnabled() && topic && topic===rewritten) {
      deps.status('正在检索公开资料…')
      try {const found=await deps.search(topic);if(!deps.isCurrent())return {type:'stale',message:''};sources=found.sources;webReference=`${found.summary}\n来源：\n${sources.map(source=>`${source.title} ${source.url}`).join('\n')}`}
      catch {if(!deps.isCurrent())return {type:'stale',message:''};webUnavailable=true;message='联网检索不可用，回答将注明未核验'}
    } else {webUnavailable=true;message=input.webEnabled()?'问题含个人信息或超出安全搜索范围，已跳过联网':'联网搜索未开启，回答将注明未核验'}
  }
  return {type:'ready',question:result.question,kind:result.kind,bank,webReference,webUnavailable,sources,message:message||(bank.length?'已匹配问题库，正在生成回答':'已识别问题，正在生成回答')}
}
