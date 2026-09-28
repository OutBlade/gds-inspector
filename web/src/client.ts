import type { Request, ResponseMap, WorkerMessage } from "./worker/protocol";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Promise wrapper around the layout worker. */
export class LayoutClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  onProgress: ((stage: string, fraction: number) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL("./worker/gds.worker.ts", import.meta.url), { type: "module" });
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
