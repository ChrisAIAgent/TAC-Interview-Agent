import type { Resume } from '../shared/resume';

/** Apply character limits without splitting surrogate pairs. */
export function truncate(text: string, limit: number): string {
  return Array.from(text).slice(0, Math.max(0, limit)).join('');
}

/** A deterministic, local profile. Missing facts are omitted rather than invented. */
export function buildProfile(resume: Resume): string {
  const personal = resume.personal;
  const identity = [personal.yearsOfExperience === undefined ? '' : `${personal.yearsOfExperience}年经验`, personal.title ?? ''].filter(Boolean).join(' ');
  const current = resume.experiences[0];
  const lines: string[] = [];
  if (identity || current) lines.push(`身份：${[identity, current ? `当前 ${current.company} ${current.role}` : ''].filter(Boolean).join('，')}`);
  if (personal.skills.length) lines.push(`核心栈：${personal.skills.slice(0, 5).join('、')}`);
  const projects = [...resume.projects].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')).slice(0, 3);
  if (projects.length) {
    lines.push('代表项目：');
    projects.forEach((project, index) => lines.push(`${index + 1}. ${[project.name, project.role, project.result || project.highlights[0]].filter(Boolean).join('｜')}`));
  }
  const motivations = resume.customSections.filter((section) => /动因|期望/u.test(section.title)).flatMap((section) => section.items).filter(Boolean);
  if (motivations.length) lines.push(`职业动因：${motivations.join('；')}`);
  return truncate(lines.join('\n'), 800);
}
