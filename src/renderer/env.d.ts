import type { Resume } from './src/shared/resume';
export {};
declare global {
  interface WindowState { shortcut:string; shortcutError:string|null; visible:boolean }
  interface AnswerUpdate {id:string;question:string;text:string;status:'thinking'|'streaming'|'done'|'error'|'interrupted';refs:string[];error?:string}
  type CredentialInput=Partial<Record<'tencentAppId'|'tencentSecretId'|'tencentSecretKey'|'llmApiKey'|'llmBaseUrl'|'llmModel'|'llmPreset'|'llmProvider',string>>;
  type CredentialSummary=Record<'tencentAppId'|'tencentSecretId'|'tencentSecretKey'|'llmApiKey'|'llmBaseUrl'|'llmModel'|'llmPreset'|'llmProvider',string>&{available:boolean};
  interface Window { interviewAPI:{
    beginWindowResize():void; updateWindowResize(buttons:number):void; endWindowResize():void; hide():void; quit():void; setCollapsed(value:boolean):void; openSettings():void;
    getWindowState():Promise<WindowState>; setShortcut(value:string):Promise<WindowState>; onWindowState(callback:(state:WindowState)=>void):()=>void;
    signTencent():Promise<{url:string;voiceId:string}>;
    publishAudioStatus(value:{phase:string;level:number}):void;
    onAudioStatus(callback:(value:{phase:string;level:number})=>void):()=>void;
    publishAutoStatus(value:string):void; onAutoStatus(callback:(value:string)=>void):()=>void;
    publishTranscript(value:{text:string;isFinal:boolean;sentenceIndex:number}):void;
    onTranscript(callback:(value:{text:string;isFinal:boolean;sentenceIndex:number})=>void):()=>void;
    startAnswer(value:{question:string;system:string;user:string;remoteConsent:boolean;refs:string[]}):Promise<string>;
    classifyUtterance(value:{utterance:string;context:string;consent:boolean}):Promise<{isQuestion:boolean;kind:'personal'|'math'|'general'|'external';question:string}>;
    searchPublicTopic(topic:string,consent:boolean):Promise<{summary:string;sources:{title:string;url:string}[]}>;
    cancelAnswer():Promise<void>;
    testModel(consent:boolean):Promise<{ok:boolean;latencyMs:number;model?:string;error?:string}>;
    onAnswer(callback:(value:AnswerUpdate)=>void):()=>void;
    getResume():Promise<Resume|null>;
    saveResume(value:Resume):Promise<Resume>;
    getCredentials():Promise<CredentialSummary>; saveCredentials(input:CredentialInput):Promise<CredentialSummary>;
  } }
}
