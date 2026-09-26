# Kannagi Night Mart website

The Kannagi Night Mart website, live at **https://kannagimart.tech**: the customer storefront, the shopkeeper dashboard (`/dashboard`) and the admin console (`/admin`). React 19 + TanStack Start, deployed on Vercel.

## How it talks to the API

```
Phone / browser ──(same-site calls, HttpOnly cookie)──▶ this website's server ──(X-Internal-Key)──▶ API on Render
```

- The browser only ever calls this website. Its server functions call the API ([KannagiBackend](https://github.com/Ganesh30112006/KannagiBackend), live at `https://kannagibackend.onrender.com`) with the secret `INTERNAL_API_KEY`, so the API's address, the key and the login token never reach the browser.
- The API's address is built in (`src/lib/backend.server.ts`, server-only). `BACKEND_URL` overrides it.
- Sign-ins are kept in an HttpOnly `knm_session` cookie that page scripts can't read.

## Deploy on Vercel

1. **Import:** Vercel dashboard → **Add New → Project** → import **KannagiFrontend** from GitHub.
2. **Build settings:**

   | Setting | Value |
   | --- | --- |
   | Framework Preset | Other |
   | Root Directory | `./` |
   | Build Command | `npm run build` |
   | Output Directory | leave empty (the build writes `.vercel/output` itself) |
   | Install Command | leave empty (`npm install`) |

3. **Environment Variables:**

   | Name | Value |
   | --- | --- |
   | `INTERNAL_API_KEY` | exactly the same value as `INTERNAL_API_KEY` on the Render API |

   Nothing else is needed: leave `BACKEND_URL` unset, and don't import other `.env` files here. Quotes or spaces pasted around the value are ignored. With a missing or broken key, visitors see "The Night Mart isn't set up correctly right now" and Vercel's logs say `Website setting problem: ...` with what to fix.
4. **Deploy.** The site opens at `https://<project>.vercel.app`: the sign-in page for customers and shopkeepers, and `/admin` for admins.
5. **Domain:** the shop's domain is `kannagimart.tech` (Vercel → the project → **Settings → Domains**). Add `www.kannagimart.tech` there too, choosing to redirect it to `kannagimart.tech`, and create the DNS record Vercel shows for it.

What the build sets up by itself (`vite.config.ts`, when Vercel builds it):

- **Region:** the website's server runs in Singapore (`sin1`), next to the API on Render and the Neon database.
- **Time limit:** 60 seconds per request. The API on Render's free plan sleeps after 15 minutes without requests and takes up to a minute to wake; the website waits for it (up to 55 seconds) instead of failing.
- **Node.js:** 22, from `package.json`.
- **Visitors' addresses:** taken from Vercel's `X-Forwarded-For`, which Vercel sets itself, for the API's per-network limits.

Every push to `main` deploys to production; other branches get preview deployments (they use the same live API).

### "The Night Mart server isn't responding"

The website couldn't reach the API. Vercel → the project → **Logs** has a line saying why: `The API at <address> could not be reached: <reason>`.

- **The address isn't `https://kannagibackend.onrender.com`:** a `BACKEND_URL` is set in Vercel's Environment Variables. Delete it and redeploy.
- **A timeout:** the API on Render is down or still waking; check it at `https://kannagibackend.onrender.com/api/health` and in the Render dashboard.
- **"Request failed" instead (the API answered 404):** `INTERNAL_API_KEY` differs between Vercel and Render. Copy Render's value into Vercel and redeploy.

Changed Environment Variables apply only to new deployments: Vercel → **Deployments** → the latest → **Redeploy**.

## CI

GitHub Actions (`.github/workflows/ci.yml`) checks every push to `main` and every pull request: types, lint, both builds (the Node server and the Vercel build), and that no file sent to browsers mentions the internal key or the API's address.

## Development

Run the API locally first (see KannagiBackend's README), then create `.env.local` here:

```
BACKEND_URL=http://127.0.0.1:8000
INTERNAL_API_KEY=<the same value as the local API's INTERNAL_API_KEY>
```

```sh
npm install
npm run dev
```

`npm run build` outside Vercel makes a standalone Node server (`.output/server/index.mjs`, run with `node .output/server/index.mjs`); set `BACKEND_URL`, `INTERNAL_API_KEY`, and `TRUST_PROXY=true` when it runs behind an https proxy.
