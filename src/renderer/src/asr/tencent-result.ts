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
