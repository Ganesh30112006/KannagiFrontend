// The dashboard's Order alerts card: turns on a notification for each new order on this phone or laptop
// (see lib/order-alerts.ts), sends a test one, or turns them off.
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

const SAYS: Record<AlertsState, string> = {
  checking: "Checking this device…",
  off: "Get a notification on this phone or laptop for every new order, even when the website is closed.",
  on: "On for this device: every new order pops up here, even when the website is closed.",
  blocked:
    "Notifications are blocked for this site on this device. Allow them in the browser's site settings (tap the icon next to the web address), then reload this page.",
  "ios-home-screen":
    "On iPhone and iPad, alerts work from the Home Screen app: tap Share, then Add to Home Screen, open Night Mart from the new icon, sign in and turn them on there (iOS 16.4 or newer).",
  unsupported:
    "This browser can't show order alerts. Use Chrome, Edge, Firefox or Safari (on iPhone, from the Home Screen).",
  "not-set-up": "Order alerts aren't set up for this shop yet. Ask the admin to set them up.",
};

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

  return (
    <section
      aria-labelledby="order-alerts-title"
      className="mt-5 border-2 border-dashed border-primary/35 bg-card p-4 shadow-[4px_5px_0_var(--shadow-color)]"
    >
      <div className="flex items-center gap-2">
        <BellRing className="size-6 shrink-0 text-primary" />
        <h3 id="order-alerts-title" className="font-hand text-2xl font-bold">
          Order alerts
        </h3>
        {state === "on" && (
          <span className="rounded-full bg-stock px-2 py-0.5 text-xs font-bold text-stock-foreground">
            On
          </span>
        )}
      </div>
      <p role="status" className="mt-1 text-sm text-muted-foreground">
        {SAYS[state]}
      </p>
      {state === "off" && (
        <Button
          className="mt-3 h-auto min-h-10 whitespace-normal"
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
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="h-auto min-h-10 whitespace-normal"
              disabled={busy}
              onClick={() => void test()}
            >
              <Send /> Send a test alert
            </Button>
            <Button
              variant="ghost"
              className="h-auto min-h-10 whitespace-normal"
              disabled={busy}
              onClick={() => void change(turnOffAlerts, "Could not turn off order alerts.")}
            >
              <BellOff /> Turn off
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Turn them on on each phone or laptop you use. Signing out here turns them off.
          </p>
        </>
      )}
    </section>
  );
}
