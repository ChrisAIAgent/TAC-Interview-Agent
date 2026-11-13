import { app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Resume } from '../../renderer/src/shared/resume';

const file=():string=>join(app.getPath('userData'),'resume.json');
function validate(value:unknown):Resume {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('简历格式无效。');
  const row=value as Record<string,unknown>;
  if(typeof row.id!=='string' || typeof row.title!=='string' || typeof row.updatedAt!=='string' || !row.personal || typeof row.personal!=='object' ||
    !Array.isArray(row.experiences) || !Array.isArray(row.projects) || !Array.isArray(row.education) || !Array.isArray(row.customSections)) throw new Error('简历格式无效。');
  const personal=row.personal as Record<string,unknown>;
  if(typeof personal.fullName!=='string' || !Array.isArray(personal.skills) || !personal.skills.every(x=>typeof x==='string')) throw new Error('简历格式无效。');
  if(!row.experiences.every(x=>x && typeof x==='object' && typeof x.company==='string' && typeof x.role==='string' && Array.isArray(x.highlights) && x.highlights.every((v:unknown)=>typeof v==='string')) ||
     !row.projects.every(x=>x && typeof x==='object' && typeof x.name==='string' && Array.isArray(x.highlights) && x.highlights.every((v:unknown)=>typeof v==='string')) ||
     !row.education.every(x=>x && typeof x==='object' && typeof x.school==='string') ||
     !row.customSections.every(x=>x && typeof x==='object' && typeof x.title==='string' && Array.isArray(x.items) && x.items.every((v:unknown)=>typeof v==='string'))) throw new Error('简历格式无效。');
  return value as Resume;
}
export async function loadResume():Promise<Resume|null> {
  try {const text=await readFile(file(),'utf8');if(text.length>1_000_000)throw new Error('简历文件过大。');return validate(JSON.parse(text) as unknown);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('无法读取本地简历，请检查文件格式。');}
}
export async function saveResume(input:unknown):Promise<Resume> {
  const text=JSON.stringify(input);if(!text || text.length>1_000_000)throw new Error('简历内容过大。');
  const value=validate(JSON.parse(text) as unknown);await writeFile(file(),text,{encoding:'utf8',mode:0o600});return value;
}
