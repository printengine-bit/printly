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
    # Single-row business identity. Delivery notes and shipping labels are
    # unprintable without it, and the GSTIN stays blank until Printly is
    # actually registered — see the note on doc_prefix below.
    c.execute("""CREATE TABLE IF NOT EXISTS company(
        id INTEGER PRIMARY KEY CHECK (id = 1),
        legal_name TEXT NOT NULL DEFAULT '',
        trade_name TEXT NOT NULL DEFAULT 'Printly',
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
    c.execute("""CREATE TABLE IF NOT EXISTS ai_inflight(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    _add_column(c, "users", "loyalty_points", "INTEGER NOT NULL DEFAULT 0")
    # Delivery address. Added after the fact, so existing rows get "" — the
    # admin UI labels those "no address recorded" rather than showing blanks.
    for col in ("ship_name", "ship_phone", "ship_line1", "ship_line2",
                "ship_city", "ship_state", "ship_pincode"):
        _add_column(c, "orders", col, "TEXT NOT NULL DEFAULT ''")
    # Cancellation is orthogonal to the 6 pipeline stages, not a 7th one:
    # keeping `status` intact means a restored order resumes where it was.
    _add_column(c, "orders", "cancelled", "INTEGER NOT NULL DEFAULT 0")
    # Staff accounts are created by the owner, who sets the first password
    # and hands it over — there's no email transport to send an invite with.
    _add_column(c, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0")
    _add_column(c, "users", "active", "INTEGER NOT NULL DEFAULT 1")

    # 'admin' predates the role matrix in permissions.py, where the
    # full-access role is 'owner'. Rename in place so the existing account
    # keeps working instead of silently losing access.
    c.execute("UPDATE users SET role='owner' WHERE role='admin'")

    _backfill_audit(c)
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
