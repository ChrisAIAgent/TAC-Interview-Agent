/** Pure guard state for the untrusted async listener/window boundary. */
export interface HoldState { mode: 'unconfirmed' | 'tab-or-window' | 'full-screen' | 'unknown'; ready: boolean; armed: boolean; pressed: boolean; version: number; }
export type HoldEvent =
  | { type: 'mode'; mode: HoldState['mode'] }
  | { type: 'ready'; ready: boolean; armed: boolean }
  | { type: 'combo'; pressed: boolean }
  | { type: 'reset' };
export const initialHoldState: HoldState = { mode: 'unconfirmed', ready: false, armed: false, pressed: false, version: 0 };
export function updateHold(state: HoldState, event: HoldEvent): HoldState {
  const version=state.version + 1;
  switch (event.type) {
    case 'mode': return { ...state, mode: event.mode, armed: false, pressed: false, version };
    case 'reset': return { ...state, armed: false, pressed: false, version };
    case 'ready': return { ...state, ready: event.ready, armed: event.ready && event.armed, pressed: event.ready ? state.pressed : false, version };
    case 'combo': return { ...state, pressed: event.pressed && state.mode === 'full-screen' && state.ready && state.armed, armed: event.pressed ? state.armed : false, version };
  }
}
export function mayReveal(state: HoldState): boolean { return state.mode === 'full-screen' && state.ready && state.armed && state.pressed; }
export function isCurrentReveal(state: HoldState, version: number): boolean { return state.version === version && mayReveal(state); }
