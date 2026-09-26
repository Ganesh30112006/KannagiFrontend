// Keeps an open page in step with the server, and with the same person's other tabs.
//
// Changes this tab sends (an order, a stock tap, a payment tick) go through write(). That lets a sync
// reply that was already on its way when the change was made be recognised as stale and dropped,
// instead of briefly undoing the change on screen, and it syncs this tab and the other tabs at once.
import { useCallback, useEffect, useRef } from "react";

let writeCount = 0; // moves when a write starts and when it ends
let writesInFlight = 0;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null | undefined;

function notify() {
  for (const listener of listeners) listener();
}

/** Other tabs of this browser (same site): a change in one makes the others sync right away. */
function otherTabs(): BroadcastChannel | null {
  if (channel === undefined) {
    channel =
      typeof window !== "undefined" && "BroadcastChannel" in window
        ? new BroadcastChannel("knm-sync")
        : null;
    channel?.addEventListener("message", notify);
  }
  return channel;
}

/** Send a change to the server; afterwards this tab and the other tabs sync. */
export async function write<T>(send: () => Promise<T>): Promise<T> {
  writeCount++;
  writesInFlight++;
  try {
    return await send();
  } finally {
    writeCount++;
    writesInFlight--;
    notify();
    otherTabs()?.postMessage("changed");
  }
}

/** Take before a sync request; staleSince() afterwards says whether a write overlapped it. */
export const writeMark = () => writeCount;
export const staleSince = (mark: number) => writeCount !== mark || writesInFlight > 0;

const SOON_MS = 150; // lets a burst of taps or events become one sync
const MAX_BACKOFF_MS = 60_000;

/**
 * Runs `sync` every `everyMs` while the page is visible (every `hiddenEveryMs` while hidden, or not at
 * all when that is null), right away when the page comes back, the phone reconnects or a write
 * finishes, and never two at once. After failures it waits longer each time, up to a minute.
 */
export function useLiveSync(
  sync: () => Promise<void>,
  {
    enabled,
    everyMs,
    hiddenEveryMs = null,
  }: { enabled: boolean; everyMs: number; hiddenEveryMs?: number | null },
) {
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const timing = useRef({ everyMs, hiddenEveryMs });
  timing.current = { everyMs, hiddenEveryMs };
  // active: false once the page is gone, so a sync still in flight then doesn't schedule another.
  const state = useRef({ active: false, running: false, again: false, failures: 0, timer: 0 });
  const tick = useRef(async () => {});

  const schedule = useCallback((delay: number | null) => {
    window.clearTimeout(state.current.timer);
    if (delay !== null && state.current.active)
      state.current.timer = window.setTimeout(() => void tick.current(), delay);
  }, []);

  tick.current = async () => {
    const current = state.current;
    if (current.running) {
      current.again = true; // one more as soon as this one ends
      return;
    }
    const { everyMs: every, hiddenEveryMs: hiddenEvery } = timing.current;
    if (document.hidden && hiddenEvery === null) return; // resumes when the page is shown again
    current.running = true;
    let next: number | null = document.hidden ? hiddenEvery : every;
    try {
      await syncRef.current();
      current.failures = 0;
    } catch {
      current.failures++;
      next = Math.min(MAX_BACKOFF_MS, every * 2 ** current.failures);
    } finally {
      current.running = false;
    }
    if (current.again) {
      current.again = false;
      schedule(SOON_MS);
    } else {
      schedule(next);
    }
  };

  const syncSoon = useCallback(() => schedule(SOON_MS), [schedule]);

  useEffect(() => {
    if (!enabled) return;
    const current = state.current;
    current.active = true;
    const onVisibility = () => {
      if (!document.hidden) syncSoon();
    };
    const onOnline = () => {
      current.failures = 0;
      syncSoon();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) syncSoon();
    };
    otherTabs();
    listeners.add(syncSoon);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", syncSoon);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      current.active = false;
      listeners.delete(syncSoon);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", syncSoon);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      window.clearTimeout(current.timer);
    };
  }, [enabled, syncSoon]);

  // Start, and pick up a new pace (e.g. faster while a payment waits for the shopkeeper) at once.
  useEffect(() => {
    if (enabled) syncSoon();
  }, [enabled, everyMs, hiddenEveryMs, syncSoon]);

  return syncSoon;
}
