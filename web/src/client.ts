import type { Request, ResponseMap, WorkerMessage } from "./worker/protocol";
// Inlined so it also starts inside editor webviews, which cannot load workers from their own URLs.
import GdsWorker from "./worker/gds.worker.ts?worker&inline";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Promise wrapper around the layout worker. */
export class LayoutClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  onProgress: ((stage: string, fraction: number) => void) | null = null;

  constructor() {
    this.worker = new GdsWorker();
    this.worker.onerror = (e) => {
      const message = e.message || "The layout worker stopped unexpectedly.";
      for (const p of this.pending.values()) p.reject(new Error(message));
      this.pending.clear();
    };
    this.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      const m = ev.data;
      if (m.kind === "progress") {
        this.onProgress?.(m.stage, m.fraction);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.kind === "result") p.resolve(m.result);
      else p.reject(new Error(m.message));
    };
  }

  call<T extends Request["type"]>(req: Extract<Request, { type: T }>, transfer: Transferable[] = []): Promise<ResponseMap[T]> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }
}

/** Keeps only the latest call of a kind alive, so fast hover or pan events do not queue up. */
export function latest<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  let token = 0;
  return async (...a: A): Promise<R | undefined> => {
    const mine = ++token;
    const r = await fn(...a);
    return mine === token ? r : undefined;
  };
}
