/** Structured resume data used by the local prompt builder. */
export interface Resume {
  id: string;
  title: string;
  updatedAt: string;
  personal: ResumePersonal;
  experiences: ResumeExperience[];
  projects: ResumeProject[];
  education: ResumeEducation[];
  customSections: ResumeCustomSection[];
  rawText?: string;
}
export interface ResumePersonal {
  fullName: string;
  title?: string;
  yearsOfExperience?: number;
  phone?: string;
  email?: string;
  location?: string;
  links?: { label: string; url: string }[];
  summary?: string;
  skills: string[];
}
export interface ResumeExperience {
  id: string;
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  description?: string;
  highlights: string[];
  techStack?: string[];
}
export interface ResumeProject {
  id: string;
  name: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  background?: string;
  contribution?: string;
  result?: string;
  highlights: string[];
  techStack?: string[];
}
export interface ResumeEducation {
  id: string;
  school: string;
  major?: string;
  degree?: '专科' | '本科' | '硕士' | '博士' | '其他';
  startDate?: string;
  endDate?: string;
  highlights?: string[];
}
export interface ResumeCustomSection { id: string; title: string; items: string[] }
export interface AnswerInstruction { id: string; title: string; body: string; isDefault?: boolean; builtin?: boolean }
