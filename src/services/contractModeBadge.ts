import {contractTrackingLabel,type ContractTrackingMode} from '../domain/contractQuantities';

/**
 * DEC-556. The small badge printed beside a Quantity Target's name in every report: AUTOMATIC (green), LINKED MANUAL (amber) or MANUAL
 * (orange). The colours match the screens; the words say the same thing, so a black and white print still reads. Inline style, so every
 * template can use it without touching its own stylesheet. A target without a mode (saved before modes existed) is AUTOMATIC.
 */
const COLOURS:Record<ContractTrackingMode,string>={automatic:'#1E7B4B',linked_manual:'#B7791F',manual:'#D9571F'};

export function contractModeBadgeHtml(mode:ContractTrackingMode|undefined):string{
  const value=mode??'automatic';
  return `<span style="display:inline-block;margin-left:1.5mm;padding:.3mm 1.4mm;border-radius:1mm;background:${COLOURS[value]};color:#fff;font-size:6pt;font-weight:700;letter-spacing:.4px;vertical-align:1px;white-space:nowrap">${contractTrackingLabel(value)}</span>`;
}
