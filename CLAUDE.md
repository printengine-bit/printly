# Project context for Claude Code

Print Engine is a single-page custom-apparel e-commerce + design studio.
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
  `designs.js` → `pdp.js` → `support.js` → `scrollstack.js` →
  `cursorgrid.js` → `theme.js` → `init.js`. Order matters for top-level
  side effects; `esc()` lives in `data.js` because it loads first. The
  initial `data-theme` is set by an inline script in `<head>`, before the
  stylesheets — moving that into `theme.js` reintroduces a colour flash
  on every load.
- **The catalogue is not in the code.** Products, prices, fabric text,
  care lists and size charts live in the database and are inlined into
  `index.html` as `window.PRINTLY_CATALOG` by the `/` route. `data.js`
  reads that; it no longer declares `PRODUCTS`. Editing a product means
  the admin panel, not a JS file. The payload keeps the exact shape the
  old array had, so every render function downstream is unchanged.
- `mockups/*.jpg` — the 8 garment photos, loaded at runtime.
  `window.PRINTLY_MOCKS` (in `js/mockup-data.js`) holds paths to these,
  keeping the `rn` / `rn_back` key naming. Replacing a photo is now just
  dropping in a new file — no base64 re-encoding.

**Admin panel** (`frontend/admin/`) — a *separate app* served at `/admin`,
sharing no file with the storefront: `index.html`, `css/admin.css`,
`js/{api,theme,dashboard,settings,inventory,orders,production,dispatch,customers,support,content,reports,app}.js`. Staff never download studio
code and customers never download admin code. It reuses the storefront's
session cookie (same origin), so there is only one login. The palette
tokens are deliberately duplicated rather than imported — same design
language, independent files, so neither app can break the other.

**Backend** (`backend/`)
- `printly_backend.py` — Flask entry point (port 5001): serves the
  frontend, AI image generation, and registers every blueprint below.
  Accounts, orders, designs and reviews all need it running.
- `db.py` — shared SQLite (WAL) connection + schema for `generations`,
  `users`, `orders`, `login_attempts`, `ai_inflight`, `saved_designs`,
  `reviews`. Always `get_db()`, never `sqlite3.connect()` directly.
  New columns on existing tables need `_add_column()` — `CREATE TABLE
  IF NOT EXISTS` silently skips them.
- `auth.py` — signup/login/logout/me/change-password, session cookies,
  DB-backed per-email and per-IP rate limiting (in-memory wouldn't work
  once gunicorn forks workers). `ADMIN_EMAIL` is a **bootstrap only**: it
  grants `owner` to the first signup with that address and is ignored once
  an owner exists, so learning the address later gets you nothing.
- `permissions.py` — the role→module matrix, and the `require("<module>")`
  decorator every admin route should use. The panel's sidebar is built
  from the same matrix the API enforces, so a menu can't offer something
  the server would refuse. `owner_required` guards staff and settings.
- `admin_api.py` — panel session, dashboard, `pulse` (polled live data),
  company profile, staff CRUD, audit log. `log()` here is how any staff
  action gets recorded.
- `production.py` — the print floor's view: open orders grouped by *blank*
  (product + garment colour) so a batch of twelve green polos is pulled
  once rather than per order; the artwork file list matched back to orders,
  with orphan detection; and proof-SLA tracking against the storefront's
  2-hour promise.
- `dispatch.py` + `documents.py` — parcels and the paperwork on them.
  Three things here are not free to be approximate. **The invoice number** is
  a consecutive series unique within a financial year (April–March),
  allocated inside the issuing transaction. **The tax split** is CGST+SGST
  when the parcel stays in the seller's state and IGST when it crosses one —
  decided by comparing GST state codes, and flagged on the document when
  either state is missing rather than guessed. **The frozen copy**:
  `orders.invoice_json` is what gets reprinted, never a recomputation, and
  issuing is idempotent because a second number would leave the first
  unaccounted for. Documents are standalone server-rendered HTML that set
  their own `@page` size (A4 invoice, 4×6in label) — no PDF library, because
  the browser already has one and the host has 1GB. Labels are addressed by
  **shipment id**, not order id: an order that went out twice has two AWBs.
- `customers.py` — there is no customers *table*: a customer is a `users`
  row with the default role, and lifetime value, order count and addresses
  are all derived from their orders. `award_points()` is the **only** way
  loyalty points move; it writes the ledger row and the running total
  together so the two can't drift, and every adjustment demands a reason.
- `support.py` — tickets, both sides of the conversation. A ticket can hang
  off an order or stand alone, which is why `order_id` is nullable rather
  than tickets being a child of orders. `internal` marks a staff-only note
  on the same thread — the customer endpoints filter those out, and that
  filter is the single thing standing between "customer sounds annoyed,
  refund if she pushes" and the customer reading it. A customer replying to
  a closed ticket reopens it.
