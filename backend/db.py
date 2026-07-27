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
    c.commit()
    c.close()


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
