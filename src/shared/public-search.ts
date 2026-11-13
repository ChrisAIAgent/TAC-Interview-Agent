/** Only these constant strings may cross the search boundary. Never interpolate transcript or resume data. */
export const PUBLIC_SEARCH_QUERIES = {
  react: 'React 官方最新稳定版本及更新',
  electron: 'Electron 官方最新稳定版本及更新',
  typescript: 'TypeScript 官方最新稳定版本及更新',
  nodejs: 'Node.js 官方最新稳定版本及更新',
  python: 'Python 官方最新稳定版本及更新',
  kubernetes: 'Kubernetes 官方最新稳定版本及更新',
  docker: 'Docker 官方最新版本及更新',
  javascript: 'JavaScript ECMAScript 最新标准 官方',
  openai: 'OpenAI 官方最新公开产品信息',
} as const;
export type PublicSearchTopic = keyof typeof PUBLIC_SEARCH_QUERIES;

const patterns: ReadonlyArray<[PublicSearchTopic, RegExp]> = [
  ['react', /\breact\b/i], ['electron', /\belectron\b/i], ['typescript', /\btypescript\b/i],
  ['nodejs', /\bnode(?:\.js|js)\b/i], ['python', /\bpython\b/i], ['kubernetes', /\bkubernetes\b|\bk8s\b/i],
  ['docker', /\bdocker\b/i], ['javascript', /\bjavascript\b|\becmascript\b/i], ['openai', /\bopenai\b/i],
];

/** Fail closed on private or ambiguous questions. The output is an enum, never raw input. */
export function selectPublicSearchTopic(question: string, privateTerms: readonly string[]): PublicSearchTopic | null {
  if (!question.trim() || /我|你|您|咱|本人|简历|候选人|面试者|项目|经历|团队|公司|岗位|职业|负责|任职|担任|使用过|身份证|电话|手机号|邮箱|住址|[\w.+-]+@[\w.-]+|(?:\+?86[- ]?)?1[3-9]\d{9}/i.test(question)) return null;
  if (/数学|概率|方程|几何|数列|求和|积分|导数|排列组合|握手|数学题/i.test(question)) return null;
  if (!/(最新|当前|近期|最近|latest|current)/i.test(question) || !/(版本|更新|发布|变更|特性|产品|模型|version|release|update)/i.test(question)) return null;
  const normalized=question.toLowerCase();
  if (privateTerms.some(value => { const term=value.trim().toLowerCase(); return term.length>=2 && normalized.includes(term); })) return null;
  const matches=patterns.filter(([,pattern])=>pattern.test(question));
  return matches.length===1 ? matches[0][0] : null;
}
