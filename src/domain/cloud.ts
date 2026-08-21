export type CloudPhase = 'idle' | 'syncing' | 'offline' | 'error';

export type CloudAccountSnapshot = {
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  emailVerified: boolean;
  deviceId: string;
  pendingCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  phase: CloudPhase;
};

export type CloudSession = {
  uid: string;
  email: string;
  emailVerified: boolean;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type CloudRecord = {
  key: string;
  table: string;
  recordId: string;
  row: Record<string, unknown> | null;
  tombstone: boolean;
  clientModifiedAt: string;
  cloudUpdatedAt: string;
  deviceId: string;
};
