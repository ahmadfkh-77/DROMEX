import * as SecureStore from 'expo-secure-store';
import type {CloudSession} from '../../domain/cloud';

const key = 'dromex.firebase.owner-session.v1';

export class CloudSessionStore {
  async get(): Promise<CloudSession | null> {
    const value = await SecureStore.getItemAsync(key);
    if (!value) return null;
    try { return JSON.parse(value) as CloudSession; } catch { await this.clear(); return null; }
  }

  async set(session: CloudSession): Promise<void> {
    await SecureStore.setItemAsync(key, JSON.stringify(session), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }

  async clear(): Promise<void> { await SecureStore.deleteItemAsync(key); }
}
