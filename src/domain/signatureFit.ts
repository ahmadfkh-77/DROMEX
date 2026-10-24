/**
 * DEC-524. Every saved signature lives in the 320 x 140 box the receipt, the Delivery Authorization and the PDFs print.
 * The bigger Make Receipt pad is taller than that box, so its strokes are fitted into it before they are saved: the
 * empty space around the signature is trimmed and the signature is scaled by one factor (never stretched) and centred.
 */
export const SIGNATURE_BOX = { width: 320, height: 140 } as const;

type Point = { x: number; y: number };

/** Reads the "M x y L x y …" paths the signature pad writes. Anything else in a path is ignored. */
function readPath(path: string): { command: string; point: Point }[] {
  const out: { command: string; point: Point }[] = [];
  const pattern = /([ML])\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  for (const match of path.matchAll(pattern)) out.push({ command: match[1]!, point: { x: Number(match[2]), y: Number(match[3]) } });
  return out;
}

/** Fits the signature into the printed box with a margin, keeping its shape. No strokes gives no strokes. */
export function fitSignatureToBox(paths: readonly string[], box: { width: number; height: number } = SIGNATURE_BOX, margin = 8): string[] {
  const parsed = paths.map(readPath).filter((segments) => segments.length > 0);
  const points = parsed.flat().map((segment) => segment.point);
  if (!points.length) return [];
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const width = maxX - minX, height = maxY - minY;
  const roomX = box.width - margin * 2, roomY = box.height - margin * 2;
  // A single dot has no size, so it is only moved to the centre.
  const scale = width === 0 && height === 0 ? 1 : Math.min(width ? roomX / width : Infinity, height ? roomY / height : Infinity);
  const offsetX = (box.width - width * scale) / 2, offsetY = (box.height - height * scale) / 2;
  const place = (p: Point) => `${((p.x - minX) * scale + offsetX).toFixed(1)} ${((p.y - minY) * scale + offsetY).toFixed(1)}`;
  return parsed.map((segments) => segments.map((segment) => `${segment.command} ${place(segment.point)}`).join(' '));
}
