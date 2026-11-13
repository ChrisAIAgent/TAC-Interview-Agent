import { app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_TOGGLE_SHORTCUT = 'Alt+Shift+H';
export interface Preferences { toggleShortcut: string }
export async function readPreferences(): Promise<Preferences> {
  try {
    const value: unknown=JSON.parse(await readFile(join(app.getPath('userData'),'preferences.json'),'utf8'));
    if (value && typeof value==='object' && 'toggleShortcut' in value && typeof value.toggleShortcut==='string' && value.toggleShortcut.length<=80) return {toggleShortcut:value.toggleShortcut};
    return {toggleShortcut:DEFAULT_TOGGLE_SHORTCUT};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code==='ENOENT') return {toggleShortcut:DEFAULT_TOGGLE_SHORTCUT};
    throw new Error('无法读取快捷键设置。');
  }
}
export async function savePreferences(value: Preferences): Promise<void> {
  await writeFile(join(app.getPath('userData'),'preferences.json'),JSON.stringify(value,null,2),{encoding:'utf8',mode:0o600});
}
