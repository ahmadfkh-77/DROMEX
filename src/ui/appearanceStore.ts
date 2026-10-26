import Storage from 'expo-sqlite/kv-store';
import {
  DEFAULT_SKYLINE_STYLE,
  SKYLINE_IMAGE_KEY,
  SKYLINE_STYLE_KEY,
  isSkylineImageValue,
  parseSkylineStyle,
  type SkylineStyle,
} from '../domain/appearance';

export type Appearance = { style: SkylineStyle; image: string | null };

/** Reads the saved Home appearance. A missing or unreadable preference gives the default skyline, never an error on Home. */
export async function loadAppearance(): Promise<Appearance> {
  try {
    const [style, image] = await Promise.all([Storage.getItem(SKYLINE_STYLE_KEY), Storage.getItem(SKYLINE_IMAGE_KEY)]);
    return { style: parseSkylineStyle(style), image: isSkylineImageValue(image) ? image : null };
  } catch {
    return { style: DEFAULT_SKYLINE_STYLE, image: null };
  }
}

export async function saveSkylineStyle(style: SkylineStyle): Promise<void> {
  await Storage.setItem(SKYLINE_STYLE_KEY, style);
}

export async function saveSkylineImage(dataUrl: string): Promise<void> {
  if (!isSkylineImageValue(dataUrl)) throw new Error('That picture could not be saved.');
  await Storage.setItem(SKYLINE_IMAGE_KEY, dataUrl);
}
