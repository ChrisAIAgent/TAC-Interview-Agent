import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KeyListener, listenerPath, type ListenerSnapshot } from './platform/keylistener';
import { initialHoldState, updateHold, mayReveal, isCurrentReveal } from './platform/hold-state';
import { join } from 'node:path';
import { scanProcesses, type DetectedProcess } from './platform/processes';
import { getCredentials, saveCredentials } from './store/credentials';

type ShareMode = 'unconfirmed' | 'tab-or-window' | 'full-screen' | 'unknown';
type DeclaredMode = Exclude<ShareMode, 'unconfirmed'>;
interface GuardState {
  platform: string;
  mode: ShareMode;
  riskLevel: 'unknown' | 'low' | 'medium' | 'high';
  detectedProcs: DetectedProcess[];
  scanAvailable: boolean;
  holdToRevealAvailable: boolean;
  presentation: 'edge' | 'revealed' | 'hidden';
  listener: ListenerSnapshot;
  revealTicket: number;
  expandApiMs?: number;
  collapseApiMs?: number;
  expandRoundTripMs?: number;
  collapseRoundTripMs?: number;
  declaredAt?: number;
  reason?: string;
}
let overlay: BrowserWindow | null = null;
let settings: BrowserWindow | null = null;
let tray: Tray | null = null;
let expandedHeight = 360;
let normalBounds: Electron.Rectangle | null = null;
let guard: GuardState = { platform: process.platform, mode: 'unconfirmed', riskLevel: 'unknown', detectedProcs: [], scanAvailable: false, holdToRevealAvailable: false, presentation: 'edge', listener: { status: 'disabled', sameDevice: false, armed: false }, revealTicket: 0 };
let hold = initialHoldState;
let keyListener: KeyListener | null = null;
let pendingRevealEventId: number | undefined;
let pendingRevealTimeout: ReturnType<typeof setTimeout> | null = null;

