import { effect, signal } from "@preact/signals";
import type { Diagram } from "../core/model";
import { ApiError, saveDiagram } from "./api";
import { diagram } from "./state";

export type Status = "saved" | "unsaved" | "error" | "conflict";
export const status = signal<Status>("saved");

const DEBOUNCE_MS = 1000;

type Session = { name: string; etag: string; saved: Diagram; stopped: boolean };

let session: Session | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<void> | null = null;
let queued = false;

export function startSession(name: string, etag: string) {
  clearTimeout(timer);
  queued = false;
  session = { name, etag, saved: diagram.peek(), stopped: false };
  status.value = "saved";
}

export function endSession() {
  clearTimeout(timer);
  queued = false;
  session = null;
  status.value = "saved";
}

export function renameSession(name: string) {
  if (session) session.name = name;
}

effect(() => {
  const d = diagram.value;
  const s = session;
  if (!s || d === s.saved || s.stopped) return;
  status.value = "unsaved";
  clearTimeout(timer);
  timer = setTimeout(() => void save(false), DEBOUNCE_MS);
});

function save(force: boolean): Promise<void> {
  if (inflight) {
    queued = true;
    return inflight;
  }
  const s = session;
  const d = diagram.peek();
  if (!s || (!force && (d === s.saved || s.stopped))) return Promise.resolve();
  const pre = force ? null : { ifMatch: s.etag };
  inflight = (async () => {
    try {
      s.etag = await saveDiagram(s.name, d, pre);
      s.saved = d;
      s.stopped = false;
      if (session === s) status.value = diagram.peek() === d ? "saved" : "unsaved";
    } catch (e) {
      if (session !== s) return;
      if (e instanceof ApiError && e.status === 412) {
        s.stopped = true;
        queued = false;
        status.value = "conflict";
      } else {
        status.value = "error";
      }
    } finally {
      inflight = null;
      if (queued && session === s) {
        queued = false;
        void save(false);
      }
    }
  })();
  return inflight;
}

export async function saveNow() {
  clearTimeout(timer);
  queued = false;
  await inflight;
  await save(session?.stopped ?? false);
}

export async function flush() {
  clearTimeout(timer);
  queued = false;
  await inflight;
  await save(false);
  await inflight;
}

export async function cancel() {
  clearTimeout(timer);
  queued = false;
  await inflight;
}

addEventListener("pagehide", () => {
  const s = session;
  if (!s || s.stopped || diagram.peek() === s.saved) return;
  saveDiagram(s.name, diagram.peek(), { ifMatch: s.etag }, { keepalive: true }).catch(() => {});
});
