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
  `designs.js` → `admin.js` → `pdp.js` → `scrollstack.js` →
  `cursorgrid.js` → `theme.js` → `init.js`. Order matters for top-level
  side effects; `esc()` lives in `data.js` because it loads first. The
  initial `data-theme` is set by an inline script in `<head>`, before the
  stylesheets — moving that into `theme.js` reintroduces a colour flash
  on every load.
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
  A delivery address is **required** to place an order. Stages move in
  either direction and every change writes to `order_events`; cancelling
  sets a separate `cancelled` flag rather than a 7th stage, so restoring
  resumes where the order was. `/api/admin/orders` returns per-line
  summaries only — putting `items_json` in the list made it 234KB for
  four orders, since each line carries a base64 thumbnail.
- `designs.py` — saved designs + templates. `reviews.py` — verified-
  purchase-gated reviews. `shipping.py` — pincode delivery estimate.
- `artwork.py` — print-ready files written to `ART_DIR` (defaults next
  to the DB; point it at the Railway volume in production). The cart's
  `stripImg()` deliberately drops image data from the order, so **this
  is the only copy production can print from** — an order whose artwork
  files are missing cannot be fulfilled. Admin-only to download.
  PNG *or* WebP: `encodePrintArt()` (studio.js) keeps text/logo designs
  lossless as PNG, and falls back to WebP only when PNG exceeds budget,
  which is what a photographic AI generation does (~8.7MB at print
  size). Both formats must keep alpha — the background has been removed
  and has to stay removed. Format is sniffed from magic bytes, never the
  claimed data-URI prefix.
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
- **Never re-declare a top-level `const` across two JS files.** These are
  classic scripts sharing one global scope, so a duplicate declaration is
  a parse error that silently discards the *entire* second file — no
  console message, the page's functions just don't exist. `SIZES` was
  declared in both `data.js` and `pdp.js` and killed the whole product
  detail page until it was caught. Grep before adding a top-level name.
- **`--lime` is a fill, `--lime-ink` is text.** Same for `--pink` /
  `--pink-ink`. The fills stay identical in both themes (lime pill, dark
  text — that's the brand); the ink tokens darken on the light surface
  because raw `#c8f232` on white is 1.4:1. Never write
  `color:var(--lime)`. Same rule for any new hardcoded colour: put it in
  the token block with a light-theme counterpart, or it will be
  invisible in one of the two themes.
- **Canvases don't inherit CSS variables.** Anything painted (mockups,
  cursor grid) has to re-read tokens and repaint on a theme switch —
  that's what `repaintForTheme()` in `theme.js` is for. Add new canvas
  surfaces to it.
- **Mockup photos are keyed to transparency**, not drawn on their black
  photo background — `getRecoloredMock()` ramps alpha off the *original*
  pixel brightness. Every draw site must paint `drawStage()` first, or
  the garment floats on whatever's behind it and a black tee vanishes.
  The stage contrasts the *garment*, not the theme.
- **Escape interpolated strings.** Every render function builds
  `innerHTML` from server/user data; run it through `esc()` (`data.js`).
- **Quantity comes from `state.sizes`, never a separate field.** The
  per-size breakdown is the input; total is `sizeTotal(state.sizes)`.
  Don't reintroduce a standalone quantity control — two inputs for one
  number will drift apart. One-size products (`ONE_SIZE` in `data.js`)
  use a single `One size` key.
- **Decorative motion is progressive enhancement.** `scrollstack.js`
  only adds its `is-stacked` class once JS runs and reduced motion isn't
  requested, so the CSS in the stylesheet must stand on its own as the
  no-JS layout. It writes transforms only — never anything that changes
  layout — because it measures each card's `offsetTop` once and reuses
  it every frame. `cursorgrid.js` injects its own `<canvas>` behind the
  hero and bails on `prefers-reduced-motion` or a coarse pointer, so
  phones never run it. Both loops **sleep** when there's nothing to
  animate — don't convert either to an unconditional rAF loop.
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
