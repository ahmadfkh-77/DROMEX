/**
 * Appearance settings (DEC-530): the picture shown under the logo on Home. The choice and an optional picture of the owner's own are
 * kept as saved preferences. Every preference whose name starts with `dromex.` is carried inside a .dromexbackup package and put back
 * on restore, so both keys below must keep that prefix. The owner's picture is stored inside the preference itself as a small data
 * URL (not as a file) so it travels with the backup without any change to the backup format.
 */
export const SKYLINE_STYLE_KEY = 'dromex.appearance.skyline';
export const SKYLINE_IMAGE_KEY = 'dromex.appearance.skylineImage';

export const SKYLINE_STYLES = ['full', 'banner', 'asphalt', 'concrete', 'quarry', 'custom', 'hidden'] as const;
export type SkylineStyle = (typeof SKYLINE_STYLES)[number];
export const DEFAULT_SKYLINE_STYLE: SkylineStyle = 'full';

/** The widest side kept for the owner's own picture, and the longest saved data URL accepted for it. */
export const SKYLINE_IMAGE_MAX_WIDTH = 900;
export const SKYLINE_IMAGE_MAX_CHARS = 900_000;

export type SkylineOption = { style: SkylineStyle; label: string };

/** Display order of the choices on the Appearance screen. */
export const skylineOptions: readonly SkylineOption[] = [
  { style: 'full', label: 'Full skyline' },
  { style: 'banner', label: 'Navy banner' },
  { style: 'asphalt', label: 'Asphalt plant' },
  { style: 'concrete', label: 'Concrete plant' },
  { style: 'quarry', label: 'Quarry' },
  { style: 'custom', label: 'My own picture' },
  { style: 'hidden', label: 'Hidden' },
];

/** Unknown, missing or damaged saved values fall back to the default rather than hiding the header. */
export function parseSkylineStyle(value: string | null | undefined): SkylineStyle {
  return (SKYLINE_STYLES as readonly string[]).includes(value ?? '') ? (value as SkylineStyle) : DEFAULT_SKYLINE_STYLE;
}

export function isSkylineImageValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value) && value.length <= SKYLINE_IMAGE_MAX_CHARS;
}

/** What Home actually draws: "My own picture" without a usable picture shows the full skyline instead of an empty header. */
export function resolveSkylineStyle(style: SkylineStyle, image: string | null): SkylineStyle {
  return style === 'custom' && !isSkylineImageValue(image) ? DEFAULT_SKYLINE_STYLE : style;
}
