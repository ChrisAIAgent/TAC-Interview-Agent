import type { Resume, ResumeExperience } from '../shared/resume';
import { truncate } from './profile';

export interface ResumeMaterial { ref: string; text: string; score: number }

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

function recentFirst(a: ResumeExperience, b: ResumeExperience): number {
  return (b.endDate || '9999-99').localeCompare(a.endDate || '9999-99') || (b.startDate || '').localeCompare(a.startDate || '');
}

/** Select at most four traceable snippets, with a total text budget of 600 characters. */
export function selectMaterials(resume: Resume, question: string): ResumeMaterial[] {
  const keywords = bigrams(question);
  const candidates: ResumeMaterial[] = [];
  resume.experiences.forEach((experience) => experience.highlights.forEach((text, index) => {
    if (text.trim()) candidates.push({ ref: `experience:${experience.id}:highlight:${index}`, text, score: overlap(keywords, text) });
  }));
  resume.projects.forEach((project) => {
    const add = (field: string, text: string | undefined): void => {
      if (text?.trim()) candidates.push({ ref: `project:${project.id}:${field}`, text, score: overlap(keywords, text) });
    };
    add('result', project.result);
    add('contribution', project.contribution);
    project.highlights.forEach((text, index) => add(`highlight:${index}`, text));
  });
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.length && candidates[0].score >= 0.1
    ? candidates.slice(0, 4)
    : [...resume.experiences].sort(recentFirst).slice(0, 2).flatMap((experience) => experience.highlights.slice(0, 2).map((text, index) => ({ ref: `experience:${experience.id}:highlight:${index}`, text, score: overlap(keywords, text) }))).filter((item) => item.text.trim());
  let budget = 600;
  return chosen.flatMap((item) => {
    const text = truncate(item.text, Math.min(120, budget));
    budget -= Array.from(text).length;
    return text ? [{ ...item, text }] : [];
  });
}