- `content.py` — templates, review moderation and **print zones**. Zones
  moved out of `js/mockup-data.js` and into the `print_zones` table so a
  measurement can be corrected without a deploy; `catalog_payload()` ships
  them and `mockups.js` merges them over the file defaults, which stay as the
  fresh-install seed. They matter more than they look — `sizeScale()` derives
  every garment size from the reference zone, so one wrong figure is wrong on
  all six at once. Review moderation **hides, never deletes**, and `hidden=0`
  must be on all three review queries (list, per-product average, and the grid
  rollup in `summary()`) or a hidden one-star still drags the rating down.
- `reports.py` — sales, throughput, stock valuation, AI usage, all computed
  from the same rows the rest of the panel reads. No summary tables: one that
  drifts from the orders it describes is worse than no report. Money excludes
  cancelled orders, counts include them, and every screen says which. Stage
  dwell is measured only across stages an order has actually **left** —
  assuming "until now" would make a stalled queue look fast.
- `catalog.py` — products, price tiers, colour x size variants, stock and
  the movement ledger. `quote()` is the **only** authority on what an order
  costs; `catalog_payload()` is the JSON the storefront is built from.
  `apply_stock()` deliberately never blocks a sale — stock starts at zero
  because nobody has counted the blanks, so refusing orders on a zero count
  would take the shop offline. Negative stock is surfaced as an alert.
- `orders.py` — place/list orders, admin pipeline, loyalty award. Order
  IDs (`PL-1001`) are computed from the integer PK, never stored — don't
  reintroduce a string primary key, it raced under concurrent inserts.
  **Order totals are computed server-side** from `price_tiers` and the
  company's GST/shipping settings; the browser's figure is only compared
  against it, and a mismatch over Rs 1 is a 409, never a silent charge.
  A delivery address is **required** to place an order. Stages move in
  either direction and every change writes to `order_events`; cancelling
  sets a separate `cancelled` flag rather than a 7th stage, so restoring
  resumes where the order was. `/api/admin/orders` returns per-line
  summaries only — putting `items_json` in the list made it 234KB for
  four orders, since each line carries a base64 thumbnail.
  Bulk stage moves report per-order outcomes rather than failing the whole
  call — a cancelled order in the selection legitimately can't move.
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

Assets are served with a 30-day `max-age`. Both `index.html` files are
served `no-cache` and their `{{V}}` placeholders are replaced with a token
derived from the newest mtime across `css/`, `js/`, `admin/css/` and
`admin/js/`, so a changed file gets a new URL. **If you add a new CSS or JS
file, give its `<link>`/`<script>` a `?v={{V}}`; if you add a new asset
*directory*, add it to `_asset_version()`** — the admin folder was missed
once and an edited stylesheet silently kept serving the cached copy.

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
- **Password fields get a reveal toggle automatically.**
  `enhancePasswordFields()` (in `auth.js`, and again in `admin/js/api.js` —
  the two apps share no files) walks the DOM and wraps every
  `input[type=password]`. Add a password field anywhere and call it again
  after rendering; don't hand-build a toggle. Its `.pw-wrap input`
  padding-right is what keeps revealed text off the icon, so it must
  outrank the base input rule — in `printly.css` that's source order, in
  `admin.css` it's why the base rule uses `:where()`.
- **Quantity comes from `state.sizes`, never a separate field.** The
  per-size breakdown is the input; total is `sizeTotal(state.sizes)`.
  Don't reintroduce a standalone quantity control — two inputs for one
  number will drift apart. One-size products (`ONE_SIZE` in `data.js`)
  use a single `One size` key. The studio's size picker has **two faces**
  over that one object: `state.orderMode` is `'single'` (size chips + a
  quantity, where exactly one key is non-zero and "which size" is *derived*
  by `currentSize()`) or `'bulk'` (the full per-size grid). It's a view
  mode — neither face stores a quantity of its own.
- **Nothing is pre-selected in the size picker.** A default M that looks
  chosen is how someone orders the wrong shirt. The only exception is a
  one-size product, where there's nothing to get wrong. `pickProduct()`
  carries the PDP's visibly-selected size across; that's a choice the
  customer saw, not a guess.
- **Never hardcode a tax or shipping figure.** Both come from the `company`
  row: the server reads them via `tax_settings()`, the browser via
  `TAX` (`data.js`), which the `/` route inlines with the catalogue. The
  studio once used `qty >= 50` for free shipping while the cart used a
  ₹10,000 subtotal, and quoted totals the cart then contradicted.
- **GST is two slabs applied per piece**, not one rate on the subtotal: 5%
  up to `gst_threshold` (₹1,000/piece, statutory) and 12% above, strictly
  greater-than so a piece at exactly ₹1,000 stays low. One order can carry
  both. The value that decides the slab is the **tier price**, so a bulk
  discount below the threshold legitimately moves a line down a slab.
  `gst_rate()` in `catalog.py` and `gstRate()` in `cart.js` must agree
  exactly or checkout 409s.
