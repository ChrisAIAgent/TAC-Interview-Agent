import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { insideDragBar } from './platform/overlay-hit-test';
import { join } from 'node:path';
import { getCredentials, saveCredentials, getTencentCredentials, getLlmConfiguration } from './store/credentials';
import { OpenAICompatProvider } from './llm/openai-compat';
import { OllamaProvider } from './llm/ollama';
import { AnswerManager, type AnswerUpdate } from './llm/answer-manager';
import { buildTencentWsUrl } from './asr/tencent-sign';
import { installSystemAudioHandler } from './platform/systemAudio';
import { loadResume, saveResume } from './store/resume';
import { DEFAULT_TOGGLE_SHORTCUT, readPreferences, savePreferences } from './store/preferences';

interface WindowState { shortcut: string; shortcutError: string | null; visible: boolean }
let overlay: BrowserWindow | null=null;
let settings: BrowserWindow | null=null;
let tray: Tray | null=null;
let shortcut=DEFAULT_TOGGLE_SHORTCUT;
let shortcutError: string | null=null;
let registeredShortcut: string | null=null;
let expandedHeight=360;
let quitting=false;
let inDragBar=false;
let rendererIgnoresMouse=true;
let currentIgnore=true;
let mousePoll:ReturnType<typeof setInterval>|null=null;
function syncOverlayMouse():void {
  if(!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
  const inside=insideDragBar(screen.getCursorScreenPoint(),overlay.getBounds());
  if(inDragBar && !inside) rendererIgnoresMouse=true;
  inDragBar=inside;
  const ignore=!inside && rendererIgnoresMouse;
  if(ignore!==currentIgnore){overlay.setIgnoreMouseEvents(ignore,ignore?{forward:true}:undefined);currentIgnore=ignore;}
}
async function loadProvider(){
  const cfg=await getLlmConfiguration();
  return cfg.provider==='ollama'
    ? {provider:new OllamaProvider(cfg.model,cfg.baseUrl),remote:false}
    : {provider:new OpenAICompatProvider(cfg.model,cfg.apiKey,cfg.baseUrl),remote:true};
}
function publishAnswer(value:AnswerUpdate):void {
  for(const win of [overlay,settings]) if(win && !win.isDestroyed()) win.webContents.send('llm:answer',value);
}
const answers=new AnswerManager(loadProvider,publishAnswer);

function state(): WindowState { return { shortcut, shortcutError, visible: !!overlay?.isVisible() }; }
function notifyState(): void {
  for (const win of [overlay,settings]) if (win && !win.isDestroyed()) win.webContents.send('window:state',state());
}
function showOverlay(): void { if (overlay && !overlay.isDestroyed()) { overlay.showInactive(); notifyState(); } }
function hideOverlay(): void { if (overlay && !overlay.isDestroyed()) { overlay.hide(); notifyState(); } }
function toggleOverlay(): void { if (overlay?.isVisible()) hideOverlay(); else showOverlay(); }
function registerShortcut(candidate: string): boolean {
  try {
    if (registeredShortcut===candidate) return true;
    if (!globalShortcut.register(candidate,toggleOverlay)) return false;
    if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
    registeredShortcut=candidate; shortcut=candidate; shortcutError=null; notifyState(); return true;
  } catch { return false; }
}
function createOverlay(): void {
  overlay=new BrowserWindow({ width:440,height:expandedHeight,minWidth:380,minHeight:72,frame:false,transparent:true,
    resizable:true,movable:true,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,focusable:false,fullscreenable:false,show:false,
    webPreferences:{ preload:join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false } });
  overlay.setAlwaysOnTop(true,'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  // Best effort only: ScreenCaptureKit and some capture tools can still see it.
  overlay.setContentProtection(true);
  overlay.setIgnoreMouseEvents(true,{forward:true});
  overlay.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  overlay.once('ready-to-show',showOverlay);
  overlay.on('closed',()=>{overlay=null;});
  if (process.env.ELECTRON_RENDERER_URL) void overlay.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void overlay.loadFile(join(__dirname,'../renderer/index.html'));
}
function openSettings(): void {
  if (settings && !settings.isDestroyed()) { settings.show(); settings.focus(); return; }
  settings=new BrowserWindow({ width:980,height:760,minWidth:760,minHeight:600,title:'TAC Interview Agent 设置',
    webPreferences:{preload:join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false} });
  settings.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  installSystemAudioHandler(settings.webContents.session,settings.webContents);
  settings.on('close',event=>{if(!quitting){event.preventDefault();settings?.hide();}});
  settings.on('closed',()=>{settings=null;});
  if (process.env.ELECTRON_RENDERER_URL) void settings.loadURL(new URL('settings.html',process.env.ELECTRON_RENDERER_URL).toString());
  else void settings.loadFile(join(__dirname,'../renderer/settings.html'));
}
function isTrusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return [overlay,settings].some(win=>!!win && event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame);
}
function isSettings(event: Electron.IpcMainInvokeEvent): boolean { return !!settings && event.sender===settings.webContents && event.senderFrame===settings.webContents.mainFrame; }
ipcMain.on('overlay:mouse-ignore',(event,ignore:unknown)=>{if(isTrusted(event) && event.sender===overlay?.webContents && typeof ignore==='boolean'){rendererIgnoresMouse=ignore;syncOverlayMouse();}});
ipcMain.on('overlay:hide',event=>{if(isTrusted(event)) hideOverlay();});
ipcMain.on('overlay:quit',event=>{if(isTrusted(event)) app.quit();});
ipcMain.on('settings:open',event=>{if(isTrusted(event)) openSettings();});
ipcMain.on('overlay:collapse',(event,collapsed:unknown)=>{
  if(!isTrusted(event) || typeof collapsed!=='boolean' || !overlay) return;
  const [width,height]=overlay.getSize();
  if(collapsed){if(height>80) expandedHeight=height;overlay.setSize(width,72,true);} else overlay.setSize(width,expandedHeight,true);
});
ipcMain.handle('window:get-state',event=>{if(!isTrusted(event)) throw new Error('无权访问。');return state();});
ipcMain.handle('window:set-shortcut',async(event,candidate:unknown)=>{
  if(!isSettings(event)) throw new Error('请在设置页修改快捷键。');
  if(typeof candidate!=='string' || !candidate.trim() || candidate.length>80) throw new Error('快捷键格式无效。');
  const value=candidate.trim();
  if(!registerShortcut(value)){shortcutError='快捷键暂时无法使用，可能被其他程序占用或格式不正确。';notifyState();return state();}
  try { await savePreferences({toggleShortcut:value}); } catch { shortcutError='快捷键已启用，但保存失败。';notifyState(); }
  return state();
});
ipcMain.handle('asr:sign',async event=>{
  if(!isSettings(event)) throw new Error('请在设置页操作。');
  const credentials=await getTencentCredentials();
  return buildTencentWsUrl({...credentials,hotwords:['RAG','Kubernetes','QPS','灰度','微服务','分布式']});
});
ipcMain.on('session:status',(event,value:unknown)=>{
  if(!isTrusted(event) || event.sender!==settings?.webContents || !value || typeof value!=='object') return;
  const item=value as Record<string,unknown>;
  if(typeof item.phase!=='string' || !['idle','testing','connecting','listening','paused','reconnecting','stopped','failed'].includes(item.phase) || typeof item.level!=='number' || !Number.isFinite(item.level)) return;
  if(overlay && !overlay.isDestroyed()) overlay.webContents.send('session:status',{phase:item.phase,level:Math.min(1,Math.max(0,item.level))});
});
ipcMain.on('session:transcript',(event,value:unknown)=>{
  if(!isTrusted(event) || event.sender!==settings?.webContents || !value || typeof value!=='object') return;
  const row=value as Record<string,unknown>;
  if(typeof row.text!=='string' || row.text.length>10000 || typeof row.isFinal!=='boolean' || typeof row.sentenceIndex!=='number') return;
  if(overlay && !overlay.isDestroyed()) overlay.webContents.send('session:transcript',{text:row.text,isFinal:row.isFinal,sentenceIndex:row.sentenceIndex});
});
ipcMain.handle('llm:start',(event,value:unknown)=>{
  if(!isSettings(event) || !value || typeof value!=='object') throw new Error('请求格式无效。');
  const req=value as Record<string,unknown>;
  if(typeof req.question!=='string' || !req.question.trim() || req.question.length>4000 || typeof req.system!=='string' || req.system.length>16000 || typeof req.user!=='string' || req.user.length>16000 || typeof req.remoteConsent!=='boolean') throw new Error('请求格式无效。');
  if(!Array.isArray(req.refs) || req.refs.length>4 || !req.refs.every(value=>typeof value==='string' && value.length<=300)) throw new Error('引用格式无效。');
  return answers.start({question:req.question,system:req.system,user:req.user,remoteConsent:req.remoteConsent,refs:req.refs as string[]});
});
ipcMain.handle('llm:cancel',event=>{if(!isTrusted(event)) throw new Error('无权操作。');answers.cancel();});
ipcMain.handle('llm:test',async(event,consent:unknown)=>{
  if(!isSettings(event) || typeof consent!=='boolean') throw new Error('请求格式无效。');
  const {provider,remote}=await loadProvider();
  if(remote && !consent) throw new Error('请先确认问题与简历片段将发送到模型服务商。');
  return provider.test();
});
ipcMain.handle('resume:get',event=>{if(!isSettings(event)) throw new Error('请在设置页操作。');return loadResume();});
ipcMain.handle('resume:save',(event,value:unknown)=>{if(!isSettings(event)) throw new Error('请在设置页操作。');return saveResume(value);});
ipcMain.handle('credentials:get',event=>{if(!isSettings(event)) throw new Error('请在设置页操作。');return getCredentials();});
ipcMain.handle('credentials:save',(event,values:unknown)=>{if(!isSettings(event)) throw new Error('请在设置页操作。');return saveCredentials(values);});
function createTray(): void {
  const icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAnUlEQVR4nO2XQQ7CIBBF//z0Eno5XemZdGUvZ49RVyQmMoQYmL/ovBXpUN4nwwIAMdYqni63fYRkW5+ux2aKe4IwSu6tzSi552CkvOYixDB694XiJMQsreL79RgmOl/v1e+EGB4+wPJP37zz0ZqfLfAgxDADIFsghhkAYqwMom9F5YpOiGHP62U03y56hQj5T4DZIWprW+uHiMepnA/c4DLYhpabSAAAAABJRU5ErkJggg==');
  tray=new Tray(icon); tray.setToolTip('TAC Interview Agent');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'设置',click:openSettings},{label:'显示悬浮窗',click:showOverlay},{label:'隐藏悬浮窗',click:hideOverlay},{type:'separator'},{label:'退出',click:()=>app.quit()}]));
  tray.on('click',toggleOverlay);
}
const hasLock=app.requestSingleInstanceLock();
if(!hasLock) app.quit();
else {
  app.on('second-instance',()=>{if(app.isReady()) {showOverlay();openSettings();}});
  app.whenReady().then(async()=>{
    if(process.platform==='darwin') {app.dock?.hide();app.setActivationPolicy('accessory');}
    createOverlay();createTray();openSettings();
    mousePoll=setInterval(syncOverlayMouse,30);
    try { shortcut=(await readPreferences()).toggleShortcut; } catch { shortcutError='无法读取快捷键设置，已尝试使用默认快捷键。'; }
    if(!registerShortcut(shortcut)) {shortcutError='快捷键暂时无法使用，可能被其他程序占用或格式不正确。';notifyState();}
    app.on('activate',openSettings);
  });
  app.on('before-quit',()=>{quitting=true;if(mousePoll)clearInterval(mousePoll);answers.cancel();globalShortcut.unregisterAll();});
  app.on('window-all-closed',()=>{/* Tray stays available. */});
}
