import * as FileSystem from 'expo-file-system/legacy';
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
