/**
 * One width rule for every list table in the PDFs. A column gets room for its longest unbreakable word (a plate, a date, a
 * number with its unit, a part of a load code between hyphens), and the rest of the page is shared by the columns in
 * proportion to how much text they usually hold. The widths are whole percentages that add up to exactly 100, so nothing
 * runs into the next column and no column keeps empty space it does not need.
 */
export type ColumnSpec = {
  header: string;
  /** The plain text of every cell in the column (no HTML). */
  cells: readonly string[];
  /**
   * `number`: right-aligned and never wrapped, so its whole text must fit. `code`: a load code that may break after a hyphen.
   * `amount`: right-aligned money or a price phrase that may wrap at its spaces, so only its longest word must fit and it takes
   * no more of the page than a number.
   */
  kind?: 'text' | 'number' | 'code' | 'amount';
};

export type ColumnWidthOptions = {
  /** Width the table has, in millimetres. A4 with 11 mm margins and a 3 mm block padding is about 180. */
  contentMm?: number;
  /** Body font size in points. */
  fontPt?: number;
  /** Heading font size in points. */
  headerPt?: number;
};

/** Average width of a character of Arial as a fraction of the font size, wide enough for capitals and digits. */
const CHAR_EM = 0.62;
const PT_MM = 25.4 / 72;
/** Left and right cell padding plus a little slack, in millimetres. */
const PADDING_MM = 3.8;

const longest = (values: readonly string[]) => values.reduce((max, value) => Math.max(max, value.length), 0);

/** The longest piece of text that cannot be broken: a word, or for a code the part between hyphens. */
function longestUnbreakable(text: string, kind: ColumnSpec['kind']): number {
  if (kind === 'number') return text.trim().length;
  const pieces = text.split(/\s+/).flatMap((word) => (kind === 'code' ? word.split('-').map((part, index, all) => (index < all.length - 1 ? `${part}-` : part)) : [word]));
  return longest(pieces);
}

export function columnWidths(columns: readonly ColumnSpec[], options: ColumnWidthOptions = {}): number[] {
  if (!columns.length) return [];
  const contentMm = options.contentMm ?? 180, fontPt = options.fontPt ?? 8, headerPt = options.headerPt ?? 7;
  const bodyChar = fontPt * PT_MM * CHAR_EM, headerChar = headerPt * PT_MM * CHAR_EM * 1.1;
  const minimums = columns.map((column) => {
    const body = column.cells.reduce((max, cell) => Math.max(max, longestUnbreakable(cell, column.kind)), 0);
    const header = column.kind === 'number' ? column.header.length : longestUnbreakable(column.header, 'text');
    return Math.max(body * bodyChar, header * headerChar) + PADDING_MM;
  });
  const weights = columns.map((column) => {
    if (column.kind === 'number') return Math.max(3, longest(column.cells) * 0.4);
    if (column.kind === 'amount') return Math.max(3, longest(column.cells) * 0.3);
    const average = column.cells.length ? column.cells.reduce((sum, cell) => sum + cell.length, 0) / column.cells.length : 6;
    return Math.min(26, Math.max(5, column.kind === 'code' ? average * 0.55 : average));
  });
  const minimumTotal = minimums.reduce((a, b) => a + b, 0);
  const spare = Math.max(0, contentMm - minimumTotal);
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  // When even the minimums do not fit, they shrink together and the longest words may break inside the word.
  const scale = minimumTotal > contentMm ? contentMm / minimumTotal : 1;
  const millimetres = minimums.map((minimum, index) => minimum * scale + spare * weights[index]! / weightTotal);
  return wholePercents(millimetres);
}

/** Whole percentages in proportion to `values`, adding up to exactly 100 (the largest remainders take the spare points). */
export function wholePercents(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!values.length || !(total > 0)) return values.map(() => 0);
  const exact = values.map((value) => value / total * 100);
  const result = exact.map(Math.floor);
  let spare = 100 - result.reduce((a, b) => a + b, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) { if (spare <= 0) break; result[index]! += 1; spare -= 1; }
  return result;
}

export const colgroup = (widths: readonly number[]) => `<colgroup>${widths.map((width) => `<col style="width:${width}%"/>`).join('')}</colgroup>`;

/** A load code (already HTML-escaped) that may break after each hyphen; a hyphen followed by a digit would otherwise never break. */
export const breakAfterHyphens = (escaped: string) => escaped.replace(/-/g, '-<wbr>');
