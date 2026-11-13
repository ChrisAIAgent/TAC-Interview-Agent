import { app, safeStorage } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const keys = ['tencentAppId', 'tencentSecretId', 'tencentSecretKey', 'llmApiKey'] as const;
type CredentialKey = typeof keys[number];
const configKeys = ['llmBaseUrl', 'llmModel', 'llmPreset'] as const;
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
  const result: CredentialSummary = { available, tencentAppId: '', tencentSecretId: '', tencentSecretKey: '', llmApiKey: '', llmBaseUrl: '', llmModel: '', llmPreset: '' };
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
    stored[key] = safeStorage.encryptString(value).toString('base64');
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
