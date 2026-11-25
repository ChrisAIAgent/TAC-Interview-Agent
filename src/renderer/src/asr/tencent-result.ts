export interface TencentTranscript { text: string; isFinal: boolean; startMs: number; endMs: number; sentenceIndex: number; confidence: number }
export interface TencentResultState { voiceId: string; lastFinalIndex: number; maxSeenIndex: number; dropCount: number }
export type TencentEvent =
  | { type: 'ready' }
  | { type: 'transcript'; line: TencentTranscript; streamEnded: boolean }
  | { type: 'complete' }
  | { type: 'ignored' }
  | { type: 'error'; code: number | 'INVALID_MESSAGE'; message: string; retryable: boolean };
export interface TencentResult { state: TencentResultState; event: TencentEvent }
export function newTencentResultState(voiceId: string): TencentResultState { return { voiceId, lastFinalIndex: -1, maxSeenIndex: -1, dropCount: 0 }; }
const retryableCodes=new Set([4000,4006,4008,4009,5000,5001,5002]);
/** Parses one service message without logging raw messages or credentials. */
export function reduceTencentMessage(state: TencentResultState, input: string): TencentResult {
  const failure=(): TencentResult => ({ state, event: { type:'error',code:'INVALID_MESSAGE',message:'语音识别返回了无效数据。',retryable:false } });
  if (input.length>1_000_000) return failure();
  let parsed: unknown; try { parsed=JSON.parse(input); } catch { return failure(); }
  if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) return failure();
  const obj=parsed as Record<string,unknown>;
  if (!Number.isInteger(obj.code)) return failure();
  if ((obj.code as number)!==0) return { state,event:{ type:'error',code:obj.code as number,message:'语音识别服务返回错误，请检查状态和设置。',retryable:retryableCodes.has(obj.code as number) } };
  if (typeof obj.voice_id==='string' && obj.voice_id!==state.voiceId) return { state:{...state,dropCount:state.dropCount+1},event:{type:'ignored'} };
  if (obj.final===1 && obj.result===undefined) return { state,event:{type:'complete'} };
  if (obj.result===undefined) return { state,event:{type:'ready'} };
  if (!obj.result || typeof obj.result!=='object' || Array.isArray(obj.result)) return failure();
  const row=obj.result as Record<string,unknown>;
  if (!Number.isInteger(row.index) || (row.index as number)<0 || ![0,1,2].includes(row.slice_type as number) ||
      typeof row.voice_text_str!=='string' || typeof row.start_time!=='number' || !Number.isFinite(row.start_time) || row.start_time<0 ||
      typeof row.end_time!=='number' || !Number.isFinite(row.end_time) || row.end_time<row.start_time) return failure();
  const index=row.index as number;
  if (index<=state.lastFinalIndex || index<state.maxSeenIndex) return { state:{...state,dropCount:state.dropCount+1},event:{type:'ignored'} };
  const isFinal=row.slice_type===2;
  const next={...state,maxSeenIndex:Math.max(state.maxSeenIndex,index),lastFinalIndex:isFinal ? index : state.lastFinalIndex};
  return { state:next,event:{type:'transcript',line:{text:row.voice_text_str,isFinal,startMs:row.start_time,endMs:row.end_time,sentenceIndex:index,confidence:1},streamEnded:obj.final===1} };
}

/** V2 may send several sentences in a single update, including previously finalized ones. */
export function reduceTencentMessages(state: TencentResultState, input: string): {state:TencentResultState; events:TencentEvent[]} {
  let parsed: unknown;
  try { parsed=JSON.parse(input); } catch { const result=reduceTencentMessage(state,input); return {state:result.state,events:[result.event]}; }
  if (!parsed || typeof parsed!=='object' || Array.isArray(parsed) || !('sentences' in parsed)) {
    const result=reduceTencentMessage(state,input); return {state:result.state,events:[result.event]};
  }
  const obj=parsed as Record<string,unknown>;
  if (obj.code!==0 || (typeof obj.voice_id==='string' && obj.voice_id!==state.voiceId) || input.length>1_000_000) {
    const result=reduceTencentMessage(state,input); return {state:result.state,events:[result.event]};
  }
  const container=obj.sentences;
  const rows=container && typeof container==='object' && !Array.isArray(container)
    ? ((container as Record<string,unknown>).sentence_list ?? [container]) : container;
  if (!Array.isArray(rows) || rows.length>1000) return {state,events:[{type:'error',code:'INVALID_MESSAGE',message:'语音识别返回了无效数据。',retryable:false}]};
  const events:TencentEvent[]=[];
  for (const value of rows) {
    if (!value || typeof value!=='object' || Array.isArray(value)) return {state,events:[{type:'error',code:'INVALID_MESSAGE',message:'语音识别返回了无效数据。',retryable:false}]};
    const row=value as Record<string,unknown>;
    if (!Number.isInteger(row.sentence_id) || ![0,1].includes(row.sentence_type as number) || typeof row.sentence!=='string') return {state,events:[{type:'error',code:'INVALID_MESSAGE',message:'语音识别返回了无效数据。',retryable:false}]};
    // Time fields are optional in Tencent's V2 SDK response.
    const start=typeof row.start_time==='number' ? row.start_time : 0;
    const end=typeof row.end_time==='number' ? row.end_time : start;
    if ((row.sentence_id as number)<=state.lastFinalIndex) continue;
    const reduced=reduceTencentMessage(state,JSON.stringify({code:0,voice_id:obj.voice_id,result:{index:row.sentence_id,slice_type:row.sentence_type===1?2:1,voice_text_str:row.sentence,start_time:start,end_time:end}}));
    state=reduced.state;
    if (reduced.event.type!=='ignored') events.push(reduced.event);
  }
  if (obj.final===1) events.push({type:'complete'});
  return {state,events:events.length?events:[{type:'ignored'}]};
}
