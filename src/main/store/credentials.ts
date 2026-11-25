import { app, safeStorage } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const keys = ['tencentAppId', 'tencentSecretId', 'tencentSecretKey', 'llmApiKey'] as const;
type CredentialKey = typeof keys[number];
const configKeys = ['llmBaseUrl', 'llmModel', 'llmPreset', 'llmProvider'] as const;
type ConfigKey = typeof configKeys[number];
export type CredentialInput = Partial<Record<CredentialKey | ConfigKey, string>>;
export type CredentialSummary = Record<CredentialKey | ConfigKey, string> & { available: boolean };
type Stored = Partial<Record<CredentialKey | ConfigKey, string>>;

async function readStored(): Promise<Stored> {
  try {
    const value: unknown = JSON.parse(await readFile(join(app.getPath('userData'), 'credentials.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid credentials file');
    return value as Stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('无法读取凭据文件，请检查本地文件。');
  }
}
function mask(value: string): string {
  return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
export async function getCredentials(): Promise<CredentialSummary> {
  const available = safeStorage.isEncryptionAvailable();
  const result: CredentialSummary = { available, tencentAppId: '', tencentSecretId: '', tencentSecretKey: '', llmApiKey: '', llmBaseUrl: '', llmModel: '', llmPreset: '', llmProvider: '' };
  const stored = await readStored();
  for (const key of configKeys) if (typeof stored[key] === 'string') result[key] = stored[key]!;
  if (!available) return result;
  for (const key of keys) {
    if (typeof stored[key] === 'string') {
      try { result[key] = mask(safeStorage.decryptString(Buffer.from(stored[key]!, 'base64'))); }
      catch { throw new Error('无法解密本地凭据，请检查当前系统账户。'); }
    }
  }
  return result;
}
export async function saveCredentials(input: unknown): Promise<CredentialSummary> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，未保存凭据。');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('凭据格式无效。');
  const stored = await readStored();
  const values = input as Record<string, unknown>;
  for (const key of keys) {
    const value = values[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length > 4096) throw new Error('凭据格式无效。');
    const normalized = key.startsWith('tencent') ? value.trim() : value;
    if (!normalized) continue;
    stored[key] = safeStorage.encryptString(normalized).toString('base64');
  }
  for (const key of configKeys) {
    const value = values[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > 4096) throw new Error('配置格式无效。');
    stored[key] = value;
  }
  await writeFile(join(app.getPath('userData'), 'credentials.json'), JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  return getCredentials();
}

/** Main-process only. Never expose these values over IPC or log them. */
export async function getTencentCredentials(): Promise<{appId:string;secretId:string;secretKey:string}> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用。');
  const stored=await readStored();
  const decrypt=(key:CredentialKey):string=>{
    const value=stored[key];
    if(typeof value!=='string' || !value) throw new Error('请先保存腾讯云语音识别凭证。');
    try{return safeStorage.decryptString(Buffer.from(value,'base64')).trim();}
    catch{throw new Error('无法读取腾讯云语音识别凭证。');}
  };
  return {appId:decrypt('tencentAppId'),secretId:decrypt('tencentSecretId'),secretKey:decrypt('tencentSecretKey')};
}

/** Main-process only; the returned API key never leaves this process. */
export async function getLlmConfiguration(): Promise<{provider:'openai-compat'|'ollama';baseUrl:string;model:string;apiKey:string}> {
  const stored=await readStored();
  const provider=stored.llmProvider==='ollama'?'ollama':'openai-compat';
  const model=stored.llmModel?.trim() || (provider==='ollama'?'qwen2.5:7b-instruct':'');
  const baseUrl=stored.llmBaseUrl?.trim() || (provider==='ollama'?'http://127.0.0.1:11434/api/chat':'');
  if (!model || !baseUrl) throw new Error('请先保存模型地址和模型名称。');
  let url: URL;try {url=new URL(baseUrl);} catch {throw new Error('模型地址格式无效。');}
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('模型地址格式无效。');
  if (provider==='ollama' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('本地 Ollama 地址必须指向本机。');
  let apiKey='';
  if (provider==='openai-compat') {
    if (!safeStorage.isEncryptionAvailable() || !stored.llmApiKey) throw new Error('请先保存模型 API Key。');
    try {apiKey=safeStorage.decryptString(Buffer.from(stored.llmApiKey,'base64'));} catch {throw new Error('无法读取模型 API Key。');}
  }
  return {provider,baseUrl,model,apiKey};
}
