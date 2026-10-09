/**
 * DEC-505. Diesel batches and their derived first-in-first-out allocation.
 *
 * A batch is one diesel delivery into the single tank. Equipment fills draw from the oldest batch that
 * still has diesel (or from the batch the user chose), splitting across batches when one runs out. The
 * allocation is never stored as the source of truth: it is recalculated from the active deliveries,
 * fills and dip readings in date order, so a cancellation, correction or back-dated entry always leaves
 * consistent batch figures. The tank balance is the sum of the batches' remaining litres.
 *
 * Everything here is pure; the repository decides what to load and what to persist.
 */
export type BatchRecordStatus = 'Active' | 'Cancelled';
export type BatchStatus = 'in_use' | 'waiting' | 'closed' | 'cancelled';

export type BatchInput = {
  id: string;
  batchNumber: string;
  arrivedAt: string;
  deliveredLitres: number;
  pricePerLitreUsd: number | null;
  status: BatchRecordStatus;
};
export type FillInput = { id: string; confirmedAt: string; litres: number; preferredBatchId?: string | null };
export type GaugeInput = { id: string; confirmedAt: string; litres: number };

/** `cover`: litres of a later batch that cover fuel an earlier fill used before any delivery could supply it. */
export type PortionKind = 'fill' | 'cover';
export type Portion = { batchId: string; batchNumber: string; litres: number; kind: PortionKind };
export type FillAllocation = { fillId: string; portions: Portion[]; shortfallLitres: number; outstandingShortfallLitres: number };
export type AdjustmentRecord = { gaugeId: string; batchId: string; litres: number; calculatedLitres: number; dipLitres: number; confirmedAt: string };
export type BatchSummary = {
  id: string;
  batchNumber: string;
  arrivedAt: string;
  deliveredLitres: number;
  pricePerLitreUsd: number | null;
  filledLitres: number;
  adjustmentLitres: number;
  remainingLitres: number;
  status: BatchStatus;
};
export type AllocationInput = { batches: BatchInput[]; fills: FillInput[]; gauges: GaugeInput[] };
export type AllocationResult = {
  batches: BatchSummary[];
  fills: Record<string, FillAllocation>;
  adjustments: AdjustmentRecord[];
  tankLitres: number;
  outstandingShortfallLitres: number;
  overfillAlert: boolean;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const round2 = (value: number) => Math.round(value * 100) / 100;
/** Below this many litres a quantity counts as zero, so floating-point dust never keeps a batch open. */
const EPSILON = 0.0005;

export function formatBatchNumber(year: number, sequence: number): string {
  return `DSL-${year}-${String(sequence).padStart(5, '0')}`;
}

export const batchStatusLabels: Record<BatchStatus, string> = {
  in_use: 'Open · In use',
  waiting: 'Open · Waiting',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

type Working = { input: BatchInput; arrived: boolean; remaining: number; filled: number; adjustment: number };
type Outstanding = { fillId: string; left: number };
type Event =
  | { at: string; order: 0; id: string; kind: 'arrival'; batch: Working }
  | { at: string; order: 1; id: string; kind: 'gauge'; gauge: GaugeInput }
  | { at: string; order: 2; id: string; kind: 'fill'; fill: FillInput };

export function allocateDieselBatches(input: AllocationInput): AllocationResult {
  const working = new Map<string, Working>();
  const active = input.batches.filter((batch) => batch.status === 'Active').sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.batchNumber.localeCompare(b.batchNumber));
  for (const batch of active) working.set(batch.id, { input: batch, arrived: false, remaining: 0, filled: 0, adjustment: 0 });
  const order = active.map((batch) => working.get(batch.id)!);

  // Records with the same timestamp keep the order they were supplied in (entry order), never a random one.
  const events: Event[] = [
    ...order.map((batch): Event => ({ at: batch.input.arrivedAt, order: 0, id: batch.input.id, kind: 'arrival', batch })),
    ...input.gauges.map((gauge): Event => ({ at: gauge.confirmedAt, order: 1, id: gauge.id, kind: 'gauge', gauge })),
    ...input.fills.map((fill): Event => ({ at: fill.confirmedAt, order: 2, id: fill.id, kind: 'fill', fill })),
  ].map((event, index) => ({ event, index })).sort((a, b) => a.event.at.localeCompare(b.event.at) || a.event.order - b.event.order || a.index - b.index).map(({ event }) => event);

  const fills: Record<string, FillAllocation> = {};
  const adjustments: AdjustmentRecord[] = [];
  const outstanding: Outstanding[] = [];
  const arrived = () => order.filter((batch) => batch.arrived);
  const open = () => arrived().filter((batch) => batch.remaining > EPSILON);

  for (const event of events) {
    if (event.kind === 'arrival') {
      const batch = event.batch;
      batch.arrived = true;
      batch.remaining = round3(batch.input.deliveredLitres);
      // Fuel an earlier fill used before any delivery could supply it is covered by the first litres to arrive.
      for (const pending of outstanding) {
        const take = round3(Math.min(pending.left, batch.remaining));
        if (take <= EPSILON) continue;
        fills[pending.fillId]!.portions.push({ batchId: batch.input.id, batchNumber: batch.input.batchNumber, litres: take, kind: 'cover' });
        batch.filled = round3(batch.filled + take);
        batch.remaining = round3(batch.remaining - take);
        pending.left = round3(pending.left - take);
      }
    } else if (event.kind === 'gauge') {
      const calculated = round3(arrived().reduce((sum, batch) => sum + batch.remaining, 0));
      const difference = round3(event.gauge.litres - calculated);
      if (difference < -EPSILON) {
        let need = -difference;
        for (const batch of open()) {
          const take = round3(Math.min(need, batch.remaining));
          if (take <= EPSILON) continue;
          adjustments.push({ gaugeId: event.gauge.id, batchId: batch.input.id, litres: -take, calculatedLitres: calculated, dipLitres: event.gauge.litres, confirmedAt: event.gauge.confirmedAt });
          batch.adjustment = round3(batch.adjustment - take);
          batch.remaining = round3(batch.remaining - take);
          need = round3(need - take);
        }
      } else if (difference > EPSILON) {
        const target = open()[0] ?? arrived().at(-1);
        if (target) {
          adjustments.push({ gaugeId: event.gauge.id, batchId: target.input.id, litres: difference, calculatedLitres: calculated, dipLitres: event.gauge.litres, confirmedAt: event.gauge.confirmedAt });
          target.adjustment = round3(target.adjustment + difference);
          target.remaining = round3(target.remaining + difference);
        }
      }
      // A gauge reading resets the tank balance, so earlier unrecorded excess is no longer outstanding.
      for (const pending of outstanding) pending.left = 0;
    } else {
      const { fill } = event;
      const allocation: FillAllocation = { fillId: fill.id, portions: [], shortfallLitres: 0, outstandingShortfallLitres: 0 };
      fills[fill.id] = allocation;
      const candidates = open();
      const preferred = fill.preferredBatchId ? candidates.find((batch) => batch.input.id === fill.preferredBatchId) : undefined;
      const queue = preferred ? [preferred, ...candidates.filter((batch) => batch !== preferred)] : candidates;
      let need = round3(fill.litres);
      for (const batch of queue) {
        if (need <= EPSILON) break;
        const take = round3(Math.min(need, batch.remaining));
        if (take <= EPSILON) continue;
        allocation.portions.push({ batchId: batch.input.id, batchNumber: batch.input.batchNumber, litres: take, kind: 'fill' });
        batch.filled = round3(batch.filled + take);
        batch.remaining = round3(batch.remaining - take);
        need = round3(need - take);
      }
      if (need > EPSILON) {
        allocation.shortfallLitres = need;
        outstanding.push({ fillId: fill.id, left: need });
      }
    }
  }

  for (const pending of outstanding) fills[pending.fillId]!.outstandingShortfallLitres = round3(pending.left);

  const firstOpen = order.find((batch) => batch.remaining > EPSILON);
  const summaries: BatchSummary[] = input.batches
    .map((batch): BatchSummary => {
      const state = working.get(batch.id);
      if (!state) {
        return { id: batch.id, batchNumber: batch.batchNumber, arrivedAt: batch.arrivedAt, deliveredLitres: batch.deliveredLitres, pricePerLitreUsd: batch.pricePerLitreUsd, filledLitres: 0, adjustmentLitres: 0, remainingLitres: 0, status: 'cancelled' };
      }
      const status: BatchStatus = state.remaining <= EPSILON ? 'closed' : state === firstOpen ? 'in_use' : 'waiting';
      return { id: batch.id, batchNumber: batch.batchNumber, arrivedAt: batch.arrivedAt, deliveredLitres: batch.deliveredLitres, pricePerLitreUsd: batch.pricePerLitreUsd, filledLitres: state.filled, adjustmentLitres: state.adjustment, remainingLitres: state.remaining, status };
    })
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.batchNumber.localeCompare(b.batchNumber));

  const outstandingShortfallLitres = round3(outstanding.reduce((sum, pending) => sum + pending.left, 0));
  return {
    batches: summaries,
    fills,
    adjustments,
    tankLitres: round3(order.reduce((sum, batch) => sum + batch.remaining, 0)),
    outstandingShortfallLitres,
    overfillAlert: outstandingShortfallLitres > EPSILON,
  };
}

