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

// A bad setting stops the website at start with a message saying which, instead of every call failing.
if (!INTERNAL_API_KEY && PRODUCTION) {
  throw new Error("INTERNAL_API_KEY must be set for the website server in production.");
}
if (!/^[\x21-\x7e]*$/.test(INTERNAL_API_KEY)) {
  throw new Error("INTERNAL_API_KEY has a space, line break or other character that can't be sent. Paste only the key itself.");
}
if (!/^https?:\/\/[^/\s]+/.test(BACKEND_URL) || !URL.canParse(BACKEND_URL)) {
  throw new Error(`BACKEND_URL must be the API's full address, like ${LIVE_API} (or leave it unset to use that one).`);
}

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

export async function callBackend<T>(path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<Result<T>> {
  const headers: Record<string, string> = { "X-Internal-Key": INTERNAL_API_KEY, Accept: "application/json" };
  const ip = clientIP();
  if (ip) headers["X-Client-IP"] = ip;
  const token = getCookie(SESSION_COOKIE);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}/api${path}`, {
      method,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
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
    const message = response.status >= 500 ? "Something went wrong on our side. Please try again." : errorMessage(data) ?? "Request failed.";
    return { ok: false, status: response.status, message };
  }
  return { ok: true, data: data as T };
}
