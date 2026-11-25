import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

type Configuration={provider:'openai-compat'|'ollama';baseUrl:string;apiKey:string};
export type SemanticInput={question:string;entries:{id:string;text:string}[];consent:boolean};
export type SemanticResult={matches:{id:string;score:number}[]};
const MODEL='text-embedding-v4';
const DIMENSIONS=1024;
const VERSION=`${MODEL}-${DIMENSIONS}-document-v1`;
const THRESHOLD=0.32;
const MAX_CACHE_ENTRIES=1500;
export class SemanticFailure extends Error {
  readonly category:string;
  constructor(category:string){super('语义检索暂不可用。');this.category=category;}
}
export function isValidSemanticInput(input:SemanticInput):boolean {
  return Boolean(input&&input.consent===true&&typeof input.question==='string'&&input.question.trim()&&input.question.length<=4000&&Array.isArray(input.entries)&&input.entries.length<=500&&input.entries.every(item=>item&&typeof item.id==='string'&&item.id.length>0&&item.id.length<=200&&typeof item.text==='string'&&item.text.length>0&&item.text.length<=16000));
}

/** Restrict requests and authorization headers to the user's Alibaba Cloud region. */
function endpoint(configuration:Configuration):string {
  if(configuration.provider!=='openai-compat'||!configuration.apiKey)throw new SemanticFailure('unsupported_config');
  let url:URL;
  try {url=new URL(configuration.baseUrl);} catch {throw new SemanticFailure('unsupported_config');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||!(url.hostname==='dashscope.aliyuncs.com'||/^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/i.test(url.hostname)))throw new SemanticFailure('unsupported_config');
  return `https://${url.hostname}/api/v1/services/embeddings/text-embedding/text-embedding`;
}
function key(text:string,region:string):string{return createHash('sha256').update(VERSION).update('\0').update(region).update('\0').update(text).digest('hex');}
function isVector(value:unknown):value is number[]{return Array.isArray(value)&&value.length===DIMENSIONS&&value.every(n=>typeof n==='number'&&Number.isFinite(n));}
function similarity(a:number[],b:number[]):number {
  let product=0,aa=0,bb=0;
  for(let i=0;i<a.length;i++){product+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  return aa&&bb?product/Math.sqrt(aa*bb):0;
}
/** Return only a fixed, non-sensitive category; never propagate provider response text. */
async function httpFailure(response:Response):Promise<SemanticFailure>{
  let code='',message='';
  try {
    const value:unknown=await response.json();
    if(value&&typeof value==='object'){
      const row=value as {code?:unknown;message?:unknown;error?:{code?:unknown;message?:unknown}};
      code=typeof row.code==='string'?row.code:typeof row.error?.code==='string'?row.error.code:'';
      message=typeof row.message==='string'?row.message:typeof row.error?.message==='string'?row.error.message:'';
    }
  } catch {/* Only a sanitized status is returned for non-JSON failures. */}
  if(code==='AllocationQuota.FreeTierOnly'||/free tier (?:of the model )?has been exhausted|free allocated quota exceeded/i.test(message))return new SemanticFailure('free_tier_exhausted');
  if(code==='Arrearage'||code==='AccountOverdue'||/account (?:is )?in good standing|service suspended due to unpaid fees|insufficient balance/i.test(message))return new SemanticFailure('account_overdue');
  if(/api-key restrictions|api key restrictions/i.test(message))return new SemanticFailure('key_model_restricted');
  if(code==='InvalidApiKey'||code==='invalid_api_key')return new SemanticFailure('invalid_key');
  if(code==='ModelNotFound'||code==='model_not_found')return new SemanticFailure('model_not_found');
  if(code==='AccessDenied'||code==='access_denied'||code==='Model.AccessDenied')return new SemanticFailure('access_denied');
  return new SemanticFailure(`http_${response.status}`);
}

/** Cloud embeddings are used only with explicit renderer consent. Cached vectors contain no original text. */
export class SemanticSearch {
  private active:AbortController|null=null;
  private cache=new Map<string,number[]>();
  private loaded:Promise<void>|null=null;
  private writes:Promise<void>=Promise.resolve();
  private readonly load:()=>Promise<Configuration>;
  private readonly cachePath:()=>string;
  private readonly fetcher:typeof fetch;
  private readonly timeoutMs:number;
  constructor(load:()=>Promise<Configuration>,cachePath:()=>string,fetcher:typeof fetch=fetch,timeoutMs=12000){this.load=load;this.cachePath=cachePath;this.fetcher=fetcher;this.timeoutMs=timeoutMs;}
  cancel():void {this.active?.abort();this.active=null;}
  private async loadCache():Promise<void>{
    if(!this.loaded)this.loaded=(async()=>{
      try {
        const value:unknown=JSON.parse(await readFile(this.cachePath(),'utf8'));
        if(!value||typeof value!=='object')return;
        const row=value as {version?:unknown;vectors?:unknown};
        if(row.version!==VERSION||!row.vectors||typeof row.vectors!=='object'||Array.isArray(row.vectors))return;
        for(const [hash,vector] of Object.entries(row.vectors))if(/^[a-f0-9]{64}$/.test(hash)&&isVector(vector)&&this.cache.size<MAX_CACHE_ENTRIES)this.cache.set(hash,vector);
      } catch {/* A missing or corrupt cache simply requires re-indexing. */}
    })();
    await this.loaded;
  }
  private saveCache():void {
    // Serialize atomic writes; cache failures do not prevent answering the question.
    const path=this.cachePath();
    const snapshot=JSON.stringify({version:VERSION,vectors:Object.fromEntries(this.cache)});
    this.writes=this.writes.catch(()=>{}).then(async()=>{await writeFile(`${path}.tmp`,snapshot,{encoding:'utf8',mode:0o600});await rename(`${path}.tmp`,path);}).catch(()=>{});
  }
  private async embed(url:string,apiKey:string,texts:string[],type:'query'|'document',signal:AbortSignal):Promise<number[][]>{
    if(signal.aborted)throw new Error('语义检索已取消。');
    const response=await this.fetcher(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,input:{texts},parameters:{text_type:type,dimension:DIMENSIONS}}),signal});
    if(!response.ok)throw await httpFailure(response);
    let data:unknown;
    try {data=await response.json();} catch {throw new SemanticFailure('invalid_json');}
    const rows=(data as {output?:{embeddings?:unknown}})?.output?.embeddings;
    if(!Array.isArray(rows)||rows.length!==texts.length)throw new SemanticFailure('invalid_embedding_count');
    const result:number[][]=Array(texts.length);
    for(let i=0;i<rows.length;i++){
      const row=rows[i] as {index?:unknown;text_index?:unknown;embedding?:unknown};
      const index=typeof row?.index==='number'?row.index:typeof row?.text_index==='number'?row.text_index:i;
      if(!Number.isInteger(index)||index<0||index>=texts.length||result[index]||!isVector(row?.embedding))throw new SemanticFailure('invalid_embedding_vector');
      result[index]=row.embedding;
    }
    return result;
  }
  async search(input:SemanticInput):Promise<SemanticResult>{
    if(!isValidSemanticInput(input))throw new Error('语义检索请求无效或未授权。');
    this.cancel();const controller=new AbortController();this.active=controller;
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},this.timeoutMs);
    try {
      const configuration=await this.load();const url=endpoint(configuration);
      await this.loadCache();if(controller.signal.aborted)throw new Error('语义检索已取消。');
      const items=input.entries.map(entry=>{const text=entry.text.slice(0,2000);return {...entry,text,hash:key(text,url)};});
      if(!items.length)return {matches:[]};
      const missing=[...new Map(items.filter(item=>!this.cache.has(item.hash)).map(item=>[item.hash,item])).values()];
      const batches:(typeof missing)[]=[];for(let i=0;i<missing.length;i+=10)batches.push(missing.slice(i,i+10));
      let next=0;
      const worker=async():Promise<void>=>{
        while(next<batches.length){
          const batch=batches[next++];const vectors=await this.embed(url,configuration.apiKey,batch.map(item=>item.text),'document',controller.signal);
          if(controller.signal.aborted)throw new Error('语义检索已取消。');
          for(let i=0;i<batch.length;i++){
            if(this.cache.size>=MAX_CACHE_ENTRIES&&!this.cache.has(batch[i].hash)){const oldest=this.cache.keys().next().value;if(oldest)this.cache.delete(oldest);}
            this.cache.set(batch[i].hash,vectors[i]);
          }
          this.saveCache();
        }
      };
      const [query]=await Promise.all([this.embed(url,configuration.apiKey,[input.question],'query',controller.signal),worker(),worker()]);
      if(controller.signal.aborted)throw new Error('语义检索已取消。');
      const matches=items.map(item=>({id:item.id,score:similarity(query[0],this.cache.get(item.hash)!)})).filter(item=>item.score>=THRESHOLD).sort((a,b)=>b.score-a.score).slice(0,3);
      await this.writes;
      if(controller.signal.aborted)throw new Error('语义检索已取消。');
      return {matches};
    } catch (error) {
      const reason=timedOut?'timeout':controller.signal.aborted?'cancelled':error instanceof SemanticFailure?error.category:'network_or_config';
      if(reason!=='cancelled')console.warn(`[semantic-search] ${reason}`);
      controller.abort();
      throw new SemanticFailure(reason);
    } finally {clearTimeout(timeout);if(this.active===controller)this.active=null;}
  }
}