export type FillCost = { costUsd: number | null; pricedLitres: number; unpricedLitres: number; fullyPriced: boolean };

/**
 * The cost of one fill from its batch portions. A portion of an unpriced batch, and any shortfall, is
 * counted as unpriced litres: a missing price is never treated as zero cost.
 */
export function fillCost(allocation: FillAllocation, batches: Pick<BatchSummary, 'id' | 'pricePerLitreUsd'>[]): FillCost {
  const prices = new Map(batches.map((batch) => [batch.id, batch.pricePerLitreUsd]));
  let cost = 0;
  let priced = 0;
  let unpriced = allocation.outstandingShortfallLitres;
  for (const portion of allocation.portions) {
    const price = prices.get(portion.batchId) ?? null;
    if (price == null) unpriced += portion.litres;
    else {
      cost += portion.litres * price;
      priced += portion.litres;
    }
  }
  unpriced = round3(unpriced);
  return { costUsd: priced > 0 ? round2(cost) : null, pricedLitres: round3(priced), unpricedLitres: unpriced, fullyPriced: unpriced <= EPSILON && priced > 0 };
}

export type FillPreview = {
  portions: { batchId: string; batchNumber: string; litres: number; closesBatch: boolean; remainingAfterLitres: number; statusBefore: BatchStatus }[];
  shortfallLitres: number;
  tankBeforeLitres: number;
  tankAfterLitres: number;
  overfillAlert: boolean;
};

