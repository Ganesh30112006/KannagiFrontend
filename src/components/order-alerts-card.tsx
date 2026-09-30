// Notifications on this phone or laptop (see lib/order-alerts.ts): turning them on, a test, turning them
// off. OrderAlertsCard is the shop's (a new order each time), at the top of the shopkeeper's page and of
// /admin (every tab), standing out until they're on; admins can also get today's summary now.
// NotificationsCard is a customer's (her order confirmed, ready or cancelled; an item she asked for in
// the shop), in My Orders and by the wishlist.
import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, ChartNoAxesColumn, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  alertsState,
  sendSummaryAlert,
  sendTestAlert,
  turnOffAlerts,
  turnOnAlerts,
  type AlertsState,
} from "@/lib/order-alerts";

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

type Says = Record<Exclude<AlertsState, "ios-home-screen">, string>;

const BLOCKED =
  "Notifications are blocked for this site on this device. Allow them in the browser's site settings (tap the icon next to the web address), then reload this page.";
const UNSUPPORTED = (what: string) =>
  `This browser can't show ${what}. Open kannagimart.tech in Chrome (Android) or Safari (iPhone) itself, not inside WhatsApp or Instagram.`;

const SHOP_SAYS: Says = {
  checking: "Checking this device…",
  off: "Get a notification on this phone or laptop for every new order, even when the website is closed.",
  on: "On for this device: every new order pops up here, even when the website is closed.",
  blocked: BLOCKED,
  unsupported: UNSUPPORTED("order alerts"),
  "not-set-up": "Order alerts aren't set up for this shop yet. Ask the admin to set them up.",
};

const CUSTOMER_SAYS: Says = {
  checking: "Checking this phone…",
  off: "Get a notification when your order is confirmed or ready, and when something you asked for arrives in the shop.",
  on: "On for this phone: you'll hear when your order is ready, and when something you asked for arrives.",
  blocked: BLOCKED,
  unsupported: UNSUPPORTED("notifications"),
  "not-set-up": "Notifications aren't available right now.",
};

/** iPhone and iPad: only the Home Screen app can get them (iOS 16.4 or newer). */
function IosSteps({ turnOn }: { turnOn: string }) {
  return (
    <div className="mt-1 text-sm">
      <p className="font-bold">
        On iPhone, notifications work from the Home Screen app. In Safari:
      </p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>
          Tap the <b>Share</b> button (the square with an arrow).
        </li>
        <li>
          Tap <b>Add to Home Screen</b>, then <b>Add</b>.
        </li>
        <li>
          Open <b>Night Mart</b> from the new icon, sign in, and tap <b>{turnOn}</b> here.
        </li>
      </ol>
      <p className="mt-1 text-xs text-muted-foreground">Needs iOS 16.4 or newer.</p>
    </div>
  );
}

/** Where notifications stand on this device, and the actions on them. */
function useNotifications(names: { on: string; off: string; test: string }) {
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

  async function run(action: () => Promise<AlertsState>, failure: string, done?: string) {
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

  async function send(
    what: () => Promise<{ sent: boolean; detail?: string }>,
    sent: string,
    failure: string,
  ) {
    setBusy(true);
    try {
      const result = await what();
      if (result.sent) toast.success(sent);
      else toast.error(result.detail ?? failure);
      if (!result.sent) setState(await alertsState().catch((): AlertsState => "off"));
    } catch (error) {
      toast.error(errorText(error, failure));
    } finally {
      setBusy(false);
    }
  }

  return {
    state,
    busy,
    turnOn: () =>
      void run(turnOnAlerts, `Could not turn on ${names.off}.`, `${names.on} for this device.`),
    turnOff: () => void run(turnOffAlerts, `Could not turn off ${names.off}.`),
    test: () =>
      void send(
        sendTestAlert,
        `${names.test} sent. It should pop up in a few seconds.`,
        `The ${names.test.toLowerCase()} wasn't sent.`,
      ),
    summary: () =>
      void send(
        sendSummaryAlert,
        "Today's summary sent. It should pop up in a few seconds.",
        "The summary wasn't sent.",
      ),
  };
}

/** The shop's: at the top of the page. admin: also "Send today's summary" (it comes at closing time). */
export function OrderAlertsCard({ admin = false }: { admin?: boolean }) {
  const alerts = useNotifications({
    on: "Order alerts are on",
    off: "order alerts",
    test: "Test alert",
  });
  const { state, busy } = alerts;
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
            <IosSteps turnOn="Turn on order alerts" />
          ) : (
            <p
              role="status"
              className={`mt-0.5 text-sm ${needsDoing ? "" : "text-muted-foreground"}`}
            >
              {SHOP_SAYS[state]}
            </p>
          )}
          {state === "on" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turn them on on each phone or laptop you use. Signing out here turns them off.
              {admin && " Admins also get today's summary at closing time."}
            </p>
          )}
        </div>
        {state === "off" && (
          <Button
            className="h-auto min-h-11 whitespace-normal"
            disabled={busy}
            onClick={alerts.turnOn}
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
              onClick={alerts.test}
            >
              <Send /> Send a test alert
            </Button>
            {admin && (
              <Button
                size="sm"
                variant="secondary"
                className="h-auto min-h-9 whitespace-normal"
                disabled={busy}
                onClick={alerts.summary}
              >
                <ChartNoAxesColumn /> Send today&apos;s summary
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-auto min-h-9 whitespace-normal"
              disabled={busy}
              onClick={alerts.turnOff}
            >
              <BellOff /> Turn off
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** A customer's. compact: one line and a button (by the wishlist); otherwise a card (My Orders). */
export function NotificationsCard({ compact = false }: { compact?: boolean }) {
  const alerts = useNotifications({
    on: "Notifications are on",
    off: "notifications",
    test: "Test notification",
  });
  const { state, busy } = alerts;
  // By the wishlist it only asks; once they're on, or where they can't be, it says nothing more there.
  if (compact && state !== "off") return null;
  if (compact) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md bg-card/80 p-3 text-sm text-foreground">
        <Bell className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">Get a notification when it arrives in the shop.</span>
        <Button size="sm" disabled={busy} onClick={alerts.turnOn}>
          {busy ? "Turning on…" : "Turn on notifications"}
        </Button>
      </div>
    );
  }
  return (
    <section
      aria-labelledby="notifications-title"
      className="rounded-md border-2 border-dashed border-primary/40 bg-card p-4 shadow-[3px_4px_0_var(--shadow-color)]"
    >
      <div className="flex items-center gap-2">
        <Bell className="size-5 shrink-0 text-primary" />
        <h3 id="notifications-title" className="font-hand text-2xl font-bold">
          Notifications
        </h3>
        {state === "on" && (
          <span className="rounded-full bg-stock px-2 py-0.5 text-xs font-bold text-stock-foreground">
            On
          </span>
        )}
      </div>
      {state === "ios-home-screen" ? (
        <IosSteps turnOn="Turn on notifications" />
      ) : (
        <p role="status" className="mt-1 text-sm text-muted-foreground">
          {CUSTOMER_SAYS[state]}
        </p>
      )}
      {state === "off" && (
        <Button
          className="mt-3 h-auto min-h-10 w-full whitespace-normal"
          disabled={busy}
          onClick={alerts.turnOn}
        >
          <Bell /> {busy ? "Turning on…" : "Turn on notifications"}
        </Button>
      )}
      {state === "on" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={alerts.test}>
            <Send /> Send a test
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={alerts.turnOff}>
            <BellOff /> Turn off
          </Button>
        </div>
      )}
    </section>
  );
}
