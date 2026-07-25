# Printly — Custom T-Shirt Printing Platform

A single-page e-commerce + live design studio for custom apparel
(round neck tees, polos, hoodies, sports jerseys), with a real
photo-mockup engine (recolor + print overlay on actual product
photos, not geometric shapes), an AI image-generation backend, and a
real auth + orders backend (accounts, sessions, persisted orders, an
access-controlled admin pipeline). Brand: PRINTLY. Tagline: "Your
Brand. Your Story. Printed."

## Folder structure

```
printly-project/
├── frontend/
│   └── index.html          ← THE app. Single file: HTML+CSS+JS,
│                              mockup photos embedded as base64.
│                              No build step — served by the backend
│                              (see below), or open it directly with
│                              file:// for frontend-only work.
├── backend/
│   ├── printly_backend.py  ← Flask app entry point: serves index.html,
│   │                          AI image generation, registers auth/orders.
│   ├── db.py                ← shared SQLite (WAL mode) connection + schema
│   ├── auth.py               ← signup/login/logout/me, sessions, rate limiting
│   ├── orders.py              ← place/list orders, admin pipeline
│   ├── loadtest.py           ← locust load test (dev-only, not a runtime dep)
│   ├── requirements.txt
│   └── .env.example        ← copy to .env, fill in the real values
├── assets/
│   └── mockups/            ← the 8 RAW source photos (front+back ×
│                              4 products) used to build the print
│                              engine. Reference only — index.html
│                              already has these baked in as base64.
│                              Re-embed from here if you replace a photo.
├── docs/
│   ├── Printly_Business_Plan_2026.pdf
│   └── chat_context.txt    ← full build history / decisions log
└── .gitignore
```

## Running it locally

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
```
Edit `.env` and set at minimum:
- `FLASK_SECRET_KEY` — generate with `python -c "import secrets;print(secrets.token_hex(32))"`
- `ADMIN_EMAIL` — the email you'll sign up with to get the admin role
  (**sign up with this exact email first**, before anyone else — the
  admin role is only assigned at signup time, matching this env var)

Then:
```bash
python printly_backend.py    # runs on http://127.0.0.1:5001
```
This single command serves the whole app — frontend, AI image
generation, auth, and orders — all from `http://127.0.0.1:5001`. Open
that URL in a browser. (The AI image button and manual design tool
both need the backend now, since sessions/orders require it — opening
`frontend/index.html` directly via `file://` still works for pure
frontend/design-tool iteration, but auth/cart/orders need the backend.)

## Production deployment (Render)

Render fits well here since orders/users are stored in SQLite, which
needs a real persistent disk — Render's Starter tier bundles one at a
predictable flat price, unlike usage-billed alternatives. *(Check
current Render pricing before committing — this doc reflects the plan
made when this was built, not necessarily today's pricing page.)*

1. Push this repo to GitHub if you haven't (`git remote -v` to check).
2. Render → New → Web Service → connect the repo.
3. **Root directory**: `backend`. **Build command**: `pip install -r requirements.txt`.
   **Start command**:
   ```
   gunicorn -w 2 --threads 4 --worker-class gthread --timeout 120 --bind 0.0.0.0:$PORT printly_backend:app
   ```
4. **Add a persistent Disk** (e.g. mount path `/var/data`) and set the
   env var `DB_PATH=/var/data/printly.db`. **This step is not
   optional** — without it, the SQLite file lives on the container's
   ephemeral filesystem and every redeploy silently wipes every user
   and order.
5. Set these env vars on the Render dashboard (never commit real
   values — `.env` is gitignored on purpose):
   `FLASK_SECRET_KEY`, `ADMIN_EMAIL`, `FRONTEND_ORIGIN` (your deployed
   URL, e.g. `https://printly.in` — locks CORS down to just that
   origin), `FLASK_ENV=production`, plus whichever AI-provider vars
   from `.env.example` you're using.
6. Point your domain's DNS at Render's target and add it in the
   dashboard — Render provisions HTTPS automatically.
7. **Sign up with your `ADMIN_EMAIL` address first**, before opening
   the site up to real customers — the admin role is only granted at
   signup time. If you miss this window, update the `role` column for
   your user row directly in the database, or delete and re-sign-up.

## Load testing

`backend/loadtest.py` (locust, install ad hoc — `pip install locust`,
not in `requirements.txt` since it's a dev-only tool) simulates
concurrent signups/logins/orders/admin traffic. Deliberately excludes
`/api/generate-image` — that endpoint is intentionally capped to 1
concurrent request (Pollinations' free-tier limit), so bulk-hitting it
would just burn the shared free quota rather than test anything
useful.

```bash
pip install locust
locust -f loadtest.py --host http://127.0.0.1:5001 \
    --users 100 --spawn-rate 20 --run-time 60s --headless
```
Point `--host` at your Render URL once deployed, instead of
localhost. Last run locally (dev server, not gunicorn): 100 concurrent
users, ~2200 requests over 60s, **zero failures**, p95 ≈160ms, worst
case ≈390ms (signup, from intentionally-slow password hashing).

## What's built (as of this snapshot)

- **4 products, front + back, real photo mockups**: round neck,
  polo, hoodie, sports jersey — all with working recolor (multiply-
  blend keeps fabric folds/shadows), design/text/logo overlay, drag +
  snap-to-center, resize, and an on-canvas delete (✕) on the selected
  element plus Delete/Backspace keyboard support.
- **Jersey Kit panel** — name/number/sponsor auto-layout on the jersey
  back print area, for team orders.
- **AI image generation** — Pollinations (Sana Sprint 1.6B, free,
  default) → Gemini → Replicate fallback chain, gated to 3 free tries
  for guests then sign-in required; honestly queued under concurrent
  load (1-at-a-time, matching Pollinations' real rate limit) instead
  of silently overloading it; design tool itself is unlimited/free.
- **Real accounts** — email+password signup/login, session cookies,
  per-email and per-IP login rate limiting.
- **Real orders** — server-persisted (not lost on refresh, not
  client-spoofable), customer order history, access-controlled admin
  pipeline (role enforced server-side, not just a hidden button).
- **Production hardening** — gunicorn (Linux), locked-down CORS,
  security headers, SQLite in WAL mode, no debug mode in production.
- **Business plan PDF** in `docs/` — asset-light launch model
  (₹2.3–3.3L investment), competitor research (PrintMine.in, VistaPrint),
  pricing tiers per product.

## Known pending items

1. **Razorpay** — checkout is currently a demo flow, not wired to a
   real payment gateway. Order totals are currently trusted from the
   client since there's no real payment yet — **the moment Razorpay is
   wired in, the server must recompute the charge from a price table
   instead of trusting the client-sent total**, or pricing becomes
   spoofable.
2. **Live deployment** — code and steps are ready (see above); actually
   creating the Render/GitHub accounts and running through the steps is
   still on you, plus pointing a real domain at it.
3. **PWA** — installable home-screen app is a ~1-day addition on top
   of the existing HTML/JS; Capacitor can wrap it for Play/App Store
   later. (Deliberately not rebuilt in React Native — reuses this
   same codebase.)
4. Print-area fine-tuning may be needed per product once tested on
   real devices/screens.
5. No verified-email/password-reset flow yet — plain password auth is
   the pragmatic MVP; add if abuse or lost-password requests become a
   real problem.

See `docs/chat_context.txt` for the full reasoning behind the original
build decisions (why photo mockups over geometric shapes, why
Pollinations as the default AI provider, etc.).
