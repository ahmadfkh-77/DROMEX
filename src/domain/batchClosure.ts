import {localDateKey} from './fuel';

/**
 * Close a batch by hand. A Bitumen, Diesel or Stock batch normally closes by itself when it runs out. The Owner can also close one that
 * still has a little left, so the next batch takes over and the records stay traceable. The leftover is kept with the reason and the date;
 * a closure is reopened with a reason and stays in the batch's history. Everything here is pure.
 */
export type BatchClosureKind='bitumen'|'diesel'|'stock';

/** One closure as the screens and reports show it. Only a closure that has not been reopened keeps a batch closed. */
export type BatchClosure={
  id:string;batchId:string;
  /** The day the Owner closed the batch (a calendar date, YYYY-MM-DD). */
  closedOn:string;
  /** The moment the closure takes effect. Loads and fills made after it do not use the batch. */
  closedAt:string;
  /** What was left when it was closed, in the batch's own unit (kg, litres or the item's unit). */
  leftover:number;
  reason:string;createdAt:string;
  reopenedAt:string|null;reopenReason:string|null;
};

/** The closure that is in force on a batch: the latest one that was not reopened. */
export const activeClosure=(closures:readonly BatchClosure[],batchId:string):BatchClosure|null=>closures.find(closure=>closure.batchId===batchId&&!closure.reopenedAt)??null;

/**
 * When a closure on `closedOn` takes effect. Closing today takes effect now, so a load already confirmed today still counts against the batch
 * it was made from; a past day takes effect at the end of that day. A future day is not allowed.
 */
export function closureMoment(closedOn:string,now:Date=new Date()):string{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(closedOn))throw new Error('Choose the day the batch was closed.');
  const today=localDateKey(now);
  if(closedOn>today)throw new Error('A batch cannot be closed on a future day.');
  if(closedOn===today)return now.toISOString();
  const [year=0,month=0,day=0]=closedOn.split('-').map(Number);
  const end=new Date(year,month-1,day,23,59,59,999);
  if(localDateKey(end)!==closedOn)throw new Error('Choose a valid day.');
  return end.toISOString();
}

export function validateClosureReason(reason:string,what='closing'):string{
  const value=reason.trim().replace(/\s+/g,' ');
  if(!value)throw new Error(`Enter the reason for ${what} this batch.`);
  return value;
}

/** The line shown under a closed batch: what was left over and why. */
export function closureText(closure:Pick<BatchClosure,'leftover'|'closedOn'|'reason'>,format:(value:number)=>string):string{
  const left=closure.leftover>0.0005?`${format(closure.leftover)} left over, closed by hand`:'Closed by hand with nothing left';
  return `${left} · ${closure.closedOn} · ${closure.reason}`;
}

/** Whether a batch can supply a use dated `day`: not before it arrived, and not after it was closed. */
export const supplyOpenOn=(closure:Pick<BatchClosure,'closedOn'>|null|undefined,day:string)=>!closure||day<=closure.closedOn;
