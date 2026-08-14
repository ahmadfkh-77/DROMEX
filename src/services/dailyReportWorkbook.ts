import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';

import { type DailyProjectReport, type LinkedProjectLoad, type LinkedWasteDump, type ProjectReportSetup, type ReportProject } from '../domain/projectReports';
import { encodeWorkbookBytes, type EmbeddedWorkbookImage, type WorkbookLocale, type WorkbookProgress } from './businessWorkbook';
import {buildDailyReportWorkbook} from './dailyReportWorkbookCore';
export {buildDailyReportWorkbook,dailyReportWorkbookSheets} from './dailyReportWorkbookCore';

export type DailyReportWorkbookOptions = { locale?: WorkbookLocale; signal?: AbortSignal; onProgress?: (progress: WorkbookProgress) => void };
const cancelled = () => { const error = new Error('Workbook export cancelled.'); error.name = 'AbortError'; return error; };
const checkCancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw cancelled(); };
async function reducedPhoto(uri: string, index: number): Promise<EmbeddedWorkbookImage> {
  const result = await manipulateAsync(uri, [{ resize: { width: 1000 } }], { compress: 0.68, format: SaveFormat.JPEG, base64: true });
  if (!result.base64) throw new Error(`Photo ${index + 1} could not be prepared for Excel.`);
  const binary = globalThis.atob(result.base64), bytes = new Uint8Array(binary.length);
  for (let position = 0; position < binary.length; position += 1) bytes[position] = binary.charCodeAt(position);
  return { name: `Daily report photo ${index + 1}`, bytes, extension: 'jpeg', row: 2 + index * 18, column: 0 };
}

export async function exportAndShareDailyReportWorkbook(report: DailyProjectReport, project: ReportProject, loads: LinkedProjectLoad[], waste: LinkedWasteDump[], company: ProjectReportSetup['company'], options: DailyReportWorkbookOptions = {}) {
  if (!FileSystem.documentDirectory) throw new Error('Document storage is unavailable.');
  const locale = options.locale ?? 'en', directory = `${FileSystem.documentDirectory}exports/`, safeProject = project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Project';
  const target = `${directory}Daily-Report-${safeProject}-${report.workDate}-${locale}.xlsx`, partial = `${target}.partial`; let finalized = false;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  try {
    const images: EmbeddedWorkbookImage[] = [];
    for (let index = 0; index < report.photos.length; index += 1) { checkCancelled(options.signal); options.onProgress?.({ stage: 'preparing', completed: index, total: report.photos.length, percent: 5 + Math.round(index / Math.max(1, report.photos.length) * 35), message: `Reducing photo ${index + 1} of ${report.photos.length}` }); images.push(await reducedPhoto(report.photos[index]!, index)); }
    checkCancelled(options.signal); options.onProgress?.({ stage: 'building', completed: 0, total: 7, percent: 45, message: 'Building daily report worksheets' });
    const bytes = buildDailyReportWorkbook(report, project, loads, waste, company, images, locale); checkCancelled(options.signal);
    options.onProgress?.({ stage: 'encoding', completed: 1, total: 1, percent: 85, message: 'Encoding daily report workbook' }); const base64 = encodeWorkbookBytes(bytes); checkCancelled(options.signal);
    await FileSystem.deleteAsync(partial, { idempotent: true }); await FileSystem.writeAsStringAsync(partial, base64, { encoding: FileSystem.EncodingType.Base64 }); checkCancelled(options.signal);
    await FileSystem.deleteAsync(target, { idempotent: true }); await FileSystem.moveAsync({ from: partial, to: target }); finalized = true;
    options.onProgress?.({ stage: 'encoding', completed: 1, total: 1, percent: 100, message: 'Daily report workbook ready' });
    if (!(await Sharing.isAvailableAsync())) throw new Error(`Workbook saved at ${target}, but sharing is unavailable.`);
    await Sharing.shareAsync(target, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: locale === 'ar' ? 'مشاركة تقرير العمل اليومي' : 'Share Daily Project Report Excel' });
    return target;
  } catch (error) {
    await FileSystem.deleteAsync(partial, { idempotent: true }); if (options.signal?.aborted && finalized) await FileSystem.deleteAsync(target, { idempotent: true }); if (options.signal?.aborted) throw cancelled(); throw error;
  }
}
