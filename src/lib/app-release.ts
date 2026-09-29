// Staff pages (the shopkeeper's dashboard, /admin) stay open for days, and a Home Screen app has no
// reload button, so they would keep running an old release: no new features, old fixes missing. This
// notices a new release by comparing the page's main script with the one the site serves now. Coming
// back to the page after a while (nobody is in the middle of something then) reloads it at once;
// otherwise it offers a Reload button.
import { useEffect } from "react";
import { toast } from "sonner";

const MAIN_SCRIPT = /\/assets\/index-[\w-]+\.js/;
const CHECK_EVERY_MS = 10 * 60_000;
const AWAY_MS = 10 * 60_000; // hidden this long, then shown again: reload without asking

/** The main script this page runs (null on the dev server, which has none). */
function runningScript(): string | null {
  const script = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]',
  );
  return script ? (new URL(script.src).pathname.match(MAIN_SCRIPT)?.[0] ?? null) : null;
}

/** The main script the site serves now (null if that couldn't be told). */
async function servedScript(): Promise<string | null> {
  const response = await fetch("/", { cache: "no-store", credentials: "omit" });
  if (!response.ok) return null;
  return (await response.text()).match(MAIN_SCRIPT)?.[0] ?? null;
}

export function useNewRelease(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const running = runningScript();
    if (!running) return;
    let hiddenAt = document.hidden ? Date.now() : 0;
    let checking = false;
    let offered = false;

    async function check(cameBack: boolean) {
      if (checking) return;
      checking = true;
      try {
        const served = await servedScript();
        if (!served || served === running) return;
        if (cameBack) {
          window.location.reload();
          return;
        }
        if (!offered) {
          offered = true;
          toast.info("A new version of the Night Mart is ready.", {
            id: "new-release",
            duration: Infinity,
            action: { label: "Reload", onClick: () => window.location.reload() },
          });
        }
      } catch {
        // Offline or the site didn't answer: the next check will tell.
      } finally {
        checking = false;
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      void check(away >= AWAY_MS);
    };
    const timer = window.setInterval(() => {
      if (!document.hidden) void check(false);
    }, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
