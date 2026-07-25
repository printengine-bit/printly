# Project context for Claude Code

Printly is a single-page custom-apparel e-commerce + design studio.
Read `README.md` first, then `docs/chat_context.txt` for the full
build history and the reasoning behind existing decisions before
changing anything — several things here were deliberately chosen
after trying alternatives (see "Decisions already made" below).

## File map

- `frontend/index.html` — the ENTIRE frontend. One file: `<style>`,
  two `<script>` blocks (first one defines `window.PRINTLY_MOCKS` —
  the base64 mockup photo data + print-area coordinates; second one
  is all app logic), and the HTML. There is no build step and no
  bundler — edit this file directly. Also served BY the backend at
  `/` (see below) — `const BACKEND` resolves to a relative path when
  served that way, so API calls work unchanged on localhost, a tunnel,
  or a real domain.
- `backend/printly_backend.py` — Flask app entry point (port 5001):
  serves `index.html` at `/`, does AI image generation, and registers
  the `auth`/`orders` blueprints below. Not just an AI add-on anymore —
  accounts, sessions, and orders all need it running now too.
- `backend/db.py` — shared SQLite (WAL mode) connection helper +
  schema for all tables (`generations`, `users`, `orders`,
  `login_attempts`, `ai_inflight`). Get a connection via `get_db()`,
  never `sqlite3.connect()` directly, so WAL/timeout settings stay
  consistent everywhere.
- `backend/auth.py` — signup/login/logout/me, session cookies,
  DB-backed (not in-memory — matters once gunicorn runs multiple
  worker processes) per-email and per-IP login rate limiting.
- `backend/orders.py` — place/list orders, admin pipeline. Order IDs
  (`PL-1001` etc.) are a pure display computation over the real
  integer primary key, never stored — don't reintroduce a
  string-primary-key scheme here, it raced under concurrent inserts.
- `assets/mockups/` — the 8 raw source photos (reference only). The
  frontend does NOT read from this folder at runtime — it uses the
  base64 copies already embedded in `window.PRINTLY_MOCKS` inside
  `index.html`. If you replace a mockup photo, you must re-encode it
  to base64 and swap it into that JS object yourself.

## Conventions to follow when editing `index.html`

- **State lives in one object**: `state = {user, product, shirtColor,
  side, layers:{front,back}, sel, guides, cart, aiTries}`. Orders are NOT
  in client state — they're server-persisted (`backend/orders.py`),
  fetched fresh via `/api/orders/mine` / `/api/admin/orders` each time
  those views render. `state.user` is rehydrated from the server session
  on load via `checkSession()`, not stored durably client-side.
  Don't create parallel state — extend this object.
- **Mockup key naming**: `<productId>` for front, `<productId>_back`
  for back (e.g. `rn`, `rn_back`, `js`, `js_back`). `mockKey(pid)`
  resolves which one to use based on `state.side` — any new product
  must follow this naming pattern or the back-view toggle silently
  breaks.
- **Print areas** live in `MOCK.print[key]` as `{cx,cy,w,h,cmW,cmH}`
  in 720px-wide mockup-space; `mockLayout()` converts these into
  canvas coordinates. Don't hardcode pixel positions elsewhere.
- **Recolor** uses a multiply-blend against the original photo
  (`getRecoloredMock`) — this is intentional and keeps fabric folds/
  shadows intact. Don't replace it with a flat color fill.
- **Selected-element delete**: the on-canvas ✕ badge is drawn in
  `draw()` and its hit-test lives in `state._delHit`, checked at the
  top of `down()`. If you add new element types (beyond text/img),
  wire them through `layerBounds()` so the badge positions correctly.
- **AI generation is gated** (3 free tries for guests via
  `state.aiTries`, then `openLogin()`) — the manual design tool
  (text/logo/recolor) is never gated. Keep that split; it's a
  deliberate business rule, not a bug.

## Known-good state

Last verified working (via Playwright, pixel-sampled): all 4 products
render distinct front AND back real photo mockups, recolor keeps
folds intact with a pure black background, jersey kit text renders on
the back print area, the on-canvas delete badge removes the selected
element, and enlarged print areas allow a jersey number to be sized
up significantly before hitting the print-area edge.

## Not yet done (don't assume these exist)

Razorpay integration (order totals are still client-trusted — MUST
recompute server-side from a price table the moment this lands),
verified-email/password-reset flow, actual live deployment (code and
Railway steps are ready in README, but nobody's created the hosting
account or pointed a domain at it yet), PWA manifest/service worker.
See README "Known pending items" for details.
