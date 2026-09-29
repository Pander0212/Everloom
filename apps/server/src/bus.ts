/** In-process pub/sub used for SSE fan-out so every open device stays in sync. */
export interface BusEvent {
  type: string;
  data: unknown;
  /** Client id that caused the event (so it can skip echoing its own changes). */
  origin?: string;
}

type Listener = (e: BusEvent) => void;

export class Bus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(ownerId: string, fn: Listener): () => void {
    if (!this.listeners.has(ownerId)) this.listeners.set(ownerId, new Set());
    this.listeners.get(ownerId)!.add(fn);
    return () => this.listeners.get(ownerId)?.delete(fn);
  }

  publish(ownerId: string, type: string, data: unknown, origin?: string) {
    const set = this.listeners.get(ownerId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn({ type, data, origin });
      } catch {
        /* a broken listener must not break others */
      }
    }
  }

  count(ownerId: string): number {
    return this.listeners.get(ownerId)?.size ?? 0;
  }
}
