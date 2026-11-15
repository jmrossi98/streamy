/**
 * Each show's current batch of downloads, remembered between the admin
 * Downloads panel's refreshes (the rules are nextShowBatches in
 * downloadGroupRules.ts). Server-side, in-process: one Node server, and a
 * restart only means a batch starts again from what is still in flight.
 */
import { batchProgress, nextShowBatches, type GroupableRow, type KeyedRow, type ShowBatches } from "./downloadGroupRules";

let batches: ShowBatches = new Map();

/** Show id -> how far its batch has got, 0-100, for this refresh's rows. */
export function showBatchProgress(rows: (GroupableRow & KeyedRow)[], now = Date.now()): Map<number, number> {
  batches = nextShowBatches(batches, rows, now);
  const out = new Map<number, number>();
  for (const [showId, members] of batches) {
    const progress = batchProgress(members);
    if (progress != null) out.set(showId, progress);
  }
  return out;
}
