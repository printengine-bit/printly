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
    c.execute("""CREATE TABLE IF NOT EXISTS login_attempts(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT, ip TEXT,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS ai_inflight(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.commit()
    c.close()
