import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export type ProcessKind = 'meeting' | 'recording' | 'proctoring';
export interface DetectedProcess { name: string; kind: ProcessKind }
const patterns: Array<{ pattern: RegExp; name: string; kind: ProcessKind }> = [
  { pattern: /pearsonvue|pearson.?vue|proctoru|respondus|lockdownbrowser|proctorio|examity/i, name: '已知监考进程', kind: 'proctoring' },
  { pattern: /tencent.?meeting|wemeet|voov|zoom|teams|dingtalk|feishu|lark|discord/i, name: '会议应用', kind: 'meeting' },
  { pattern: /obs64|obs-studio|quicktimeplayer|wechat/i, name: '录制或通信应用', kind: 'recording' },
];

export async function scanProcesses(): Promise<{ detectedProcs: DetectedProcess[]; scanAvailable: boolean }> {
  try {
    const command = process.platform === 'win32' ? 'tasklist.exe' : '/bin/ps';
    const args = process.platform === 'win32' ? ['/FO', 'CSV', '/NH'] : ['-axo', 'comm='];
    const { stdout } = await run(command, args, { timeout: 5000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    const matched = patterns.filter(({ pattern }) => pattern.test(stdout)).map(({ name, kind }) => ({ name, kind }));
    return { detectedProcs: matched, scanAvailable: true };
  } catch {
    return { detectedProcs: [], scanAvailable: false };
  }
}
