import type { Resume, ResumeExperience } from '../shared/resume';
import { truncate } from './profile';

export interface ResumeMaterial { ref: string; text: string; score: number; source: string }

function bigrams(value: string): Set<string> {
  const chars = Array.from(value.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, ''));
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]));
}

/** Fraction of question bigrams present in a candidate fragment. */
function overlap(question: Set<string>, fragment: string): number {
  if (!question.size) return 0;
  const candidate = bigrams(fragment);
  let matched = 0;
  for (const gram of question) if (candidate.has(gram)) matched += 1;
  return matched / question.size;
}

/** Normalize familiar interview wording while keeping concrete entities intact. */
function normalizePrepared(text:string):string {
  return text.toLowerCase().replace(/^(?:\s*\d+[.、．]\s*)/u,'').replace(/智能体/g,'agent').replace(/审核智能题/g,'审核agent')
    .replace(/(?:浙美|社美|涉媒)(?=审核agent)/g,'社媒')
    .replace(/社交媒体|社交平台/g,'社媒').replace(/社媒效果|社媒表现|社媒成效/g,'社媒指标').replace(/品牌声量|品牌宣传|品牌知名度/g,'品牌曝光')
    .replace(/获客线索|销售线索|商机获取|获客/g,'商机').replace(/营销资产库|市场物料库|品牌素材库|营销物料库|marketing\s*library/g,'营销资料库')
    .replace(/campaign/g,'活动').replace(/转化不达预期|效果不好|效果差/g,'效果不达预期')
    .replace(/复盘/g,'分析').replace(/离开目前的岗位|离开现在的岗位/g,'离职')
    .replace(/不足|短板|弱点/g,'提升').replace(/[\p{P}\p{S}\s\d]/gu,'');
}

/** Match one prepared question to its adjacent answer, preferring no match to an unsafe guess. */
export function selectPreparedAnswer(resume:Resume, question:string): {ref:string;question:string;answer:string}|null {
  const normalized=normalizePrepared(question);
  const query=bigrams(normalized);
  if(query.size<4) return null;
  if(/自我介绍|介绍(?:一下|下|一下你|下你|一下您|下您)?(?:自己|你自己|您自己)|说说(?:你|您)自己/u.test(question) && !/英语|英文|english/i.test(question)) {
    const section=resume.customSections.find(item=>item.title.trim()==='中文自我介绍');
    const answer=section?.items.map(item=>item.trim()).filter(Boolean).join('\n');
    if(section && answer) return {ref:`custom:${section.id}:0`,question:'中文自我介绍',answer:truncate(answer,1000)};
  }
  const matches: {ref:string;question:string;answer:string;score:number}[]=[];
  for(const section of resume.customSections) {
    for(let index=0;index<section.items.length-1;index++) {
      const title=section.items[index].trim(), answer=section.items[index+1].trim();
      if(!/^\d+[.、．]\s*/u.test(title) || title.length>150 || !answer || /^\d+[.、．]\s*/u.test(answer)) continue;
      const candidate=normalizePrepared(title);
      const titleScore=overlap(query,candidate);
      const reverseScore=overlap(bigrams(candidate),normalized);
      const answerScore=overlap(query,normalizePrepared(answer));
      const shared=(term:RegExp):boolean=>term.test(normalized) && (term.test(candidate) || term.test(normalizePrepared(answer)));
      const anchored=shared(/facebook/i) || shared(/世界泳联|worldaquatics/i);
      const matchingWorkflow=/工作流/u.test(normalized) && /工作流/u.test(candidate) && shared(/facebook/i);
      const matchingMetrics=normalized.includes('社媒指标') && candidate.includes('社媒指标');
      const score=Math.max(titleScore*0.8+reverseScore*0.2, anchored && titleScore>=0.12 ? answerScore*0.65+titleScore*0.35 : 0, matchingWorkflow || matchingMetrics ? 0.5 : 0);
      const weakness=/不足|短板|弱点|提升/u;
      const sameWeakness=weakness.test(question) && weakness.test(title);
      const audit=/审核[^。！？?]{0,12}agent/iu;
      const sameAudit=audit.test(normalized) && audit.test(candidate);
      const differentProjects=/(云栖|米兰)/u.test(question) && /(云栖|米兰)/u.test(title) && ![...question.matchAll(/云栖|米兰/gu)].some(match=>title.includes(match[0]));
      const differentIntent=/区别|差别|差异/u.test(question) && !/区别|差别|差异|区分/u.test(title);
      // Generic wording such as “cross-department example” is not enough to
      // attach a prepared story to a different project or event.
      if(!differentProjects && !differentIntent && (score>=0.45 || (titleScore>=0.35 && (sameWeakness || sameAudit)) || (anchored && score>=0.32))) matches.push({ref:`custom:${section.id}:${index}`,question:title,answer:truncate(answer,600),score});
    }
  }
  matches.sort((a,b)=>b.score-a.score);
  return matches[0]??null;
}

function recentFirst(a: ResumeExperience, b: ResumeExperience): number {
  return (b.endDate || '9999-99').localeCompare(a.endDate || '9999-99') || (b.startDate || '').localeCompare(a.startDate || '');
}

/** Select at most two traceable snippets so a single answer does not turn into a resume recap. */
export function selectMaterials(resume: Resume, question: string): ResumeMaterial[] {
  const keywords = bigrams(question);
  const candidates: ResumeMaterial[] = [];
  resume.experiences.forEach((experience) => experience.highlights.forEach((text, index) => {
    if (text.trim()) candidates.push({ ref: `experience:${experience.id}:highlight:${index}`, text, score: overlap(keywords, text), source: `工作经历：${experience.company} / ${experience.role}` });
  }));
  resume.projects.forEach((project) => {
    const add = (field: string, text: string | undefined): void => {
    if (text?.trim()) candidates.push({ ref: `project:${project.id}:${field}`, text, score: overlap(keywords, text), source: `项目经历：${project.name}` });
    };
    add('result', project.result);
    add('contribution', project.contribution);
    project.highlights.forEach((text, index) => add(`highlight:${index}`, text));
  });
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.length && candidates[0].score >= 0.1
    ? candidates.slice(0, 2)
    : [...resume.experiences].sort(recentFirst).slice(0, 2).flatMap((experience) => experience.highlights.slice(0, 1).map((text, index) => ({ ref: `experience:${experience.id}:highlight:${index}`, text, score: overlap(keywords, text), source: `工作经历：${experience.company} / ${experience.role}` }))).filter((item) => item.text.trim());
  let budget = 360;
  return chosen.flatMap((item) => {
    const text = truncate(item.text, Math.min(180, budget));
    budget -= Array.from(text).length;
    return text ? [{ ...item, text }] : [];
  });
}
