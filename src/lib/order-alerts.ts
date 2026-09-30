// Notifications on this phone or laptop, even with the website closed (Web Push): each new order for a
// shopkeeper or admin (Order alerts), her own news for a customer (her order confirmed, ready or cancelled;
// an item she asked for in the shop). Turning them on asks the browser for permission and for a push
// address for this site at its push service (Google, Apple, Mozilla, Microsoft); the API sends there and
// public/sw.js shows it. They're per device, only while signed in here: signing out turns them off (api.logout).
import { unwrap } from "./api";
import * as fn from "./mart.functions";
import type { AlertDevice, AlertTest } from "./mart-types";

export type AlertsState =
  | "checking"
  | "unsupported" // this browser can't get notifications from a website
  | "ios-home-screen" // iPhone or iPad: only the Home Screen app can get them
  | "not-set-up" // the server has no alerts key yet
  | "blocked" // notifications are blocked for this site
  | "off"
  | "on";

const WORKER = "/sw.js";

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** iPhone or iPad (an iPad says it's a Mac, but one with a touch screen). */
function onIos(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function fromHomeScreen(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

let serverKey: Promise<string | null> | null = null;

/** The shop's public alerts key (null: not set up), asked once per page. */
function publicKey(): Promise<string | null> {
  serverKey ??= unwrap(fn.getAlertKey()).then(
    (result) => result.publicKey,
    (error: unknown) => {
      serverKey = null; // ask again next time
      throw error;
    },
  );
  return serverKey;
}

function bytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Whether this browser's alerts were turned on with the shop's current key. */
function sameKey(subscription: PushSubscription, key: string): boolean {
  const used = subscription.options.applicationServerKey;
  if (!used) return false;
  const a = new Uint8Array(used);
  const b = bytes(key);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function worker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(WORKER, { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

async function subscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function subscribe(
  registration: ServiceWorkerRegistration,
  key: string,
): Promise<PushSubscription> {
  // userVisibleOnly: every alert is shown (browsers allow nothing else).
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes(key),
  });
}

function device(sub: PushSubscription): AlertDevice {
  const keys = sub.toJSON().keys ?? {};
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: keys["p256dh"] ?? "", auth: keys["auth"] ?? "" },
  };
}

let told = false; // the server has this device's alerts from this page

/**
 * Where alerts stand on this device. When they're on, the server is told again (once per page), which
 * keeps them on the sign-in used here now, and a change of the shop's key is followed without a tap.
 */
export async function alertsState(): Promise<AlertsState> {
  if (!supported()) return onIos() && !fromHomeScreen() ? "ios-home-screen" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const key = await publicKey();
  if (!key) return "not-set-up";
  let sub = await subscription();
  if (!sub || Notification.permission !== "granted") return "off";
  if (!sameKey(sub, key)) {
    await sub.unsubscribe().catch(() => false);
    sub = await subscribe(await worker(), key);
    told = false;
  }
  if (!told) {
    await unwrap(fn.turnOnAlerts({ data: device(sub) }));
    told = true;
  }
  return "on";
}

/** Call straight from a tap: Safari asks for permission only then. */
export async function turnOnAlerts(): Promise<AlertsState> {
  if (!supported()) return alertsState();
  // Before anything else, while the tap still counts.
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off"; // the question was closed without an answer
  const key = await publicKey();
  if (!key) return "not-set-up";
  const registration = await worker();
  let sub = await registration.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await subscribe(registration, key);
  await unwrap(fn.turnOnAlerts({ data: device(sub) }));
  told = true;
  return "on";
}

export async function turnOffAlerts(): Promise<AlertsState> {
  const sub = supported() ? await subscription() : null;
  told = false;
  if (sub) {
    // The browser first: once it has let go of the address, no alert can reach this device, even if
    // telling the server fails (the server then drops the address at the next order).
    await sub.unsubscribe();
    await unwrap(fn.turnOffAlerts({ data: { endpoint: sub.endpoint } })).catch(() => undefined);
  }
  return "off";
}

export async function sendTestAlert(): Promise<AlertTest> {
  const sub = supported() ? await subscription() : null;
  if (!sub) return { sent: false, detail: "Order alerts aren't on for this device." };
  return unwrap(fn.testAlert({ data: { endpoint: sub.endpoint } }));
}

/** Admins: today's summary to this device now (it goes to every admin's at closing time). */
export async function sendSummaryAlert(): Promise<AlertTest> {
  const sub = supported() ? await subscription() : null;
  if (!sub) return { sent: false, detail: "Order alerts aren't on for this device." };
  return unwrap(fn.summaryAlert({ data: { endpoint: sub.endpoint } }));
}

/** Signing out on this device turns its alerts off (while the sign-in still lets the server be told). */
export async function forgetThisDevice(): Promise<void> {
  if (!supported()) return;
  const sub = await subscription();
  told = false;
  if (!sub) return;
  await Promise.allSettled([
    sub.unsubscribe(),
    fn.turnOffAlerts({ data: { endpoint: sub.endpoint } }),
  ]);
}
