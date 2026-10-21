// Server-only: runs inside the website server, never in the browser.
// The browser calls server functions (mart.functions.ts); they call the FastAPI backend from here,
// so the backend's address, the internal key and the login token never reach the browser.
import { deleteCookie, getCookie, getRequest, getRequestHeader, getRequestIP, setCookie } from "@tanstack/react-start/server";

import type { Result } from "./mart-types";

// The live API on Render (github.com/Ganesh30112006/KannagiBackend). BACKEND_URL overrides it:
// development points it at a local API, and start-production at the one it starts.
const LIVE_API = "https://kannagibackend.onrender.com";
const PRODUCTION = process.env["NODE_ENV"] === "production" || Boolean(process.env["VERCEL"]);

/** A setting as typed into a hosting dashboard: spaces, a line break or the quotes of a .env line around it are dropped. */
function setting(name: string): string {
  const value = (process.env[name] ?? "").trim();
  const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
  return quoted ? value.slice(1, -1).trim() : value;
}

const BACKEND_URL = (setting("BACKEND_URL") || (PRODUCTION ? LIVE_API : "http://127.0.0.1:8000")).replace(/\/+$/, "");
const INTERNAL_API_KEY = setting("INTERNAL_API_KEY");
// Vercel (VERCEL=1) sets X-Forwarded-For to the visitor's address itself, replacing whatever the visitor sent.
const TRUST_PROXY = process.env["TRUST_PROXY"] === "true" || Boolean(process.env["VERCEL"]);
const COOKIE_SECURE = process.env["COOKIE_SECURE"] ?? "auto";
const SESSION_COOKIE = "knm_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // matches the backend's JWT_EXPIRE_DAYS default
// Room for the API on Render's free plan waking from sleep (up to a minute), Neon waking, and a
// Cloudinary upload; under Vercel's 60-second limit per request.
const TIMEOUT_MS = 55_000;
// AWS answers 429 without running the API when every copy of it is busy (a burst of taps). Nothing
// happened, so the request is sent again after a moment, up to twice. The API's own 429s (too many
// wrong passwords, ...) say why in "detail" and are never repeated.
const BUSY_RETRY_MS = [300, 1_000];
const BUSY = "The Night Mart is very busy right now, so this wasn't saved. Please try again in a moment.";

/** What's wrong with the settings, or null. */
function settingsProblem(): string | null {
  if (!INTERNAL_API_KEY && PRODUCTION) return "INTERNAL_API_KEY must be set for the website server in production.";
  if (!/^[\x21-\x7e]*$/.test(INTERNAL_API_KEY)) {
    return "INTERNAL_API_KEY has a space, line break or other character that can't be sent. Paste only the key itself.";
  }
  if (!/^https?:\/\/[^/\s]+/.test(BACKEND_URL) || !URL.canParse(BACKEND_URL)) {
    return `BACKEND_URL must be the API's full address, like ${LIVE_API} (or leave it unset to use that one).`;
  }
  return null;
}

// A bad setting is written to the logs, saying which, on every call. Visitors are told the shop isn't set up
// right (not that they typed something wrong), and the setting itself never reaches the browser.
const SETTINGS_PROBLEM = settingsProblem();
if (SETTINGS_PROBLEM) console.error(`Website setting problem: ${SETTINGS_PROBLEM}`);

function isHttps(): boolean {
  const request = getRequest();
  const forwarded = TRUST_PROXY ? request.headers.get("x-forwarded-proto") : null;
  return (forwarded ?? new URL(request.url).protocol.replace(":", "")) === "https";
}

export function startSession(token: string) {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript (and so any injected script) can't read it
    secure: COOKIE_SECURE === "auto" ? isHttps() : COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function endSession() {
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

export function hasSession(): boolean {
  return Boolean(getCookie(SESSION_COOKIE));
}

function errorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("detail" in data)) return undefined;
  const { detail } = data as { detail: unknown };
  if (typeof detail === "string") return detail;
  // FastAPI validation errors: [{ loc, msg, ... }]
  const first: unknown = Array.isArray(detail) ? detail[0] : undefined;
  if (first && typeof first === "object" && "msg" in first) return String(first.msg).replace(/^Value error, /, "");
  return undefined;
}