- **`orders.tax_json` freezes the server's pricing at order time** —
  per-line unit price, the slab each line fell into, and the totals. Rates
  are admin-editable, so an invoice reprinted later must not restate what
  the customer paid. NULL on pre-existing orders; the drawer says so rather
  than showing today's rates as if they were billed.
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
- **Placement presets** (`PLACEMENTS`, `placementBox()`, `fitLayerToBox()` in
  `studio.js`) put the selected layer at an industry-standard spot — Left/
  Center/Right Chest, Center Back, Full Front/Back — sized and positioned as
  a fraction of `pa()`, so they track garment size and product changes for
  free. `fitLayerToBox()` solves the font size directly (canvas text metrics
  scale linearly with size) rather than shrinking in a loop against
  `layerBounds()`'s *padded* box — that padding (16px text / 12px image) is
  a third of a ~35px chest box, and chasing it in a loop can walk long text
  to the size floor without ever converging. Returns `true` when the floor
  had to bind, so the caller can say "tight fit, try Center Chest" instead
  of silently shipping illegible text.
- **The canvas is drawn to the garment size.** `MOCK.print` describes
  the size at `REF_INDEX` in every size chart (position 1 — "M" on the
  shared adult scale); every other size is that photo scaled by the chest
  ratio out of the product's own size chart (`sizeScale()` in `mockups.js`).
  It indexes by *position*, not by matching a label, so a product with its
  own size labels (kids' age bands, via `products.size_labels_json` and
  `sizeKeys()`) scales correctly too.
  `mockLayout()` scales the zone's px box *and* its cm figures by the same
  factor, so **`pxcm()` is identical at every size** — that's the invariant
  that keeps a 20cm print 20cm wide when you switch S→3XL, and it must not
  be broken. `previewSize()` returns the **smallest size in the order**, so
  the "will be cropped" warning is automatically the strictest one: fits on
  screen ⇒ fits every garment ordered. `printSpec()` records
  `zone.size`; without it the cm figures are unreadable on the print floor.
  A *product* change remaps artwork with shrinking, a *size* change without
  — the print is a fixed physical thing, the garment moves around it.
  ⚠️ The base zone figures (`rn` front claims 38×50cm on an M) look
  generous; scaling can't fix wrong reference data. They are editable now —
  Content → Product photos — so this is a measurement to take, not a code
  change to make.
- **Zoom is a CSS transform on `#teeCanvas` alone** (`zoomToBox()`/
  `zoomOut()`) — the internal 520×560 drawing space never changes, so
  nothing downstream (`pos()`, layer math, `capturePrintArt()`) needs to
  know the view is zoomed. `pos()` already reads the canvas's *live*
  `getBoundingClientRect()`, which reflects the transform, so drag/resize/
  click hit-testing keep working through a zoom with no changes needed.
  `.canvas-frame` (`overflow:hidden`) is what clips it — sizing lives there
  now, not on `#teeCanvas`. A zoom has to be exited (`zoomOut()`) on side
  switch, product change and size change, since the box it was framing
  belonged to the print area *before* that change moved it — do this at
  each site that recomputes `pa()`, not just once centrally.
- **`drawRuler()` measures the print zone**, is positioned over it from the
  canvas's *rendered* width, and relabels on every draw. Any change to the
  canvas's CSS width needs a `draw()` — that's what the resize listener in
  `studio.js` is for.
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

- ~~**Razorpay**~~ — done: `payments.py` wraps the REST API with `requests`
  (no SDK), and `PAYMENTS_ENABLED` mirrors `EMAIL_ENABLED` so a shop with no
  keys falls back to COD and behaves exactly as before. An online order is
  INSERTed as `payment_status='pending'` with **no** side effects — no stock,
  no promo burned, no points, no email — and is filtered out of My Orders,
  the admin list, the production queue and every revenue figure. All of that
  happens in `confirm_payment()`, which is idempotent on `orders.paid_at`
  because Razorpay retries webhooks and the browser callback races them.
  The webhook is the only unauthenticated POST in the codebase: it verifies
  an HMAC over the **raw request body** (never a re-serialised dict) with
  `compare_digest`. What's left is business, not code: live keys, and
  refunds.
- ~~**GST**~~ — done: two slabs, per piece, admin-editable, with invoices.
  What's left is data, not code: the **GSTIN** (Settings → Company profile,
  still blank) and the per-product **HSN codes**. Dispatch and the invoice
  both warn while either is missing.
- **Courier integration** — none. Couriers are typed in with their AWB by
  hand; nothing calls Delhivery or Shiprocket, and the label's stripe is a
  visual check for humans, not a scannable barcode.
- **Parcel weight** is entered by hand because no product carries a weight.
  A `grams` column on `products` would let dispatch prefill it.
- **Loyalty redemption** — points accrue on a placeholder rule (1 per
  ₹100) with no way to spend them and no agreed policy. The *ledger* is
  real now (every movement recorded, balances reconcile); the **policy**
  still isn't. Don't advertise points to customers until it is.
- Verified-email / password reset, live deployment, PWA. See README.
