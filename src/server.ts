import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Inline scripts are needed for TanStack's hydration data; everything else is locked to this site
// (plus https product photos). Fonts are served by this site too. Dev skips CSP because Vite's HMR needs eval/websockets.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Behind an https reverse proxy or tunnel (TRUST_PROXY=true, or on Vercel), the request may reach us
// as http; the proxy's X-Forwarded-Proto says whether the visitor used https.
const TRUST_PROXY = process.env["TRUST_PROXY"] === "true" || Boolean(process.env["VERCEL"]);

function servedOverHttps(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return TRUST_PROXY && request.headers.get("x-forwarded-proto") === "https";
}

function withSecurityHeaders(response: Response, request: Request): Response {
  const secured = new Response(response.body, response);
  const headers = secured.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.delete("X-Powered-By");
  headers.delete("Server");
  if (import.meta.env.PROD) headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  if (servedOverHttps(request))
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Server-function responses carry personal data; never cache them.
  if (new URL(request.url).pathname.startsWith("/_serverFn"))
    headers.set("Cache-Control", "no-store");
  return secured;
}

// Pages and server-function replies (JSON) are compressed as they're sent: about 3x smaller.
// Static files already have pre-compressed copies from the build.
const COMPRESSIBLE = /^(text\/html|application\/json)\b/;

function compressed(response: Response, request: Request): Response {
  const type = response.headers.get("content-type") ?? "";
  if (
    !response.body ||
    response.status === 204 ||
    response.status === 304 ||
    response.headers.has("content-encoding") ||
    !COMPRESSIBLE.test(type) ||
    !/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  headers.append("vary", "Accept-Encoding");
  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return compressed(
        withSecurityHeaders(await normalizeCatastrophicSsrResponse(response), request),
        request,
      );
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        request,
      );
    }
  },
};