/** The visitor's IP, for the API's per-network limits (wrong PINs, sign-ups). */
function clientIP(): string | undefined {
  if (TRUST_PROXY) {
    // Use the last X-Forwarded-For entry: the one our own proxy added. Earlier entries come from
    // the visitor and could be anything, which would let one person dodge the limits.
    const hops = (getRequestHeader("x-forwarded-for") ?? "").split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return getRequestIP();
}

/** Why a call failed (timeout, address not found, connection refused, ...), with the key and login token blanked out. */
function failureReason(error: unknown, token: string | undefined): string {
  const parts: string[] = [];
  for (let e: unknown = error; e instanceof Error && parts.length < 3; e = e.cause) {
    const code = (e as Error & { code?: unknown }).code;
    parts.push(`${e.name}${typeof code === "string" ? ` ${code}` : ""}: ${e.message}`);
  }
  let reason = parts.join(" <- ") || String(error);
  for (const secret of [INTERNAL_API_KEY, token]) if (secret) reason = reason.split(secret).join("<hidden>");
  return reason.slice(0, 500);
}

/** A 429 from the API itself (it says why), not from AWS turning the request away. */
async function apiSaidWhy(response: Response): Promise<boolean> {
  return errorMessage(await response.clone().json().catch(() => null)) !== undefined;
}

// --- the pulse: whether anything changed, the same for every visitor ---
// Open pages ask often (every few seconds); the answer is kept here for PULSE_KEEP_MS and only one call at
// a time goes to the API, so however many pages are open, the API answers at most one pulse per moment.
// Vercel's network keeps it too (the Cache-Control set in server.ts), so most never reach this server.
const PULSE_KEEP_MS = 1_500;
let pulseKept: { value: string; at: number } | null = null;
let pulseAsked: Promise<string | null> | null = null;

async function askPulse(): Promise<string | null> {
  if (SETTINGS_PROBLEM) return null;
  try {
    const response = await fetch(`${BACKEND_URL}/api/pulse`, {
      headers: { "X-Internal-Key": INTERNAL_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { pulse?: unknown };
    return typeof data.pulse === "string" ? data.pulse : null;
  } catch (error) {
    console.error(`The API at ${BACKEND_URL} could not be reached for the pulse: ${failureReason(error, undefined)}`);
    return null;
  }
}

/** The current pulse, or null when the API couldn't say (pages then sync in full). */
export async function currentPulse(now = Date.now()): Promise<string | null> {
  if (pulseKept && now - pulseKept.at < PULSE_KEEP_MS) return pulseKept.value;
  pulseAsked ??= askPulse().then((value) => {
    if (value !== null) pulseKept = { value, at: Date.now() };
    return value;
  }).finally(() => {
    pulseAsked = null;
  });
  return pulseAsked;
}

export async function callBackend<T>(path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<Result<T>> {
  if (SETTINGS_PROBLEM) {
    console.error(`Website setting problem: ${SETTINGS_PROBLEM}`);
    return { ok: false, status: 503, message: "The Night Mart isn't set up correctly right now. Please let the shop know." };
  }
  const headers: Record<string, string> = { "X-Internal-Key": INTERNAL_API_KEY, Accept: "application/json" };
  const ip = clientIP();
  if (ip) headers["X-Client-IP"] = ip;
  const token = getCookie(SESSION_COOKIE);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    for (let attempt = 0; ; attempt++) {
      response = await fetch(`${BACKEND_URL}/api${path}`, {
        method,
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const wait = BUSY_RETRY_MS[attempt];
      if (response.status !== 429 || wait === undefined || (await apiSaidWhy(response))) break;
      await new Promise((done) => setTimeout(done, wait + Math.random() * 200));
    }
  } catch (error) {
    // For the host's logs (Vercel: the project → Logs): why the API couldn't be reached.
    console.error(`The API at ${BACKEND_URL} could not be reached: ${failureReason(error, token)}`);
    return { ok: false, status: 503, message: "The Night Mart server isn't responding. Please try again in a moment." };
  }

  if (response.status === 401 && token) endSession();
  if (response.status === 204) return { ok: true, data: undefined as T };
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // Never pass backend internals through; 5xx get a generic message.
    const message = response.status >= 500 ? "Something went wrong on our side. Please try again." : errorMessage(data) ?? (response.status === 429 ? BUSY : "Request failed.");
    return { ok: false, status: response.status, message };
  }
  return { ok: true, data: data as T };
}
