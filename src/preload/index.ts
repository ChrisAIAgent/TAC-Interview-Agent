import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
type CredentialInput=Partial<Record<'tencentAppId'|'tencentSecretId'|'tencentSecretKey'|'llmApiKey'|'llmBaseUrl'|'llmModel'|'llmPreset'|'llmProvider',string>>;
contextBridge.exposeInMainWorld('interviewAPI',Object.freeze({
  setIgnoreMouse:(ignore:boolean):void=>ipcRenderer.send('overlay:mouse-ignore',ignore),
  hide:():void=>ipcRenderer.send('overlay:hide'),
  quit:():void=>ipcRenderer.send('overlay:quit'),
  setCollapsed:(value:boolean):void=>ipcRenderer.send('overlay:collapse',value),
  openSettings:():void=>ipcRenderer.send('settings:open'),
  getWindowState:()=>ipcRenderer.invoke('window:get-state'),
  setShortcut:(value:string)=>ipcRenderer.invoke('window:set-shortcut',value),
  onWindowState:(callback:(state:unknown)=>void):(()=>void)=>{const listener=(_event:IpcRendererEvent,value:unknown):void=>callback(value);ipcRenderer.on('window:state',listener);return()=>ipcRenderer.removeListener('window:state',listener);},
  signTencent:()=>ipcRenderer.invoke('asr:sign'),
  publishAudioStatus:(value:{phase:string;level:number}):void=>ipcRenderer.send('session:status',value),
  onAudioStatus:(callback:(value:unknown)=>void):(()=>void)=>{const listener=(_event:IpcRendererEvent,value:unknown):void=>callback(value);ipcRenderer.on('session:status',listener);return()=>ipcRenderer.removeListener('session:status',listener);},
  publishTranscript:(value:{text:string;isFinal:boolean;sentenceIndex:number}):void=>ipcRenderer.send('session:transcript',value),
  onTranscript:(callback:(value:unknown)=>void):(()=>void)=>{const listener=(_event:IpcRendererEvent,value:unknown):void=>callback(value);ipcRenderer.on('session:transcript',listener);return()=>ipcRenderer.removeListener('session:transcript',listener);},
  startAnswer:(value:{question:string;system:string;user:string;remoteConsent:boolean;refs:string[]})=>ipcRenderer.invoke('llm:start',value),
  cancelAnswer:()=>ipcRenderer.invoke('llm:cancel'),
  testModel:(consent:boolean)=>ipcRenderer.invoke('llm:test',consent),
  onAnswer:(callback:(value:unknown)=>void):(()=>void)=>{const listener=(_event:IpcRendererEvent,value:unknown):void=>callback(value);ipcRenderer.on('llm:answer',listener);return()=>ipcRenderer.removeListener('llm:answer',listener);},
  getResume:()=>ipcRenderer.invoke('resume:get'),
  saveResume:(value:unknown)=>ipcRenderer.invoke('resume:save',value),
  getCredentials:()=>ipcRenderer.invoke('credentials:get'),
  saveCredentials:(input:CredentialInput)=>ipcRenderer.invoke('credentials:save',input),
}));
