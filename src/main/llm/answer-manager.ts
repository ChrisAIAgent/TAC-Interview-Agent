import { randomUUID } from 'node:crypto';
import type { LlmProvider } from './provider.ts';
import { LlmError } from './provider.ts';

export interface AnswerUpdate { id:string; question:string; text:string; status:'thinking'|'streaming'|'done'|'error'|'interrupted'; refs:string[]; error?:string }
export interface AnswerRequest { question:string; system:string; user:string; remoteConsent:boolean; refs?:string[] }
export class AnswerManager {
  private active:{id:string;controller:AbortController;answer:AnswerUpdate}|null=null;
  private load:()=>Promise<{provider:LlmProvider;remote:boolean}>;
  private publish:(value:AnswerUpdate)=>void;
  constructor(load:()=>Promise<{provider:LlmProvider;remote:boolean}>,publish:(value:AnswerUpdate)=>void){this.load=load;this.publish=publish;}
  start(request:AnswerRequest):string {
    this.cancel();
    const id=randomUUID(),controller=new AbortController();
    const answer:AnswerUpdate={id,question:request.question,text:'',status:'thinking',refs:request.refs??[]};
    const active={id,controller,answer};this.active=active;this.emit(answer);
    void this.run(active,request);
    return id;
  }
  cancel():void {
    const active=this.active;if(!active)return;
    this.active=null;active.controller.abort();active.answer={...active.answer,status:'interrupted'};this.emit(active.answer);
  }
  private emit(value:AnswerUpdate):void {this.publish({...value});}
  private async run(active:{id:string;controller:AbortController;answer:AnswerUpdate},request:AnswerRequest):Promise<void> {
    try {
      const {provider,remote}=await this.load();
      if(this.active!==active)return;
      if(remote && !request.remoteConsent)throw new Error('请先确认问题与简历片段将发送到模型服务商。');
      for await (const chunk of provider.chat({system:request.system,messages:[{role:'user',content:request.user}],temperature:0.4,maxTokens:400},active.controller.signal)) {
        if(this.active!==active)return;
        if(chunk.delta){active.answer={...active.answer,text:(active.answer.text+chunk.delta).slice(0,50000),status:'streaming'};this.emit(active.answer);}
      }
      if(this.active!==active)return;
      active.answer={...active.answer,status:'done'};this.active=null;this.emit(active.answer);
    } catch(error) {
      if(this.active!==active)return;
      const message=error instanceof LlmError ? error.message : error instanceof Error && /请先|模型地址|模型名称|本地 Ollama|API Key/.test(error.message) ? error.message : '模型连接失败，请检查配置或网络。';
      active.answer={...active.answer,status:'error',error:message};this.active=null;this.emit(active.answer);
    }
  }
}
