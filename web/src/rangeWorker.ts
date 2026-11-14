import { computeChunk } from './rangeMap';

export interface WorkerRequest {
  id: number;
  chunk: Int16Array;
  years: number[];
  nc: number;
  scale: number;
  /** Added back to each stored value (ozone). */
  offset?: number;
}
export type WorkerMessage =
  | { id: number; type: 'progress'; done: number }
  | { id: number; type: 'done'; slope: Float64Array; p: Float64Array };

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, chunk, years, nc, scale, offset } = e.data;
  let lastPost = 0;
  const stats = computeChunk(chunk, years, nc, scale, (done) => {
    const now = performance.now();
    if (now - lastPost > 80 && done < nc) {
      lastPost = now;
      ctx.postMessage({ id, type: 'progress', done } satisfies WorkerMessage);
    }
  }, offset ?? 0);
  ctx.postMessage({ id, type: 'done', slope: stats.slope, p: stats.p } satisfies WorkerMessage, [
    stats.slope.buffer,
    stats.p.buffer,
  ]);
};