function notifyGuard(): void {
  for (const win of [overlay, settings]) if (win && !win.isDestroyed()) win.webContents.send('guard:state', guard);
}
function applyGuard(): void {
  if (!overlay || overlay.isDestroyed()) return;
  if (guard.mode === 'unknown') {
    overlay.hide();
  } else if (guard.mode === 'full-screen') {
    if (!normalBounds) normalBounds = overlay.getBounds();
    if (guard.presentation === 'revealed') return;
    const before=performance.now();
    overlay.hide();
    overlay.setMinimumSize(1, 1);
    const display=screen.getDisplayMatching(normalBounds);
    const area=display.workArea;
    const width=Math.max(1, Math.round(1 / display.scaleFactor));
    const height=Math.max(1, Math.round(area.height * 0.6));
    overlay.setBounds({ x: area.x + area.width - width, y: area.y + Math.round((area.height - height) / 2), width, height });
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.showInactive();
    guard.collapseApiMs=performance.now()-before;
  } else {
    if (normalBounds) {
      overlay.hide(); overlay.setMinimumSize(380, 72); overlay.setBounds(normalBounds); normalBounds=null;
      overlay.setIgnoreMouseEvents(true, { forward: true });
    }
    overlay.showInactive();
  }
  notifyGuard();
}
function collapseHold(resetListener: boolean): void {
  if (pendingRevealTimeout) clearTimeout(pendingRevealTimeout);
  pendingRevealTimeout=null; pendingRevealEventId=undefined;
  hold=updateHold(hold, { type: 'reset' });
  guard.presentation=guard.mode === 'unknown' ? 'hidden' : 'edge';
  keyListener?.endLease();
  if (guard.mode === 'full-screen') applyGuard();
  if (resetListener) keyListener?.reset();
  notifyGuard();
}
function startReveal(eventId?: number): void {
  if (!overlay || overlay.isDestroyed() || !normalBounds || !mayReveal(hold)) return;
  const ticket=hold.version;
  const before=performance.now();
  keyListener?.beginLease();
  overlay.hide();
  overlay.setMinimumSize(380, 72);
  overlay.setBounds(normalBounds);
  guard.presentation='revealed'; guard.revealTicket=ticket; pendingRevealEventId=eventId;
  guard.expandApiMs=performance.now()-before;
  notifyGuard();
  pendingRevealTimeout=setTimeout(() => { if (isCurrentReveal(hold,ticket)) collapseHold(true); }, 1_000);
}
function onListenerStatus(value: ListenerSnapshot): void {
  const wasPressed=hold.pressed;
  hold=updateHold(hold,{ type: 'ready', ready: value.status === 'ready', armed: value.armed });
  guard.listener=value; guard.holdToRevealAvailable=value.status === 'ready' && value.sameDevice;
  if (wasPressed && !hold.pressed) collapseHold(false);
  notifyGuard(); updateTray();
}
function createListener(): void {
  keyListener=new KeyListener({
    status: onListenerStatus,
    combo: (pressed,eventId) => {
      if (!pressed) { collapseHold(false); keyListener?.acknowledge(eventId,'collapse'); return; }
      hold=updateHold(hold,{ type: 'combo', pressed: true });
      if (mayReveal(hold)) startReveal(eventId);
    },
    latency: (kind,ms) => { if (kind === 'expand') guard.expandRoundTripMs=ms; else guard.collapseRoundTripMs=ms; notifyGuard(); },
    leaseExpired: () => { collapseHold(true); },
    displaySleep: () => { resetHold(); },
  }, listenerPath(app.isPackaged, process.resourcesPath, app.getAppPath(), process.platform));
}
function resetHold(): void { collapseHold(true); }
async function refreshScan(): Promise<void> {
  const result = await scanProcesses();
  guard = { ...guard, ...result };
  if (result.detectedProcs.some((item) => item.kind === 'proctoring')) {
    resetHold(); hold=updateHold(hold,{ type: 'mode', mode: 'unknown' });
    guard = { ...guard, mode: 'unknown', presentation: 'hidden', riskLevel: 'high', reason: '检测到已知监考进程，已停止显示内容。' };
    applyGuard();
  } else {
    notifyGuard();
  }
}
async function declareShare(mode: unknown): Promise<GuardState> {
  if (mode !== 'tab-or-window' && mode !== 'full-screen' && mode !== 'unknown') throw new Error('请选择共享范围。');
  const scan = await scanProcesses();
  const proctored = scan.detectedProcs.some((item) => item.kind === 'proctoring');
  const finalMode: DeclaredMode = proctored ? 'unknown' : mode;
  resetHold();
  hold=updateHold(hold,{ type: 'mode', mode: finalMode });
  guard = {
    ...guard, ...scan,
    mode: finalMode, presentation: finalMode === 'unknown' ? 'hidden' : 'edge',
    riskLevel: finalMode === 'tab-or-window' ? 'low' : finalMode === 'full-screen' ? 'medium' : 'high',
    declaredAt: Date.now(),
    reason: proctored ? '检测到已知监考进程，已停止显示内容。' : undefined,
  };
  applyGuard();
  return guard;
}
function createOverlay(): void {
  overlay = new BrowserWindow({ width: 440, height: expandedHeight, minWidth: 380, minHeight: 72,
    frame: false, transparent: true, resizable: true, movable: true, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, focusable: false, fullscreenable: false, show: false, title: '',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  overlay.setTitle('');
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  overlay.setContentProtection(true);
  overlay.setSkipTaskbar(true);
  if (process.platform === 'darwin') overlay.setWindowButtonVisibility(false);
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.once('ready-to-show', applyGuard);
  overlay.on('closed', () => { overlay = null; });
  if (process.env.ELECTRON_RENDERER_URL) void overlay.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void overlay.loadFile(join(__dirname, '../renderer/index.html'));
}
function openSettings(): void {
  if (settings && !settings.isDestroyed()) { settings.show(); settings.focus(); return; }
  settings = new BrowserWindow({ width: 980, height: 760, minWidth: 760, minHeight: 600, title: 'TAC Interview Agent 设置',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settings.on('closed', () => { settings = null; });
  if (process.env.ELECTRON_RENDERER_URL) void settings.loadURL(new URL('settings.html', process.env.ELECTRON_RENDERER_URL).toString());
  else void settings.loadFile(join(__dirname, '../renderer/settings.html'));
}
function isTrusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return [overlay, settings].some((win) => !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
}
function isSettings(event: Electron.IpcMainInvokeEvent): boolean {
  return !!settings && event.sender === settings.webContents && event.senderFrame === settings.webContents.mainFrame;
}
ipcMain.on('overlay:mouse-ignore', (event, ignore: unknown) => {
  if (isTrusted(event) && event.sender === overlay?.webContents && typeof ignore === 'boolean' && (guard.mode === 'unconfirmed' || guard.mode === 'tab-or-window' || (guard.mode === 'full-screen' && guard.presentation === 'revealed')))
    overlay?.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
});
ipcMain.on('overlay:rendered', (event, ticket: unknown) => {
  if (!isTrusted(event) || event.sender !== overlay?.webContents || typeof ticket !== 'number' || !isCurrentReveal(hold,ticket) || guard.presentation !== 'revealed') return;
  if (pendingRevealTimeout) clearTimeout(pendingRevealTimeout); pendingRevealTimeout=null;
  const before=performance.now(); overlay?.showInactive(); guard.expandApiMs=(guard.expandApiMs ?? 0)+(performance.now()-before);
  keyListener?.acknowledge(pendingRevealEventId,'expand'); pendingRevealEventId=undefined;
});
ipcMain.on('overlay:hide', (event) => { if (isTrusted(event)) overlay?.hide(); });
ipcMain.on('overlay:quit', (event) => { if (isTrusted(event)) app.quit(); });
ipcMain.on('settings:open', (event) => { if (isTrusted(event)) openSettings(); });
ipcMain.on('overlay:collapse', (event, collapsed: unknown) => {
  if (!isTrusted(event) || typeof collapsed !== 'boolean' || !overlay || !['unconfirmed', 'tab-or-window'].includes(guard.mode)) return;
  const [width, height] = overlay.getSize();
  if (collapsed) { if (height > 80) expandedHeight = height; overlay.setSize(width, 72, true); }
  else overlay.setSize(width, expandedHeight, true);
});
ipcMain.handle('guard:get', (event) => { if (!isTrusted(event)) throw new Error('无权访问。'); return guard; });
ipcMain.handle('guard:declare', (event, mode: unknown) => { if (!isSettings(event)) throw new Error('请在设置页面确认。'); return declareShare(mode); });
ipcMain.handle('guard:reset', async (event) => {
  if (!isSettings(event)) throw new Error('请在设置页面操作。');
  const scan = await scanProcesses();
  const proctored = scan.detectedProcs.some((item) => item.kind === 'proctoring');
  resetHold();
  hold=updateHold(hold,{ type: 'mode', mode: proctored ? 'unknown' : 'unconfirmed' });
  guard = { ...guard, ...scan, mode: proctored ? 'unknown' : 'unconfirmed', presentation: proctored ? 'hidden' : 'edge', riskLevel: proctored ? 'high' : 'unknown', reason: proctored ? '检测到已知监考进程，已停止显示内容。' : undefined };
  applyGuard();
  return guard;
});
ipcMain.handle('listener:start', (event) => { if (!isSettings(event)) throw new Error('仅设置页可操作。'); keyListener?.start(); return keyListener?.getState(); });
ipcMain.handle('listener:stop', (event) => { if (!isSettings(event)) throw new Error('仅设置页可操作。'); collapseHold(true); keyListener?.stop(); return keyListener?.getState(); });
const runFile=promisify(execFile);
ipcMain.handle('listener:permission', async (event, action: unknown) => {
  if (!isSettings(event) || process.platform !== 'darwin' || (action !== 'check' && action !== 'request')) throw new Error('无权操作。');
  const exe=listenerPath(app.isPackaged,process.resourcesPath,app.getAppPath(),process.platform);
  const result=await runFile(exe,[action === 'check' ? '--check-permission' : '--request-permission'],{ timeout: 15_000, maxBuffer: 4096 });
  const status=result.stdout.trim();
  return ['granted','denied','unknown','requested'].includes(status) ? status : 'unknown';
});
ipcMain.handle('listener:open-permission-settings', async (event) => {
  if (!isSettings(event) || process.platform !== 'darwin') throw new Error('无权操作。');
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
});
ipcMain.handle('listener:restart-app', (event) => {
  if (!isSettings(event) || process.platform !== 'darwin') throw new Error('无权操作。');
  app.relaunch(); app.quit();
});
ipcMain.handle('credentials:get', (event) => { if (!isSettings(event)) throw new Error('请在设置页面操作。'); return getCredentials(); });
ipcMain.handle('credentials:save', (event, values: unknown) => { if (!isSettings(event)) throw new Error('请在设置页面操作。'); return saveCredentials(values); });
function updateTray(): void {
  if (!tray) return;
  const label=guard.listener.status === 'ready' ? '按键监听运行中' : `按键监听：${guard.listener.reason ?? '未启用'}`;
  tray.setToolTip(`TAC Interview Agent · ${label}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false }, { label: '设置与共享范围', click: openSettings },
    { label: '显示悬浮窗', click: () => { if (guard.mode === 'tab-or-window' || guard.mode === 'unconfirmed') overlay?.showInactive(); else openSettings(); } },
    { label: '隐藏悬浮窗', click: () => overlay?.hide() }, { type: 'separator' }, { label: '退出', click: () => app.quit() },
  ]));
}
function createTray(): void {
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAnUlEQVR4nO2XQQ7CIBBF//z0Eno5XemZdGUvZ49RVyQmMoQYmL/ovBXpUN4nwwIAMdYqni63fYRkW5+ux2aKe4IwSu6tzSi552CkvOYixDB694XiJMQsreL79RgmOl/v1e+EGB4+wPJP37zz0ZqfLfAgxDADIFsghhkAYqwMom9F5YpOiGHP62U03y56hQj5T4DZIWprW+uHiMepnA/c4DLYhpabSAAAAABJRU5ErkJggg==');
  tray = new Tray(icon);
  tray.setToolTip('TAC Interview Agent');
  updateTray();
  tray.on('click', openSettings);
}
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady()) openSettings(); });
  app.whenReady().then(() => {
    if (process.platform === 'darwin') { app.dock?.hide(); app.setActivationPolicy('accessory'); }
    createListener(); createOverlay(); createTray(); openSettings();
    powerMonitor.on('lock-screen', resetHold); powerMonitor.on('unlock-screen', resetHold);
    powerMonitor.on('suspend', resetHold); powerMonitor.on('resume', resetHold);
    screen.on('display-removed', () => { resetHold(); if (normalBounds) { const area=screen.getPrimaryDisplay().workArea; normalBounds={ x: area.x + Math.max(0,area.width-normalBounds.width), y: area.y, width: Math.min(area.width,normalBounds.width), height: Math.min(area.height,normalBounds.height) }; } applyGuard(); });
    screen.on('display-metrics-changed', () => { resetHold(); applyGuard(); });
    app.on('before-quit', () => { keyListener?.stop(); });
    void refreshScan();
    setInterval(() => { void refreshScan(); }, 10 * 60_000).unref();
    app.on('activate', openSettings);
  });
  app.on('window-all-closed', () => { /* Keep the tray available until explicit quit. */ });
}
