// Order alerts, at the top of the shopkeeper's page and of /admin (every tab): turns on a notification
// for each new order on this phone or laptop (see lib/order-alerts.ts), sends a test one, or turns them
// off. Until they're on it stands out, so nobody has to go looking for it.
import { useEffect, useState } from "react";
import { BellOff, BellRing, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  alertsState,
  sendTestAlert,
  turnOffAlerts,
  turnOnAlerts,
  type AlertsState,
} from "@/lib/order-alerts";

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const SAYS: Record<Exclude<AlertsState, "ios-home-screen">, string> = {
  checking: "Checking this device…",
  off: "Get a notification on this phone or laptop for every new order, even when the website is closed.",
  on: "On for this device: every new order pops up here, even when the website is closed.",
  blocked:
    "Notifications are blocked for this site on this device. Allow them in the browser's site settings (tap the icon next to the web address), then reload this page.",
  unsupported:
    "This browser can't show order alerts. Open kannagimart.tech in Chrome (Android) or Safari (iPhone) itself, not inside WhatsApp or Instagram.",
  "not-set-up": "Order alerts aren't set up for this shop yet. Ask the admin to set them up.",
};

/** iPhone and iPad: only the Home Screen app can get alerts (iOS 16.4 or newer). */
function IosSteps() {
  return (
    <div className="mt-1 text-sm">
      <p className="font-bold">On iPhone, alerts work from the Home Screen app. In Safari:</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>
          Tap the <b>Share</b> button (the square with an arrow).
        </li>
        <li>
          Tap <b>Add to Home Screen</b>, then <b>Add</b>.
        </li>
        <li>
          Open <b>Night Mart</b> from the new icon, sign in, and tap <b>Turn on order alerts</b>{" "}
          here.
        </li>
      </ol>
      <p className="mt-1 text-xs text-muted-foreground">Needs iOS 16.4 or newer.</p>
    </div>
  );
}

export function OrderAlertsCard() {
  const [state, setState] = useState<AlertsState>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    alertsState().then(
      (next) => current && setState(next),
      () => current && setState("off"),
    );
    return () => {
      current = false;
    };
  }, []);

  async function change(action: () => Promise<AlertsState>, failure: string, done?: string) {
    setBusy(true);
    try {
      const next = await action();
      setState(next);
      if (done && next === "on") toast.success(done);
    } catch (error) {
      toast.error(errorText(error, failure));
      setState(await alertsState().catch((): AlertsState => "off"));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const result = await sendTestAlert();
      if (result.sent) toast.success("Test alert sent. It should pop up in a few seconds.");
      else toast.error(result.detail ?? "The test alert wasn't sent.");
      if (!result.sent) setState(await alertsState().catch((): AlertsState => "off"));
    } catch (error) {
      toast.error(errorText(error, "Could not send a test alert."));
    } finally {
      setBusy(false);
    }
  }

  const needsDoing = state !== "on" && state !== "checking";
  return (
    <section
      aria-labelledby="order-alerts-title"
      className={`border-b-2 border-dashed border-primary/40 ${needsDoing ? "bg-accent text-accent-foreground" : "bg-card"}`}
    >
      <div className="mx-auto grid max-w-6xl gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6 lg:px-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BellRing className="size-5 shrink-0" />
            <h2 id="order-alerts-title" className="font-hand text-xl font-bold">
              Order alerts
            </h2>
            {state === "on" && (
              <span className="rounded-full bg-stock px-2 py-0.5 text-xs font-bold text-stock-foreground">
                On
              </span>
            )}
          </div>
          {state === "ios-home-screen" ? (
            <IosSteps />
          ) : (
            <p
              role="status"
              className={`mt-0.5 text-sm ${needsDoing ? "" : "text-muted-foreground"}`}
            >
              {SAYS[state]}
            </p>
          )}
          {state === "on" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turn them on on each phone or laptop you use. Signing out here turns them off.
            </p>
          )}
        </div>
        {state === "off" && (
          <Button
            className="h-auto min-h-11 whitespace-normal"
            disabled={busy}
            onClick={() =>
              void change(
                turnOnAlerts,
                "Could not turn on order alerts.",
                "Order alerts are on for this device.",
              )
            }
          >
            <BellRing /> {busy ? "Turning on…" : "Turn on order alerts"}
          </Button>
        )}
        {state === "on" && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="h-auto min-h-9 whitespace-normal"
              disabled={busy}
              onClick={() => void test()}
            >
              <Send /> Send a test alert
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-auto min-h-9 whitespace-normal"
              disabled={busy}
              onClick={() => void change(turnOffAlerts, "Could not turn off order alerts.")}
            >
              <BellOff /> Turn off
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
