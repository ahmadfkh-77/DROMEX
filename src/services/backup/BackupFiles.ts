import * as FileSystem from 'expo-file-system/legacy';
import {base64ToBytes,bytesToBase64} from './BackupCrypto';

/**
 * File access for backups as raw bytes. The new expo-file-system File API reads and writes bytes directly; the older base64-text
 * route is kept only as a fallback. Going through base64 text made a big backup need several times its size in memory and a lot of
 * time, which is what ran the app out of memory.
 */
type NewApi = typeof import('expo-file-system');
function newApi(): NewApi | null {
  try { return require('expo-file-system') as NewApi; } catch { return null; }
}

export async function readBytes(uri: string): Promise<Uint8Array> {
  const api = newApi();
  if (api) { try { return await new api.File(uri).bytes(); } catch { /* fall back to the base64 route below */ } }
  return base64ToBytes(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }));
}

export async function writeBytes(uri: string, bytes: Uint8Array): Promise<void> {
  const api = newApi();
  if (api) {
    try {
      const file = new api.File(uri);
      file.create({ intermediates: true, overwrite: true });
      file.write(bytes);
      return;
    } catch { /* fall back to the base64 route below */ }
  }
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
}

/** Puts the finished backup file into the folder the owner chose (Drive, Downloads, USB): a file copy, not a second in-memory copy. */
export async function saveToSafDirectory(directoryUri: string, filename: string, localUri: string): Promise<string> {
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, filename, 'application/octet-stream');
  try { await FileSystem.copyAsync({ from: localUri, to: uri }); return uri; }
  catch {
    const bytes = await readBytes(localUri);
    await FileSystem.StorageAccessFramework.writeAsStringAsync(uri, bytesToBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
    return uri;
  }
}
