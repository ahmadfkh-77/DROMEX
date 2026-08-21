import type {CloudAccountSnapshot} from '../../domain/cloud';

export interface CloudRepository {
  getSnapshot(): Promise<CloudAccountSnapshot>;
  signIn(email: string, password: string): Promise<CloudAccountSnapshot>;
  sendPasswordReset(email: string): Promise<void>;
  sendEmailVerification(): Promise<void>;
  refreshAccount(): Promise<CloudAccountSnapshot>;
  synchronize(): Promise<CloudAccountSnapshot>;
  signOut(): Promise<void>;
}
