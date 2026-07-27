# Project context for Claude Code

Printly is a single-page custom-apparel e-commerce + design studio.
Read `README.md` first, then `docs/chat_context.txt` for the full
build history and the reasoning behind existing decisions before
changing anything — several things here were deliberately chosen
after trying alternatives (see "Decisions already made" below).

## File map

Still no build step and no bundler — plain files, edited directly. What
changed is that they're now *separate* files instead of one 311KB
`index.html`, because Flask serves the whole `frontend/` directory.

**Frontend** (`frontend/`)
- `index.html` — markup only: shared header/footer plus one `<section
  class="view">` per page. `const BACKEND` resolves to a relative path,
  so API calls work unchanged on localhost, a tunnel or a real domain.
  Asset URLs carry `?v={{V}}`, substituted server-side — see the
  caching note below.
- `css/printly.css` — "Streetwear Black" tokens (surfaces, acid lime
  `#c8f232`, hot pink `#ce0358`) + shared components. `css/studio.css`
  is the three-column studio, `css/pages.css` the rest.
- `js/` loads in order and shares global scope (classic scripts, not
  modules): `mockup-data.js` → `data.js` → `mockups.js` → `nav.js` →
  `auth.js` → `products.js` → `studio.js` → `ai.js` → `cart.js` →
  `designs.js` → `pdp.js` → `init.js`. Order matters for top-level
  side effects; `esc()` lives in `data.js` because it loads first.
- `mockups/*.jpg` — the 8 garment photos, loaded at runtime.
  `window.PRINTLY_MOCKS` (in `js/mockup-data.js`) holds paths to these,
  keeping the `rn` / `rn_back` key naming. Replacing a photo is now just
  dropping in a new file — no base64 re-encoding.

**Backend** (`backend/`)
- `printly_backend.py` — Flask entry point (port 5001): serves the
  frontend, AI image generation, and registers every blueprint below.
  Accounts, orders, designs and reviews all need it running.
- `db.py` — shared SQLite (WAL) connection + schema for `generations`,
  `users`, `orders`, `login_attempts`, `ai_inflight`, `saved_designs`,
  `reviews`. Always `get_db()`, never `sqlite3.connect()` directly.
  New columns on existing tables need `_add_column()` — `CREATE TABLE
  IF NOT EXISTS` silently skips them.
- `auth.py` — signup/login/logout/me, session cookies, DB-backed
  per-email and per-IP rate limiting (in-memory wouldn't work once
  gunicorn forks workers).
- `orders.py` — place/list orders, admin pipeline, loyalty award. Order
  IDs (`PL-1001`) are computed from the integer PK, never stored — don't
  reintroduce a string primary key, it raced under concurrent inserts.
- `designs.py` — saved designs + templates. `reviews.py` — verified-
  purchase-gated reviews. `shipping.py` — pincode delivery estimate.
- `assets/mockups/` — the raw source photos (reference only; the
  runtime copies live in `frontend/mockups/`).

## Asset caching — read before changing CSS/JS

Assets are served with a 30-day `max-age`. `index.html` is served
`no-cache` and its `{{V}}` placeholders are replaced with a token derived
from the newest css/js mtime, so a changed file gets a new URL. **If you
add a new CSS or JS file, give its `<link>`/`<script>` a `?v={{V}}`** or
returning visitors will keep the stale copy for a month.

## Conventions to follow when editing the frontend

- **State lives in one object**: `state = {user, product, shirtColor,
  side, layers:{front,back}, sel, guides, cart, aiTries, designId,
  pdp}`. Orders and saved designs are NOT in client state — they're
  server-persisted and fetched fresh each time those views render.
  `state.user` is rehydrated from the server session on load via
  `checkSession()`, not stored durably client-side.
  Don't create parallel state — extend this object.
- **Escape interpolated strings.** Every render function builds
  `innerHTML` from server/user data; run it through `esc()` (`data.js`).
- **Quantity comes from `state.sizes`, never a separate field.** The
  per-size breakdown is the input; total is `sizeTotal(state.sizes)`.
  Don't reintroduce a standalone quantity control — two inputs for one
  number will drift apart. One-size products (`ONE_SIZE` in `data.js`)
  use a single `One size` key.
- **Thumbnails use `captureThumb()`, never `cv.toDataURL()` directly.**
  `draw()` paints the print-area guide and selection chrome, and a raw
  capture bakes that editor UI into cart/design/order thumbnails.
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

Verified in-browser against the running backend: all 5 products render
distinct front AND back photo mockups with multiply-blend recolor over a
pure-black background; jersey kit lays out on the back print area; the
on-canvas delete badge and `fitWidth()` behave; AI image generation
places on canvas; a design with text + image layers survives save →
hard reload → restore; checkout awards loyalty points and shows the
6-stage tracker; a non-admin gets 403 from the admin API. At 375px:
zero horizontal overflow and zero sub-44px tap targets across all 8
views. Load test: 100 concurrent users, ~1,640 requests, 0 failures,
p95 ≈220ms.

## Not yet done (don't assume these exist)

- **Razorpay** — order totals are still client-trusted. The server MUST
  recompute from a price table the moment payment lands.
- **GST** — flat 5%. Real Indian apparel GST is 5% under ₹1,000 and 12%
  at or above, so higher-priced items are likely under-collecting.
- **Loyalty redemption** — points accrue on a placeholder rule
  (1 per ₹100) with no way to spend them and no agreed policy.
- Verified-email / password reset, live deployment, PWA. See README.
