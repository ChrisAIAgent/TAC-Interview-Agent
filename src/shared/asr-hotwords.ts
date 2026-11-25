/** Public, general-purpose defaults; never derive hotwords from private resume data. */
export const DEFAULT_ASR_HOTWORDS = ['面试','社媒','营销','展会','直播','品牌','RAG','Kubernetes','QPS','灰度','微服务','分布式'];

export function isValidAsrHotword(entry: string): boolean {
  const [word, weight, ...extra] = entry.split('|');
  return extra.length === 0 && !!word && Array.from(word).length <= 30 && (word.match(/\p{Script=Han}/gu)?.length ?? 0) <= 10 && /^[\p{L}\p{N}_.-]+$/u.test(word) && (weight === undefined || /^(?:[1-9]|10|11|100)$/.test(weight));
}

export function formatAsrHotword(entry: string): string {
  if (!isValidAsrHotword(entry)) throw new Error('识别热词格式无效。');
  return entry.includes('|') ? entry : `${entry}|10`;
}

export function parseAsrHotwords(value: string): string[] {
  const words = [...new Set(value.split(/[,，\n]/u).map(word => word.trim()).filter(Boolean))];
  if (words.length > 128 || words.some(word => !isValidAsrHotword(word))) throw new Error('热词最多128个，每个最多30个字符、10个汉字；权重可填1至11或100。');
  const names=words.map(entry=>entry.split('|')[0].toLocaleLowerCase());
  if(new Set(names).size!==names.length)throw new Error('同一个热词请只保留一次。');
  return words;
}
