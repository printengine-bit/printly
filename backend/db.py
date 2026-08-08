# ── Shared SQLite connection helper (WAL mode) ──────────────────
# One connection per request (Flask's `g`), reused across the auth/
# orders/AI-generation blueprints. WAL mode lets reads and writes
# proceed concurrently instead of blocking each other, which matters
# once gunicorn runs multiple worker threads/processes.
import os, sqlite3
from flask import g

# `or` (not dict.get's default arg) so a DB_PATH env var that's present-but-
# blank — common on hosting dashboards where an unset field still submits as
# an empty string — falls back correctly instead of resolving to "".
DB_PATH = os.environ.get("DB_PATH") or os.path.join(os.path.dirname(__file__), "printly.db")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA synchronous=NORMAL")
        g.db.execute("PRAGMA busy_timeout=5000")
        g.db.execute("PRAGMA foreign_keys=ON")
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    # Create the parent directory if it isn't there. On a host with a mounted
    # volume it always is — but if DB_PATH is misconfigured, sqlite's error is
    # just "unable to open database file", which reads like corruption rather
    # than a wrong path.
    parent = os.path.dirname(os.path.abspath(DB_PATH))
    if parent:
        os.makedirs(parent, exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("""CREATE TABLE IF NOT EXISTS generations(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT, model TEXT, cost_inr REAL,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'customer',
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS orders(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        total_inr REAL NOT NULL,
        status INTEGER NOT NULL DEFAULT 0,
        items_json TEXT NOT NULL,
        created TEXT DEFAULT CURRENT_TIMESTAMP,
        updated TEXT DEFAULT CURRENT_TIMESTAMP)""")
    # ── Catalogue ────────────────────────────────────────────────
    # Products used to be a hardcoded array in frontend/js/data.js, shipped
    # to the browser. Nothing about stock, admin-editable pricing or
    # server-computed totals was possible while that was true.
    c.execute("""CREATE TABLE IF NOT EXISTS products(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '',
        fabric TEXT NOT NULL DEFAULT '',
        care_json TEXT NOT NULL DEFAULT '[]',
        fit_label TEXT NOT NULL DEFAULT '',
        size_chart_json TEXT NOT NULL DEFAULT '{}',
        base_price REAL NOT NULL DEFAULT 0,
        -- Blank until Print Engine is GST-registered. Kept here so the column
        -- doesn't need adding under time pressure the day it is.
        hsn_code TEXT NOT NULL DEFAULT '',
        one_size INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0,
        created TEXT DEFAULT CURRENT_TIMESTAMP,
        updated TEXT DEFAULT CURRENT_TIMESTAMP)""")

    # Bulk pricing. Highest min_qty at or below the ordered quantity wins.
    c.execute("""CREATE TABLE IF NOT EXISTS price_tiers(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        min_qty INTEGER NOT NULL,
        unit_price REAL NOT NULL)""")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_tier ON price_tiers(product_id,min_qty)")

    # Configurable printable views. `group_key` lets two physical views share
    # one commercial option (left + right sleeve are a single "Sleeves"
    # surcharge), while each view keeps its own mockup and print zone.
    c.execute("""CREATE TABLE IF NOT EXISTS product_print_views(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        view_key TEXT NOT NULL,
        label TEXT NOT NULL,
        group_key TEXT NOT NULL,
        mock_key TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 0,
        default_enabled INTEGER NOT NULL DEFAULT 0,
        surcharge REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0,
        UNIQUE(product_id,view_key))""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_print_views_product "
              "ON product_print_views(product_id,active,sort)")

    # The actual stockable unit: one product in one colour in one size.
    c.execute("""CREATE TABLE IF NOT EXISTS variants(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        color_hex TEXT NOT NULL,
        color_name TEXT NOT NULL,
        size_label TEXT NOT NULL,
        sku TEXT NOT NULL,
        stock_qty INTEGER NOT NULL DEFAULT 0,
        low_stock_at INTEGER NOT NULL DEFAULT 10,
        active INTEGER NOT NULL DEFAULT 1)""")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_variant ON variants(product_id,color_hex,size_label)")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_sku ON variants(sku)")

    # One-time data changes that must also reach an existing production
    # volume. Catalogue seeds intentionally do not overwrite a live shop.
    c.execute("""CREATE TABLE IF NOT EXISTS app_migrations(
        name TEXT PRIMARY KEY,
        applied TEXT DEFAULT CURRENT_TIMESTAMP)""")

    # Append-only ledger. stock_qty is a running total you could rebuild
    # from these rows — keep it that way, so a wrong count is always
    # explainable rather than just wrong.
    c.execute("""CREATE TABLE IF NOT EXISTS stock_moves(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        variant_id INTEGER NOT NULL REFERENCES variants(id),
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        order_id INTEGER,
        actor_id INTEGER REFERENCES users(id),
        note TEXT NOT NULL DEFAULT '',
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_moves_variant ON stock_moves(variant_id)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_moves_created ON stock_moves(created)")

    # Single-row business identity. Delivery notes and shipping labels are
    # unprintable without it, and the GSTIN stays blank until Print Engine is
    # actually registered — see the note on doc_prefix below.
    c.execute("""CREATE TABLE IF NOT EXISTS company(
        id INTEGER PRIMARY KEY CHECK (id = 1),
        legal_name TEXT NOT NULL DEFAULT '',
        trade_name TEXT NOT NULL DEFAULT 'Print Engine',
        address TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT '',
        pincode TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        gstin TEXT NOT NULL DEFAULT '',
        -- Document numbering. Without a GSTIN these are delivery *notes*,
        -- not tax challans, so the series is ours to define.
        doc_prefix TEXT NOT NULL DEFAULT 'PL',
        challan_next INTEGER NOT NULL DEFAULT 1,
        updated TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("INSERT OR IGNORE INTO company(id) VALUES(1)")
    # Tax and shipping. These were constants in the browser (cart.js), which
    # made them both unchangeable by the shop and trivially editable by the
    # customer. The server is now the only place they're read from.
    # gst_percent starts at the 5% the storefront was already charging —
    # deliberately not silently zeroed, even though there's no GSTIN yet.
    # The admin panel flags the mismatch; changing it is a business call.
    _add_column(c, "company", "gst_percent", "REAL NOT NULL DEFAULT 5")
    _add_column(c, "company", "shipping_flat", "REAL NOT NULL DEFAULT 99")
    _add_column(c, "company", "free_shipping_over", "REAL NOT NULL DEFAULT 10000")
    # Apparel GST is two slabs, not one rate: 5% up to the threshold and 12%
    # above it, applied PER PIECE on the sale value — so the same order can
    # carry both. gst_percent above is the lower slab; these two complete it.
    # The threshold is the statutory Rs 1,000 per piece and the comparison is
    # strictly greater-than, so a piece sold at exactly Rs 1,000 stays at 5%.
    _add_column(c, "company", "gst_percent_high", "REAL NOT NULL DEFAULT 12")
    _add_column(c, "company", "gst_threshold", "REAL NOT NULL DEFAULT 1000")

    # Everything a staff member does, to anything — append-only. Supersedes
    # order_events (backfilled below) so there's one place to answer "who
    # changed this, and when".
    c.execute("""CREATE TABLE IF NOT EXISTS audit_log(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        actor_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        from_val TEXT,
        to_val TEXT,
        note TEXT NOT NULL DEFAULT '',
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity_type, entity_id)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created)")

    # Every admin action on an order, append-only. Stage changes are no longer
    # forward-only, so without this a mistaken edit would be indistinguishable
    # from the real history — and "who marked this delivered?" is exactly the
    # question you need answered when a customer complains.
    c.execute("""CREATE TABLE IF NOT EXISTS order_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        actor_id INTEGER REFERENCES users(id),
        kind TEXT NOT NULL,
        from_status INTEGER,
        to_status INTEGER,
        note TEXT NOT NULL DEFAULT '',
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_events_order ON order_events(order_id)")
    c.execute("""CREATE TABLE IF NOT EXISTS login_attempts(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT, ip TEXT,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")

    # ── Email ────────────────────────────────────────────────────
    # Every send attempt, append-only — including the ones that were skipped
    # because no API key is configured, and the ones that failed. Sending is
    # deliberately never load-bearing (see mailer.send), which means a
    # failure is silent unless it is written down somewhere. Same reasoning
    # as stock_moves: a wrong number you can see beats one you can't.
    c.execute("""CREATE TABLE IF NOT EXISTS email_log(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        to_email TEXT NOT NULL,
        sender TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT '',
        entity_type TEXT NOT NULL DEFAULT '',
        entity_id INTEGER,
        status TEXT NOT NULL DEFAULT '',
        provider_id TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_email_kind ON email_log(kind, created)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_email_to ON email_log(to_email)")

    # Password reset tokens. The token itself is NEVER stored — only its
    # SHA-256 hash, for the same reason passwords are hashed: a leaked
    # database must not hand out account takeovers. Single-use and
    # short-lived; see auth.forgot_password().
    c.execute("""CREATE TABLE IF NOT EXISTS password_resets(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token_hash TEXT NOT NULL,
        expires TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_reset_token ON password_resets(token_hash)")
    # Saved designs — "My Designs". layers_json is the canvas snapshot WITH
    # image data kept inline (unlike the cart's stripImg()), because a design
    # has to be fully restorable. See designs.py for the size/count caps that
    # keep that from filling the disk.
    c.execute("""CREATE TABLE IF NOT EXISTS saved_designs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        product_id TEXT NOT NULL,
        shirt_color TEXT NOT NULL,
        layers_json TEXT NOT NULL,
        thumb TEXT,
        is_template INTEGER NOT NULL DEFAULT 0,
        created TEXT DEFAULT CURRENT_TIMESTAMP,
        updated TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_designs_user ON saved_designs(user_id)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_designs_template ON saved_designs(is_template)")
    # Product reviews. One per user per product (enforced by the unique index)
    # and only from someone who actually ordered it — see reviews.py.
    c.execute("""CREATE TABLE IF NOT EXISTS reviews(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        rating INTEGER NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_review_user_product ON reviews(user_id, product_id)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_reviews_product ON reviews(product_id)")
    # Wishlist. product_id is the catalogue slug, same convention as
    # reviews.product_id above — no FK to products.id, so it survives a
    # product rename and the frontend never needs a join to render it.
    c.execute("""CREATE TABLE IF NOT EXISTS wishlist(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        product_id TEXT NOT NULL,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_wishlist_user_product ON wishlist(user_id, product_id)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_wishlist_user ON wishlist(user_id)")
    # A saved address book, separate from orders.ship_* — those freeze what
    # was actually shipped to (never rewritten after the fact, same reason
    # tax_json is frozen); this is what checkout offers to prefill next time.
    c.execute("""CREATE TABLE IF NOT EXISTS addresses(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        label TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        line1 TEXT NOT NULL DEFAULT '',
        line2 TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT '',
        pincode TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_addresses_user ON addresses(user_id)")
    # Promo codes. `code` is always stored upper-cased (promo.py normalises
    # on both write and read) so lookups never need a case-insensitive
    # comparison. Redemptions are a ledger, not a counter on promo_codes
    # itself — max_uses and per_user_limit are both just COUNT(*) against it,
    # so there's one source of truth instead of a cached count that can drift.
    c.execute("""CREATE TABLE IF NOT EXISTS promo_codes(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'percent',
        value REAL NOT NULL,
        min_subtotal REAL NOT NULL DEFAULT 0,
        max_discount REAL,
        max_uses INTEGER,
        per_user_limit INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        expires TEXT,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS promo_redemptions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        promo_id INTEGER NOT NULL REFERENCES promo_codes(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        order_id INTEGER REFERENCES orders(id),
        discount_amount REAL NOT NULL,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_promo_redemptions_promo ON promo_redemptions(promo_id)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_promo_redemptions_user ON promo_redemptions(user_id)")
    # Opt-in, not "every active code": a code emailed to one customer or
    # handed to a corporate buyer is still active but was never meant for
    # the homepage. Only a code an admin has explicitly featured is public.
    _add_column(c, "promo_codes", "featured", "INTEGER NOT NULL DEFAULT 0")
    # Frozen on the order alongside tax_json, same reasoning as total_inr:
    # a real column so admin lists/reports can filter without parsing JSON.
    _add_column(c, "orders", "promo_code", "TEXT")
    _add_column(c, "orders", "discount_inr", "REAL NOT NULL DEFAULT 0")
    c.execute("""CREATE TABLE IF NOT EXISTS ai_inflight(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    _add_column(c, "users", "loyalty_points", "INTEGER NOT NULL DEFAULT 0")
    _add_column(c, "users", "phone", "TEXT NOT NULL DEFAULT ''")
    # Delivery address. Added after the fact, so existing rows get "" — the
    # admin UI labels those "no address recorded" rather than showing blanks.
    for col in ("ship_name", "ship_phone", "ship_line1", "ship_line2",
                "ship_city", "ship_state", "ship_pincode"):
        _add_column(c, "orders", col, "TEXT NOT NULL DEFAULT ''")
    # Cancellation is orthogonal to the 6 pipeline stages, not a 7th one:
    # keeping `status` intact means a restored order resumes where it was.
    _add_column(c, "orders", "cancelled", "INTEGER NOT NULL DEFAULT 0")
    # The server's own pricing of the order, frozen at the moment it was
    # placed: per-line unit price, the GST slab each line fell into, and the
    # totals. Without this a tax invoice reprinted after a rate change would
    # show figures the customer was never charged. NULL on orders placed
    # before this existed — recompute those at today's rates, and say so.
    _add_column(c, "orders", "tax_json", "TEXT")
    # A tax invoice, once issued, is frozen: its number, the seller and buyer
    # details, the tax split and the line values are all whatever they were
    # on the day it was raised. Reprinting must reproduce that exactly, so
    # none of it is recomputed — invoice_json holds the whole document.
    _add_column(c, "orders", "invoice_no", "TEXT")
    _add_column(c, "orders", "invoice_json", "TEXT")
    _add_column(c, "orders", "invoice_at", "TEXT")

    # ── Payment ──────────────────────────────────────────────────
    # 'razorpay' | 'cod'. Blank on every order placed before payments
    # existed, which is exactly what it means: no method was recorded.
    _add_column(c, "orders", "payment_method", "TEXT NOT NULL DEFAULT ''")
    # ⚠️ Defaults to 'paid', NOT 'pending'. Every existing order predates
    # payments and was a real order; defaulting to 'pending' would hide the
    # entire order history from the admin, the print floor and every
    # customer's My Orders the moment this deploys. An unpaid order sets
    # 'pending' explicitly at INSERT — see orders.create_order().
    _add_column(c, "orders", "payment_status", "TEXT NOT NULL DEFAULT 'paid'")
    _add_column(c, "orders", "rzp_order_id", "TEXT")
    _add_column(c, "orders", "rzp_payment_id", "TEXT")
    # The idempotency guard. Set once, inside the same transaction that moves
    # stock and points, so a replayed webhook can't run any of it twice —
    # same shape as invoice_no in dispatch._issue().
    _add_column(c, "orders", "paid_at", "TEXT")
    c.execute("CREATE INDEX IF NOT EXISTS idx_orders_payment "
              "ON orders(payment_status, created)")
    # Looked up by rzp_order_id on every webhook, which arrives without a
    # session and knows nothing about our PKs.
    c.execute("CREATE INDEX IF NOT EXISTS idx_orders_rzp ON orders(rzp_order_id)")

    # Invoice numbering. GST wants a consecutive series unique within a
    # financial year, so the year is stored alongside the counter and the
    # counter restarts when the year rolls over — see next_invoice_no().
    _add_column(c, "company", "invoice_prefix", "TEXT NOT NULL DEFAULT 'INV'")
    _add_column(c, "company", "invoice_next", "INTEGER NOT NULL DEFAULT 1")
    _add_column(c, "company", "invoice_fy", "TEXT NOT NULL DEFAULT ''")

    # One row per parcel handed to a courier. Kept separate from the order so
    # a reship after a return-to-origin is a second row, not an overwrite of
    # the first AWB — the first one still happened and the courier will bill
    # for it.
    c.execute("""CREATE TABLE IF NOT EXISTS shipments(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        courier TEXT NOT NULL DEFAULT '',
        awb TEXT NOT NULL DEFAULT '',
        boxes INTEGER NOT NULL DEFAULT 1,
        weight_g INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        actor_id INTEGER,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_shipments_created ON shipments(created)")

    # ── Loyalty ledger ──────────────────────────────────────────
    # users.loyalty_points was a bare integer that orders incremented, which
    # made "why does this customer have 340 points" unanswerable. Every
    # movement is now a row and the column is the running total: staff can
    # adjust a balance, and the reason survives them.
    c.execute("""CREATE TABLE IF NOT EXISTS loyalty_moves(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        order_id INTEGER,
        actor_id INTEGER,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_loyalty_user ON loyalty_moves(user_id)")
    # Balances that predate the ledger get one opening row each, so every
    # account reconciles to the sum of its movements. Self-guarding: once a
    # user has any row they're skipped, so this can't double-post.
    c.execute("""INSERT INTO loyalty_moves(user_id,delta,reason)
                 SELECT id, loyalty_points, 'Opening balance — earned before the ledger existed'
                 FROM users u WHERE u.loyalty_points > 0
                   AND NOT EXISTS (SELECT 1 FROM loyalty_moves m WHERE m.user_id=u.id)""")

    # ── Support ─────────────────────────────────────────────────
    # A ticket is one conversation. It can hang off an order or stand alone
    # (a pre-sales question), which is why order_id is nullable rather than
    # tickets being a child of orders.
    c.execute("""CREATE TABLE IF NOT EXISTS tickets(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        order_id INTEGER,
        subject TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'normal',
        assignee_id INTEGER,
        opened_by TEXT NOT NULL DEFAULT 'customer',
        created TEXT DEFAULT CURRENT_TIMESTAMP,
        updated TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id)")

    # Every message on a ticket, from either side. `internal` marks a staff
    # note the customer never sees — without it people write those into the
    # reply box by accident.
    c.execute("""CREATE TABLE IF NOT EXISTS ticket_messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        author_id INTEGER,
        from_staff INTEGER NOT NULL DEFAULT 0,
        internal INTEGER NOT NULL DEFAULT 0,
        body TEXT NOT NULL DEFAULT '',
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_tmsg_ticket ON ticket_messages(ticket_id)")

    # ── Content ─────────────────────────────────────────────────
    # Moderation is a flag, not a delete: a review taken down for language
    # is still evidence the purchase happened, and the customer who wrote it
    # can be told why. Nothing here removes rows.
    _add_column(c, "reviews", "hidden", "INTEGER NOT NULL DEFAULT 0")
    _add_column(c, "reviews", "hidden_reason", "TEXT NOT NULL DEFAULT ''")
    # Templates are ordered in the picker, and "whatever id it got" is not an
    # order anyone chose.
    _add_column(c, "saved_designs", "sort", "INTEGER NOT NULL DEFAULT 0")

    # What a blank costs us. Stock valued at the sell price answers the wrong
    # question — what's on the shelf is worth what it cost, not what we hope
    # to get. Defaults to 0, and the report says so rather than pretending.
    _add_column(c, "products", "cost_price", "REAL NOT NULL DEFAULT 0")

    # A product's own size labels, when its sizing doesn't match the shared
    # adult S..3XL scale (kids' age bands, for instance). NULL/empty means
    # "use the shared list" — every product keeps that behaviour by default.
    _add_column(c, "products", "size_labels_json", "TEXT")

    # Print zones move out of js/mockup-data.js and into here, so the shop can
    # correct them against a real measured blank. The file stays as the
    # fallback for a fresh install; the DB wins once seeded. Getting these
    # wrong scales every garment size wrong at once — see sizeScale().
    c.execute("""CREATE TABLE IF NOT EXISTS print_zones(
        mock_key TEXT PRIMARY KEY,
        cx REAL NOT NULL, cy REAL NOT NULL,
        w REAL NOT NULL, h REAL NOT NULL,
        cm_w REAL NOT NULL, cm_h REAL NOT NULL,
        updated TEXT DEFAULT CURRENT_TIMESTAMP)""")
    _seed_zones(c)

    c.execute("""CREATE TABLE IF NOT EXISTS canned_replies(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        sort INTEGER NOT NULL DEFAULT 0,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    _seed_canned(c)
    # Staff accounts are created by the owner, who sets the first password
    # and hands it over — there's no email transport to send an invite with.
    _add_column(c, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0")
    _add_column(c, "users", "active", "INTEGER NOT NULL DEFAULT 1")

    # 'admin' predates the role matrix in permissions.py, where the
    # full-access role is 'owner'. Rename in place so the existing account
    # keeps working instead of silently losing access.
    c.execute("UPDATE users SET role='owner' WHERE role='admin'")

    _backfill_audit(c)
    _seed_catalog(c)

    # Real category structure: who a garment is cut for, independent of what
    # kind of garment it is — filtering "Women" and "Tees" are two different
    # axes over the same table, not one hardcoded list per category.
    _needs_audience_backfill = "audience" not in {r[1] for r in c.execute("PRAGMA table_info(products)")}
    _add_column(c, "products", "audience", "TEXT NOT NULL DEFAULT 'unisex'")
    _add_column(c, "products", "category", "TEXT NOT NULL DEFAULT ''")
    if _needs_audience_backfill:
        # One-time, gated on the column not existing yet — never repeats, so
        # an admin's later edits to these same fields are never undone by a
        # future boot. The original catalogue was implicitly a men's/unisex
        # cut; tagging it explicitly is what makes "Men" as a filter mean
        # something now that real Women's lines exist alongside it.
        c.executemany(
            "UPDATE products SET audience=?, category=?, name=? WHERE slug=?", [
            ("men", "tees", "Men's Round Neck T-Shirt", "rn"),
            ("men", "polos", "Men's Polo Shirt", "po"),
            ("men", "hoodies", "Men's Hoodie", "hd"),
            ("unisex", "jerseys", "Sports Jersey", "js"),
            ("unisex", "bags", "Tote Bag", "tb"),
        ])
    _seed_women_lines(c)
    _seed_kids_lines(c)
    _migrate_kids_sizing(c)
    _replace_legacy_palette(c)
    _seed_print_views(c)

    c.commit()
    c.close()


def _backfill_audit(conn):
    """Copy order_events into audit_log once, so the switch to one log
    doesn't lose the history already recorded against orders.

    Guarded on there being no order rows in audit_log rather than on a
    version flag — re-running init_db() must not duplicate the history.
    order_events is left in place until the new log has been verified in
    production; dropping it is a separate, deliberate step.
    """
    already = conn.execute(
        "SELECT 1 FROM audit_log WHERE entity_type='order' LIMIT 1"
    ).fetchone()
    if already:
        return
    conn.execute("""
        INSERT INTO audit_log(entity_type,entity_id,actor_id,action,from_val,to_val,note,created)
        SELECT 'order', order_id, actor_id, kind,
               CAST(from_status AS TEXT), CAST(to_status AS TEXT), note, created
        FROM order_events ORDER BY id""")


# The catalogue exactly as it was hardcoded in frontend/js/data.js,
# frontend/js/pdp.js (FABRIC, SIZE_CHART) and the SHIRT_COLORS list. Seeded
# once so moving to the database changes nothing a customer can see —
# everything after this is edited in the admin panel, not here.
SIZES = ["S", "M", "L", "XL", "2XL", "3XL"]
COLORS = [
    ("#111111", "Black",        "BLK"),
    ("#FFFFFF", "White",        "WHT"),
    ("#101C36", "Navy",         "NVY"),
    ("#8B8E91", "Grey",         "GRY"),
    ("#930600", "Maroon",       "MRN"),
    ("#C2BE72", "Olive",        "OLV"),
    ("#F51B18", "Red",          "RED"),
    ("#FFF200", "Yellow",       "YLW"),
    ("#987252", "Brown",        "BRN"),
    ("#314E63", "Steel Blue",   "SBL"),
    ("#E7C9EE", "Light Purple", "LPR"),
    ("#85008E", "Purple",       "PUR"),
    ("#56605B", "Charcoal",     "CHR"),
]
SEED_PRODUCTS = [
    {"slug": "rn", "name": "Round Neck T-Shirt", "emoji": "👕", "base": 599,
     "tiers": [(1, 599), (10, 449), (50, 349), (100, 279)],
     "fabric": "180 GSM · 100% combed cotton, bio-washed", "fit": "Regular fit",
     "care": ["Machine wash cold, inside out", "Do not bleach", "Tumble dry low",
              "Warm iron, avoid the print"],
     "chest": [46, 48, 51, 54, 56, 59], "length": [68, 71, 74, 76, 79, 81]},
    {"slug": "po", "name": "Polo Shirt", "emoji": "🎽", "base": 899,
     "tiers": [(1, 899), (10, 699), (50, 549), (100, 449)],
     "fabric": "220 GSM · pique cotton with rib collar", "fit": "Regular fit",
     "care": ["Machine wash cold", "Do not bleach", "Hang dry in shade",
              "Iron on reverse"],
     "chest": [47, 49, 52, 55, 57, 60], "length": [69, 71, 74, 76, 79, 81]},
    {"slug": "hd", "name": "Hoodie", "emoji": "🧥", "base": 1299,
     "tiers": [(1, 1299), (10, 999), (50, 799), (100, 649)],
     "fabric": "320 GSM · brushed fleece, cotton-poly blend", "fit": "Oversized fit",
     "care": ["Machine wash cold, inside out", "Do not bleach", "Tumble dry low",
              "Do not iron the print"],
     "chest": [54, 56, 59, 61, 64, 66], "length": [68, 70, 72, 74, 76, 78]},
    {"slug": "js", "name": "Sports Jersey", "emoji": "🏏", "base": 799,
     "tiers": [(1, 799), (10, 599), (50, 499), (100, 399)],
     "fabric": "130 GSM · dry-fit polyester, moisture wicking", "fit": "Athletic fit",
     "care": ["Machine wash cold", "No fabric softener", "Hang dry",
              "Do not iron directly"],
     "chest": [45, 47, 50, 53, 55, 58], "length": [70, 72, 74, 76, 78, 80]},
    {"slug": "tb", "name": "Tote Bag", "emoji": "👜", "base": 399,
     "tiers": [(1, 399), (10, 299), (50, 249), (100, 199)],
     "fabric": "12 oz · heavy canvas cotton", "fit": "One size", "one_size": True,
     "care": ["Spot clean or hand wash", "Do not bleach", "Air dry flat"],
     "chest": [38], "length": [42]},
]
ONE_SIZE_KEY = "One size"


# The zones the mockup photos were measured with. Mirrors the `print` block
# in frontend/js/mockup-data.js — that file remains the shipped default and
# this is the seed for a fresh database, after which the DB is authoritative.
SEED_ZONES = {
    "rn":      (363, 300, 230, 300, 38, 50),
    "rn_back": (360, 300, 240, 320, 40, 53),
    "po":      (361, 315, 190, 240, 28, 35),
    "po_back": (363, 300, 230, 300, 38, 48),
    "hd":      (360, 255, 220, 230, 36, 36),
    "hd_back": (360, 300, 235, 320, 38, 53),
    # Generated side-profile hoodie photos are 1280px square. These are
    # conservative starter zones; the admin zone screen remains the authority
    # after the physical blank is measured.
    "hd_left_sleeve":  (650, 680, 150, 560, 10, 32),
    "hd_right_sleeve": (650, 680, 150, 560, 10, 32),
    "js":      (360, 330, 230, 300, 36, 46),
    "js_back": (342, 360, 250, 360, 38, 52),
}


PRINT_VIEW_SEED = {
    "rn": [
        ("front", "Front", "front", "rn", 1, 1, 0, 0),
        ("back", "Back", "back", "rn_back", 0, 0, 100, 1),
    ],
    "po": [
        ("front", "Front", "front", "po", 1, 1, 0, 0),
        ("back", "Back", "back", "po_back", 0, 0, 120, 1),
    ],
    "hd": [
        ("front", "Front", "front", "hd", 1, 1, 0, 0),
        ("back", "Back", "back", "hd_back", 0, 0, 130, 1),
        ("left_sleeve", "Left sleeve", "sleeves", "hd_left_sleeve", 0, 0, 130, 2),
        ("right_sleeve", "Right sleeve", "sleeves", "hd_right_sleeve", 0, 0, 130, 3),
    ],
    "js": [
        ("front", "Front", "front", "js", 1, 1, 0, 0),
        ("back", "Back", "back", "js_back", 0, 0, 100, 1),
    ],
    "tb": [("front", "Front", "front", "tb", 1, 1, 0, 0)],
    "rn-women": [("front", "Front", "front", "rn", 1, 1, 0, 0)],
    "po-women": [("front", "Front", "front", "po", 1, 1, 0, 0)],
    "hd-women": [("front", "Front", "front", "hd", 1, 1, 0, 0)],
    "rn-oversized-women": [("front", "Front", "front", "rn", 1, 1, 0, 0)],
    "sw-women": [("front", "Front", "front", "rn", 1, 1, 0, 0)],
    "rn-kids": [("front", "Front", "front", "rn", 1, 1, 0, 0)],
    "hd-kids": [("front", "Front", "front", "hd", 1, 1, 0, 0)],
    "sw-kids": [("front", "Front", "front", "rn", 1, 1, 0, 0)],
}


def _seed_print_views(conn):
    """Add missing view rows without overwriting later admin changes."""
    for slug, views in PRINT_VIEW_SEED.items():
        p = conn.execute("SELECT id FROM products WHERE slug=?", (slug,)).fetchone()
        if not p:
            continue
        for key, label, group, mock, required, default, fee, sort in views:
            conn.execute(
                """INSERT OR IGNORE INTO product_print_views(
                       product_id,view_key,label,group_key,mock_key,required,
                       default_enabled,surcharge,sort)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (p[0], key, label, group, mock, required, default, fee, sort))
            # Older audience lines already have the generic slug-as-mock
            # fallback inserted below. Upgrade only that untouched fallback;
            # a mock chosen later in the admin remains authoritative.
            conn.execute(
                """UPDATE product_print_views SET mock_key=?
                   WHERE product_id=? AND view_key=? AND mock_key=?""",
                (mock, p[0], key, slug))

    # New catalogue lines without dedicated photography still get a safe,
    # front-only vector view instead of inheriting another garment's zone.
    conn.execute(
        """INSERT OR IGNORE INTO product_print_views(
               product_id,view_key,label,group_key,mock_key,required,
               default_enabled,surcharge,sort)
           SELECT id,'front','Front','front',slug,1,1,0,0
           FROM products""")


def _seed_zones(conn):
    """Guarded per key rather than on the table being empty, so a mockup
    added to the file later still gets its row without disturbing zones the
    shop has already corrected."""
    for key, v in SEED_ZONES.items():
        conn.execute(
            """INSERT OR IGNORE INTO print_zones(mock_key,cx,cy,w,h,cm_w,cm_h)
               VALUES(?,?,?,?,?,?,?)""", (key,) + v)


def _seed_canned(conn):
    """Starter canned replies. Guarded on the table being empty, like the
    catalogue seed — once the shop has written its own, re-adding these on
    every boot would be an unwelcome surprise."""
    if conn.execute("SELECT 1 FROM canned_replies LIMIT 1").fetchone():
        return
    for i, (title, body) in enumerate((
        ("Proof on the way",
         "Thanks for your order! Our team is preparing your digital proof and "
         "you'll have it within 2 hours. Nothing goes to print until you approve it."),
        ("Asking for artwork",
         "To get this printed at the best possible quality, could you send us the "
         "original artwork file? A PNG or PDF at the size you want it printed is ideal."),
        ("Size guidance",
         "Our tees run true to size with a regular fit. The size guide on the product "
         "page lists chest and length for every size — measure a shirt you already own "
         "flat across the chest and match it to the chart."),
        ("Dispatched",
         "Good news — your order has been dispatched. The courier and tracking number "
         "are on your order page, and delivery usually takes 3–5 days from Pune."),
        ("Reprint for a print defect",
         "Sorry about that — that's not the standard we print to. We'll reprint and "
         "dispatch a replacement at no cost. Could you send a photo of the print so "
         "we can check it against the press settings?"),
    )):
        conn.execute("INSERT INTO canned_replies(title,body,sort) VALUES(?,?,?)",
                     (title, body, i))


def _seed_catalog(conn):
    """Populate the catalogue on a database that has none.

    Guarded on the products table being empty, not on a version flag: once
    a shop has edited its own prices, re-running this would overwrite them
    with the originals. Adding a product later is an admin action.
    """
    if conn.execute("SELECT 1 FROM products LIMIT 1").fetchone():
        return
    import json as _json
    for i, p in enumerate(SEED_PRODUCTS):
        one_size = 1 if p.get("one_size") else 0
        cur = conn.execute(
            """INSERT INTO products(slug,name,emoji,fabric,care_json,fit_label,
                                    size_chart_json,base_price,one_size,sort)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (p["slug"], p["name"], p["emoji"], p["fabric"], _json.dumps(p["care"]),
             p["fit"], _json.dumps({"chest": p["chest"], "length": p["length"]}),
             p["base"], one_size, i),
        )
        pid = cur.lastrowid
        for min_qty, price in p["tiers"]:
            conn.execute(
                "INSERT INTO price_tiers(product_id,min_qty,unit_price) VALUES(?,?,?)",
                (pid, min_qty, price))
        labels = [ONE_SIZE_KEY] if one_size else SIZES
        for hexv, cname, code in COLORS:
            for label in labels:
                sku = "%s-%s-%s" % (p["slug"].upper(), code,
                                    label.upper().replace(" ", ""))
                conn.execute(
                    """INSERT INTO variants(product_id,color_hex,color_name,
                                            size_label,sku) VALUES(?,?,?,?,?)""",
                    (pid, hexv, cname, label, sku))
    # Stock starts at zero everywhere. That's honest — nobody has counted
    # the blanks yet — and it's why placing an order must NOT be blocked on
    # stock. See catalog.py's apply_stock().


# Real Women's product lines — not the same three garments re-tagged, but
# their own size charts. The numbers are a genuine women's-fit chart, not
# the Men's numbers copied across: a Women's Round Neck at "M" is not the
# same chest measurement as a Men's Round Neck at "M", and showing the
# men's figures under a women's label would be actively wrong. Kept in the
# same S–3XL label scale as the rest of the catalogue on purpose — the
# frontend's sizeKeys()/SIZES are global, not per-product, so a genuinely
# different label scale (XS–XL) is real frontend work, not a data change;
# the label staying shared while the measurements underneath it don't is
# the pragmatic version of this until that's worth doing.
SEED_WOMEN_PRODUCTS = [
    {"slug": "rn-women", "name": "Women's Round Neck T-Shirt", "emoji": "👕", "base": 599,
     "tiers": [(1, 599), (10, 449), (50, 349), (100, 279)],
     "fabric": "180 GSM · 100% combed cotton, bio-washed", "fit": "Fitted, tapered waist",
     "care": ["Machine wash cold, inside out", "Do not bleach", "Tumble dry low",
              "Warm iron, avoid the print"],
     "chest": [40, 42, 45, 48, 51, 54], "length": [60, 62, 64, 66, 68, 70],
     "category": "tees"},
    {"slug": "po-women", "name": "Women's Polo Shirt", "emoji": "🎽", "base": 899,
     "tiers": [(1, 899), (10, 699), (50, 549), (100, 449)],
     "fabric": "220 GSM · pique cotton with rib collar", "fit": "Fitted, tapered waist",
     "care": ["Machine wash cold", "Do not bleach", "Hang dry in shade", "Iron on reverse"],
     "chest": [41, 43, 46, 49, 52, 55], "length": [61, 63, 65, 67, 69, 71],
     "category": "polos"},
    {"slug": "hd-women", "name": "Women's Hoodie", "emoji": "🧥", "base": 1299,
     "tiers": [(1, 1299), (10, 999), (50, 799), (100, 649)],
     "fabric": "320 GSM · brushed fleece, cotton-poly blend", "fit": "Cropped, fitted waist",
     "care": ["Machine wash cold, inside out", "Do not bleach", "Tumble dry low",
              "Do not iron the print"],
     "chest": [46, 48, 51, 54, 57, 60], "length": [56, 58, 60, 62, 64, 66],
     "category": "hoodies"},
    {"slug": "rn-oversized-women", "name": "Women's Oversized T-Shirt", "emoji": "👕", "base": 699,
     "tiers": [(1, 699), (10, 529), (50, 399), (100, 329)],
     "fabric": "220 GSM · heavyweight combed cotton, bio-washed", "fit": "Relaxed oversized fit",
     "care": ["Machine wash cold, inside out", "Do not bleach", "Tumble dry low",
              "Warm iron, avoid the print"],
     "chest": [48, 51, 54, 57, 60, 63], "length": [63, 65, 67, 69, 71, 73],
     "category": "tees"},
    {"slug": "sw-women", "name": "Women's Crewneck Sweatshirt", "emoji": "👚", "base": 1099,
     "tiers": [(1, 1099), (10, 849), (50, 699), (100, 579)],
     "fabric": "300 GSM · brushed cotton-rich fleece", "fit": "Relaxed fit with ribbed waist",
     "care": ["Machine wash cold, inside out", "Do not bleach", "Tumble dry low",
              "Do not iron the print"],
     "chest": [46, 49, 52, 55, 58, 61], "length": [58, 60, 62, 64, 66, 68],
     "category": "sweatshirts"},
]

# Age bands, not S..3XL — a parent shopping for a child doesn't read "3XL"
# as an 8-year-old's size. One-to-one by position with each product's own
# chest/length arrays below; the measurements aren't changing, just what
# they're called.
KIDS_SIZES = ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-11Y", "12-13Y"]

SEED_KIDS_PRODUCTS = [
    {"slug": "rn-kids", "name": "Kids' Round Neck T-Shirt", "emoji": "👕", "base": 499,
     "tiers": [(1, 499), (10, 379), (50, 299), (100, 239)],
     "fabric": "180 GSM · soft combed cotton, bio-washed", "fit": "Regular kids fit",
     "care": ["Machine wash cold, inside out", "Do not bleach", "Tumble dry low",
              "Warm iron, avoid the print"],
     "chest": [32, 35, 38, 41, 44, 47], "length": [43, 47, 51, 55, 59, 63],
     "sizes": KIDS_SIZES, "category": "tees"},
    {"slug": "hd-kids", "name": "Kids' Hoodie", "emoji": "🧥", "base": 999,
     "tiers": [(1, 999), (10, 799), (50, 649), (100, 529)],
     "fabric": "280 GSM · soft brushed fleece, cotton-rich blend", "fit": "Easy kids fit",
     "care": ["Machine wash cold, inside out", "Do not bleach", "Tumble dry low",
              "Do not iron the print"],
     "chest": [36, 39, 42, 45, 48, 51], "length": [44, 48, 52, 56, 60, 64],
     "sizes": KIDS_SIZES, "category": "hoodies"},
    {"slug": "sw-kids", "name": "Kids' Crewneck Sweatshirt", "emoji": "👚", "base": 849,
     "tiers": [(1, 849), (10, 679), (50, 549), (100, 449)],
     "fabric": "280 GSM · soft cotton-rich fleece", "fit": "Relaxed kids fit",
     "care": ["Machine wash cold, inside out", "Do not bleach", "Tumble dry low",
              "Do not iron the print"],
     "chest": [35, 38, 41, 44, 47, 50], "length": [43, 47, 51, 55, 59, 63],
     "sizes": KIDS_SIZES, "category": "sweatshirts"},
]


def _seed_audience_lines(conn, products, audience):
    """Add missing audience-specific catalogue lines without overwriting
    products, prices or inventory already managed by the shop."""
    import json as _json
    existing = {r[0] for r in conn.execute("SELECT slug FROM products").fetchall()}
    base_sort = conn.execute("SELECT COALESCE(MAX(sort),0) FROM products").fetchone()[0]
    for i, p in enumerate(products):
        if p["slug"] in existing:
            continue
        own_sizes = p.get("sizes")
        cur = conn.execute(
            """INSERT INTO products(slug,name,emoji,fabric,care_json,fit_label,
                                    size_chart_json,base_price,one_size,sort,
                                    audience,category,size_labels_json)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (p["slug"], p["name"], p["emoji"], p["fabric"], _json.dumps(p["care"]),
             p["fit"], _json.dumps({"chest": p["chest"], "length": p["length"]}),
             p["base"], 0, base_sort + i + 1, audience, p["category"],
             _json.dumps(own_sizes) if own_sizes else None),
        )
        pid = cur.lastrowid
        for min_qty, price in p["tiers"]:
            conn.execute(
                "INSERT INTO price_tiers(product_id,min_qty,unit_price) VALUES(?,?,?)",
                (pid, min_qty, price))
        for hexv, cname, code in COLORS:
            for label in (own_sizes or SIZES):
                sku = "%s-%s-%s" % (p["slug"].upper(), code, label.upper().replace(" ", ""))
                conn.execute(
                    """INSERT INTO variants(product_id,color_hex,color_name,
                                            size_label,sku) VALUES(?,?,?,?,?)""",
                    (pid, hexv, cname, label, sku))


def _seed_women_lines(conn):
    _seed_audience_lines(conn, SEED_WOMEN_PRODUCTS, "women")


def _seed_kids_lines(conn):
    _seed_audience_lines(conn, SEED_KIDS_PRODUCTS, "kids")


def _migrate_kids_sizing(conn):
    """One-time fix for kids products seeded before size_labels_json existed:
    their variants were created with adult S..3XL labels. Gated per-product
    on the product's own size_labels_json being unset — never repeats, and
    an admin's later edits to a kids product's sizing are never undone by a
    future boot. Safe to rename in place: no order has referenced these
    SKUs yet on a catalogue this new."""
    import json as _json
    adult_order = {label: i for i, label in enumerate(SIZES)}
    for p in SEED_KIDS_PRODUCTS:
        row = conn.execute(
            "SELECT id,size_labels_json FROM products WHERE slug=?",
            (p["slug"],)).fetchone()
        if not row or row[1]:
            continue
        pid = row[0]
        variants = conn.execute(
            "SELECT id,size_label,sku FROM variants WHERE product_id=?", (pid,)
        ).fetchall()
        for vid, size_label, sku in variants:
            i = adult_order.get(size_label)
            if i is None or i >= len(p["sizes"]):
                continue
            new_label = p["sizes"][i]
            code = sku.rsplit("-", 1)[0]
            new_sku = "%s-%s" % (code, new_label.upper().replace(" ", ""))
            conn.execute(
                "UPDATE variants SET size_label=?,sku=? WHERE id=?",
                (new_label, new_sku, vid))
        conn.execute("UPDATE products SET size_labels_json=? WHERE id=?",
                      (_json.dumps(p["sizes"]), pid))


def _replace_legacy_palette(conn):
    """Replace the original eight-colour launch palette once.

    Fresh databases are seeded with COLORS directly. Existing Railway
    volumes already contain variants, so they need an idempotent data
    migration: retire the old swatches and create the new catalogue colours
    for every product/size without touching historical rows or stock moves.
    """
    migration = "2026-07-30-storefront-colour-palette"
    if conn.execute("SELECT 1 FROM app_migrations WHERE name=?",
                    (migration,)).fetchone():
        return

    wanted = [hexv.upper() for hexv, _, _ in COLORS]
    marks = ",".join("?" for _ in wanted)
    conn.execute(
        f"UPDATE variants SET active=0 WHERE UPPER(color_hex) NOT IN ({marks})",
        wanted)

    for pid, slug, one_size in conn.execute(
            "SELECT id,slug,one_size FROM products").fetchall():
        labels = [r[0] for r in conn.execute(
            "SELECT DISTINCT size_label FROM variants WHERE product_id=?",
            (pid,)).fetchall()]
        if not labels:
            labels = [ONE_SIZE_KEY] if one_size else SIZES
        for hexv, cname, code in COLORS:
            for label in labels:
                row = conn.execute(
                    """SELECT id FROM variants
                       WHERE product_id=? AND UPPER(color_hex)=? AND size_label=?""",
                    (pid, hexv.upper(), label)).fetchone()
                if row:
                    conn.execute(
                        "UPDATE variants SET color_name=?,active=1 WHERE id=?",
                        (cname, row[0]))
                    continue
                sku = "%s-%s-%s" % (
                    slug.upper(), code, label.upper().replace(" ", ""))
                sku_row = conn.execute(
                    "SELECT id FROM variants WHERE sku=?", (sku,)).fetchone()
                if sku_row:
                    # Navy/Maroon keep their established SKU codes while the
                    # storefront shade is refreshed. Updating in place keeps
                    # the counted stock and stock-move history attached.
                    conn.execute(
                        """UPDATE variants
                           SET color_hex=?,color_name=?,active=1 WHERE id=?""",
                        (hexv, cname, sku_row[0]))
                    continue
                conn.execute(
                    """INSERT INTO variants(product_id,color_hex,color_name,
                                            size_label,sku)
                       VALUES(?,?,?,?,?)""",
                    (pid, hexv, cname, label, sku))

    conn.execute("INSERT INTO app_migrations(name) VALUES(?)", (migration,))


def _add_column(conn, table, column, decl):
    """Idempotent ALTER TABLE ADD COLUMN.

    CREATE TABLE IF NOT EXISTS silently does nothing on an existing table, so
    new columns on already-deployed tables need this. Checked against
    PRAGMA table_info rather than catching OperationalError, so a genuine
    error still surfaces.
    """
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
