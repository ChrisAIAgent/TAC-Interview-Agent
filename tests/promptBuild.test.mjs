import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

// Execute TypeScript modules in memory, without producing build artifacts or making requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/src/prompt');
const cache = new Map();
function load(name) {
  const filename = path.resolve(root, `${name}.ts`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const source = fs.readFileSync(filename, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  cache.set(filename, module);
  const localRequire = (request) => {
    if (!request.startsWith('./')) throw new Error(`Unexpected runtime dependency: ${request}`);
    return load(request.slice(2));
  };
  new Function('exports', 'require', 'module', js)(module.exports, localRequire, module);
  return module.exports;
}
const { buildProfile } = load('profile');
const { selectMaterials } = load('select');
const { buildPrompt } = load('build');
const resume = {
  id: 'r', title: '后端', updatedAt: '2026-01-01',
  personal: { fullName: '李', title: '工程师', yearsOfExperience: 4, skills: ['Go', 'SQL', 'Redis', 'Linux', 'Kafka', 'Docker'] },
  experiences: [
    { id: 'old', company: '旧公司', role: '工程师', startDate: '2020-01', endDate: '2022-01', highlights: ['维护旧系统', '支持客户'] },
    { id: 'new', company: '新公司', role: '工程师', startDate: '2023-01', highlights: ['设计支付系统减少延迟', '服务稳定性提升'] },
  ],
  projects: [{ id: 'pay', name: '支付系统', startDate: '2025-01', role: '负责人', result: '支付系统延迟下降', highlights: [], contribution: '设计支付系统架构' }],
  education: [], customSections: [{ id: 'goals', title: '职业期望', items: ['持续成长'] }],
};

test('profile is bounded and selects skills, recent projects and motivation', () => {
  const profile = buildProfile(resume);
  assert.match(profile, /Go、SQL、Redis、Linux、Kafka/);
  assert.doesNotMatch(profile, /Docker/);
  assert.match(profile, /支付系统/);
  assert.match(profile, /持续成长/);
  assert.ok(Array.from(buildProfile({ ...resume, personal: { ...resume.personal, title: '😀'.repeat(900) } })).length <= 800);
});
test('selects overlapping fragments and traces them to the source', () => {
  const materials = selectMaterials(resume, '请讲讲支付系统架构');
  assert.equal(materials[0].ref, 'project:pay:contribution');
  assert.ok(materials.length <= 4);
  assert.ok(materials.every((item) => Array.from(item.text).length <= 120));
  assert.ok(materials.reduce((sum, item) => sum + Array.from(item.text).length, 0) <= 600);
});
test('uses the two most recent jobs as fallback and preserves the limits', () => {
  const input = { ...resume, experiences: resume.experiences.map((e) => ({ ...e, highlights: e.highlights.map((s) => s.repeat(100)) })) };
  const materials = selectMaterials(input, '完全无关的问题');
  assert.deepEqual(materials.map((m) => m.ref), ['experience:new:highlight:0','experience:new:highlight:1','experience:old:highlight:0','experience:old:highlight:1']);
  assert.ok(materials.every((m) => Array.from(m.text).length <= 120));
});
test('prompt uses only last three turns, model settings and source refs', () => {
  const history = [1,2,3,4].map((n) => ({ question: `question-${n}`, answer: `answer-${n}` }));
  const result = buildPrompt(resume, { id: 'c', title: '精简', body: '用三句话' }, '请讲讲支付系统架构', history);
  assert.match(result.system, /不要编造/);
  assert.match(result.system, /用三句话/);
  assert.doesNotMatch(result.messages[0].content, /question-1/);
  assert.match(result.messages[0].content, /question-4/);
  assert.ok(result.resumeRefs.includes('project:pay:contribution'));
  assert.deepEqual([result.temperature,result.maxTokens,result.topP,result.stream], [0.4,400,0.9,true]);
});
