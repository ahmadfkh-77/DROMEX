import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

async function persistAsset(uri: string, folder: string): Promise<string> {
  if (!FileSystem.documentDirectory) throw new Error('Permanent app storage is unavailable.');
  const directory = `${FileSystem.documentDirectory}${folder}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
  const target = `${directory}${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
}

export async function pickPersistentImage(folder: string): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo-library permission is required.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.75 });
  if (result.canceled || !result.assets[0]) return null;
  return persistAsset(result.assets[0].uri, folder);
}

export async function capturePersistentImage(folder: string): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera permission is required.');
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 });
  if (result.canceled || !result.assets[0]) return null;
  return persistAsset(result.assets[0].uri, folder);
}

export async function imageUriToDataUrl(uri: string | null): Promise<string | null> {
  if (!uri) return null;
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const extension = uri.split('.').pop()?.toLowerCase();
  const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

// Long edge for a photo embedded in a PDF. Photos print in a two-column grid
// at 73mm tall, so 1000px is already about 300 DPI there.
const PRINT_PHOTO_WIDTH = 1000;
const PRINT_PHOTO_COMPRESSION = 0.68;

/**
 * Prepares a photo for embedding in a generated document.
 *
 * A camera capture is a full-sensor image: the picker's `quality` option sets
 * JPEG compression but never resolution. Embedding it raw means the print
 * WebView must decode roughly 48 MB of bitmap per photo, and a handful of
 * those exhausts its memory. It then abandons the render and still writes a
 * valid but completely blank PDF, with nothing thrown for the caller to catch.
 *
 * Resizing first cuts that to a few MB. Re-encoding as JPEG also corrects a
 * camera that writes HEIC, which `imageUriToDataUrl` would otherwise label
 * `image/jpeg` regardless of the real bytes.
 */
export async function photoDataUrlForPrint(uri: string | null): Promise<string | null> {
  if (!uri) return null;

  const reduced = await manipulateAsync(
    uri,
    [{ resize: { width: PRINT_PHOTO_WIDTH } }],
    { compress: PRINT_PHOTO_COMPRESSION, format: SaveFormat.JPEG, base64: true },
  );

  // Never fall back to the raw file here: that silently reintroduces the blank
  // page this function exists to prevent.
  if (!reduced.base64) throw new Error('A photo could not be prepared for the document.');

  return `data:image/jpeg;base64,${reduced.base64}`;
}

/**
 * Prepares several photos for embedding, one at a time.
 *
 * `photoDataUrlForPrint` decodes and resizes a full-resolution image.
 * Running several through `Promise.all` creates a peak-memory spike sized to
 * however many camera photos happen to be attached, which reintroduces the
 * same class of failure the single-photo fix exists to prevent. Processing
 * sequentially bounds peak memory to one photo at a time regardless of how
 * many are attached, at the cost of total preparation time rather than
 * reliability.
 *
 * Order is preserved: `results[i]` corresponds to `uris[i]`. A failure in any
 * one photo rejects the whole batch, matching the previous `Promise.all`
 * failure behaviour rather than silently dropping or skipping it.
 */
export async function photoDataUrlsForPrint(uris: (string | null)[]): Promise<(string | null)[]> {
  const results: (string | null)[] = [];
  for (const uri of uris) {
    results.push(await photoDataUrlForPrint(uri));
  }
  return results;
}