/** What a tank fill would do, for the "Before you save" panel: the same allocation with one extra fill. */
export function previewTankFill(state: AllocationInput, fill: { litres: number; preferredBatchId: string | null; at: string }): FillPreview {
  const before = allocateDieselBatches(state);
  const previewId = '__preview__';
  const after = allocateDieselBatches({ ...state, fills: [...state.fills, { id: previewId, confirmedAt: fill.at, litres: fill.litres, preferredBatchId: fill.preferredBatchId }] });
  const allocation = after.fills[previewId]!;
  return {
    portions: allocation.portions.map((portion) => {
      const remainingAfterLitres = after.batches.find((batch) => batch.id === portion.batchId)?.remainingLitres ?? 0;
      return {
        batchId: portion.batchId,
        batchNumber: portion.batchNumber,
        litres: portion.litres,
        closesBatch: remainingAfterLitres <= EPSILON,
        remainingAfterLitres,
        statusBefore: before.batches.find((batch) => batch.id === portion.batchId)?.status ?? 'waiting',
      };
    }),
    shortfallLitres: allocation.shortfallLitres,
    tankBeforeLitres: before.tankLitres,
    tankAfterLitres: after.tankLitres,
    overfillAlert: after.overfillAlert,
  };
}

/** DEC-506. One saved change to a batch: free details (supplier, invoice, price) or a reasoned correction. */
export type BatchCorrectionChange = { field: string; originalValue: string | null; newValue: string | null };
export type BatchCorrectionEntry = { correctedAt: string; kind: 'details' | 'correction'; reason: string; changes: BatchCorrectionChange[] };
export type BatchDetail = BatchSummary & {
  kind: 'delivery' | 'opening';
  invoiceNumber: string | null;
  supplierId?: string | null;
  supplierName: string | null;
  /** The delivery's total with VAT as recorded; null when Unpriced and for an Opening stock batch (never a purchase). */
  finalTotalUsd?: number | null;
  history?: BatchCorrectionEntry[];
  openingBasis: 'dip' | 'calculated' | null;
  deliveryMovementId: string | null;
  openingGaugeMovementId: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
};
export type FillBatchInfo = FillAllocation & { cost: FillCost };
export type AdjustmentDetail = AdjustmentRecord & { batchNumber: string };
/** One earlier fill whose batches changed because of a later entry; the note is never hidden. */
export type AllocationChange = { id: number; movementId: string; causedByMovementId: string | null; before: AllocationNoteLine[]; after: AllocationNoteLine[]; createdAt: string };
export type AllocationNoteLine = { batch: string | null; litres: number; kind: PortionKind | 'shortfall' };
export type DieselBatchOverview = {
  started: boolean;
  startedAt: string | null;
  /** The sum of the batches' remaining litres once tracking has started; the ledger balance before that. */
  tankLitres: number;
  overfillAlert: boolean;
  outstandingShortfallLitres: number;
  batches: BatchDetail[];
  /** Allocation of every tracked tank fill, by fill id. Fills before tracking started or from outside stations are absent. */
  fills: Record<string, FillBatchInfo>;
  adjustments: AdjustmentDetail[];
  changes: AllocationChange[];
};
/** DEC-506. What the Edit Batch screen sends. Supplier, invoice and price are free; litres and date need a reason. */
export type BatchEditDraft = { supplierId: string; invoiceNumber: string; pricePerLitreUsd: string; litres: string; recordDate: string; reason: string };

/** The quantity of a batch can never go below what has already been used from it. */
export function minimumBatchLitres(batch: Pick<BatchSummary, 'filledLitres'>): number {
  return round3(batch.filledLitres);
}
export function batchLitresIssue(litres: number, batch: Pick<BatchSummary, 'filledLitres'>): string | null {
  const minimum = minimumBatchLitres(batch);
  if (litres < minimum - EPSILON) return `The quantity cannot be below the ${minimum.toLocaleString('en-US', { maximumFractionDigits: 3 })} L already used from this batch.`;
  return null;
}
export type StartDieselBatchesDraft = { dipLitres: string; pricePerLitreUsd: string };
export type TankFillPreviewDraft = { litres: string; batchId: string; recordDate: string };
export type TankFillPreviewResult = FillPreview & { cost: FillCost };
