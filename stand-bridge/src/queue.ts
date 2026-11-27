// Offline queue: keeps up to 100 unsent reads on disk and flushes them in batches.
// Each event has a stable id, so the server ignores repeats after a lost response.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export type ReadEvent = { eventId: string; readAt: number; picc?: string; cmac?: string; uid?: string };

export class EventQueue {
  private items: ReadEvent[] = [];
  private path: string;
  private max: number;
  constructor(path: string, max = 100) {
    this.path = path;
    this.max = max;
    if (existsSync(path)) {
      try {
        this.items = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        this.items = [];
      }
    }
  }

  push(e: Omit<ReadEvent, 'eventId'>): ReadEvent {
    const ev = { eventId: randomUUID(), ...e };
    this.items.push(ev);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max); // drop oldest
    this.save();
    return ev;
  }

  peek(n = 100): ReadEvent[] {
    return this.items.slice(0, n);
  }

  remove(ids: Set<string>) {
    this.items = this.items.filter((e) => !ids.has(e.eventId));
    this.save();
  }

  get size() {
    return this.items.length;
  }

  private save() {
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.items));
    renameSync(tmp, this.path);
  }
}

export type Sender = (events: ReadEvent[]) => Promise<{ eventId: string; status: string }[]>;

/** Send what's queued; keep anything the server didn't acknowledge. Returns statuses for logging. */
export async function flush(q: EventQueue, send: Sender): Promise<{ eventId: string; status: string }[]> {
  const batch = q.peek(100);
  if (batch.length === 0) return [];
  const results = await send(batch);
  q.remove(new Set(results.filter((r) => r.status !== 'invalid').map((r) => r.eventId)));
  return results;
}
