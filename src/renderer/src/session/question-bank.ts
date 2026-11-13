export interface QuestionBankEntry { id:string; question:string; answer:string }
export const QUESTION_BANK_KEY='tac-interview-question-bank-v1';

export function loadQuestionBank():QuestionBankEntry[] {
  try {
    const value:unknown=JSON.parse(localStorage.getItem(QUESTION_BANK_KEY)||'[]');
    if(!Array.isArray(value)) return [];
    return value.filter((row):row is QuestionBankEntry=>Boolean(row && typeof row.id==='string' && typeof row.question==='string' && typeof row.answer==='string' && row.question.length<=1000 && row.answer.length<=4000)).slice(0,200);
  } catch { return []; }
}
function grams(text:string):Set<string> {
  const chars=Array.from(text.toLowerCase().replace(/[\p{P}\p{S}\s]/gu,''));
  return new Set(chars.length<2?chars:chars.slice(0,-1).map((value,index)=>value+chars[index+1]));
}
export function findQuestionBankMatches(question:string, entries:readonly QuestionBankEntry[]):QuestionBankEntry[] {
  const query=grams(question); if(!query.size) return [];
  return entries.map(entry=>{const candidate=grams(entry.question);let overlap=0;for(const gram of query)if(candidate.has(gram))overlap++;return {entry,score:overlap/Math.max(query.size,candidate.size,1)};})
    .filter(item=>item.score>=0.25).sort((a,b)=>b.score-a.score).slice(0,3).map(item=>item.entry);
}
