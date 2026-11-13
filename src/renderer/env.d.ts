export {};
declare global {
  type ShareMode = 'unconfirmed' | 'tab-or-window' | 'full-screen' | 'unknown';
  interface GuardState {
    platform: string;
    mode: ShareMode;
    riskLevel: 'unknown' | 'low' | 'medium' | 'high';
    detectedProcs: { name: string; kind: 'meeting' | 'recording' | 'proctoring' }[];
    scanAvailable: boolean;
    holdToRevealAvailable: boolean;
    presentation: 'edge' | 'revealed' | 'hidden';
    revealTicket: number;
    listener: { status: 'disabled' | 'starting' | 'ready' | 'unavailable'; reason?: string; sameDevice: boolean; armed: boolean };
    expandApiMs?: number;
    collapseApiMs?: number;
    expandRoundTripMs?: number;
    collapseRoundTripMs?: number;
    declaredAt?: number;
    reason?: string;
  }
  type CredentialInput = Partial<Record<'tencentAppId' | 'tencentSecretId' | 'tencentSecretKey' | 'llmApiKey' | 'llmBaseUrl' | 'llmModel' | 'llmPreset', string>>;
  type CredentialSummary = Record<'tencentAppId' | 'tencentSecretId' | 'tencentSecretKey' | 'llmApiKey' | 'llmBaseUrl' | 'llmModel' | 'llmPreset', string> & { available: boolean };
  interface Window {
    interviewAPI: {
      setIgnoreMouse(ignore: boolean): void;
      hide(): void;
      quit(): void;
      setCollapsed(collapsed: boolean): void;
      openSettings(): void;
      overlayRendered(ticket: number): void;
      startListener(): Promise<GuardState['listener']>;
      stopListener(): Promise<GuardState['listener']>;
      listenerPermission(action: 'check' | 'request'): Promise<'granted' | 'denied' | 'unknown' | 'requested'>;
      openListenerPermissionSettings(): Promise<void>;
      restartApp(): Promise<void>;
      getGuardState(): Promise<GuardState>;
      declareShare(mode: Exclude<ShareMode, 'unconfirmed'>): Promise<GuardState>;
      resetShare(): Promise<GuardState>;
      onGuardState(callback: (state: GuardState) => void): () => void;
      getCredentials(): Promise<CredentialSummary>;
      saveCredentials(input: CredentialInput): Promise<CredentialSummary>;
    };
  }
}
