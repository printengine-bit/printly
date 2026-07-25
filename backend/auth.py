# ── Auth blueprint: email+password signup/login, session-based ─
# No email verification/magic-link sending here — that needs an SMTP/email
# provider, which is a new account/service outside this phase's ₹0 scope.
# Plain password auth is the pragmatic MVP; add verified email later if
# abuse becomes a real problem.
import os, re
from functools import wraps
from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash

from db import get_db

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_LOGIN_ATTEMPTS = 5           # per email — catches brute-forcing one account
MAX_LOGIN_ATTEMPTS_PER_IP = 20   # per IP, higher — catches one IP trying many
                                  # emails (enumeration/credential-stuffing)
                                  # without punishing a shared office/NAT IP
LOGIN_WINDOW_MIN = 15


def login_required(fn):
    @wraps(fn)
    def wrapped(*a, **kw):
        if not session.get("user_id"):
            return jsonify(ok=False, error="Sign in required"), 401
        return fn(*a, **kw)
    return wrapped


def admin_required(fn):
    @wraps(fn)
    def wrapped(*a, **kw):
        if not session.get("user_id"):
            return jsonify(ok=False, error="Sign in required"), 401
        if session.get("role") != "admin":
            return jsonify(ok=False, error="Admin access required"), 403
        return fn(*a, **kw)
    return wrapped


def _user_public(row):
    d = {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}
    # Added by a later migration, so it may be absent on a row read from an
    # older connection/schema — don't let that break sign-in.
    try:
        d["loyalty_points"] = row["loyalty_points"]
    except (IndexError, KeyError):
        d["loyalty_points"] = 0
    return d


@auth_bp.route("/signup", methods=["POST"])
def signup():
    d = request.get_json(force=True, silent=True) or {}
    name = (d.get("name") or "").strip()
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""

    if not name or not EMAIL_RE.match(email):
        return jsonify(ok=False, error="Enter a valid name and email."), 400
    if len(password) < 8:
        return jsonify(ok=False, error="Password must be at least 8 characters."), 400

    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        return jsonify(ok=False, error="An account with this email already exists."), 400

    role = "admin" if ADMIN_EMAIL and email == ADMIN_EMAIL.strip().lower() else "customer"
    cur = db.execute(
        "INSERT INTO users(email,password_hash,name,role) VALUES(?,?,?,?)",
        (email, generate_password_hash(password), name, role),
    )
    db.commit()

    session.clear()
    session["user_id"] = cur.lastrowid
    session["role"] = role
    session.permanent = True
    row = db.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(ok=True, user=_user_public(row))


@auth_bp.route("/login", methods=["POST"])
def login():
    d = request.get_json(force=True, silent=True) or {}
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""
    db = get_db()

    ip = request.remote_addr
    recent_email = db.execute(
        "SELECT COUNT(*) c FROM login_attempts WHERE email=? AND created > datetime('now', ?)",
        (email, f"-{LOGIN_WINDOW_MIN} minutes"),
    ).fetchone()["c"]
    recent_ip = db.execute(
        "SELECT COUNT(*) c FROM login_attempts WHERE ip=? AND created > datetime('now', ?)",
        (ip, f"-{LOGIN_WINDOW_MIN} minutes"),
    ).fetchone()["c"]
    if recent_email >= MAX_LOGIN_ATTEMPTS or recent_ip >= MAX_LOGIN_ATTEMPTS_PER_IP:
        return jsonify(ok=False, error="Too many attempts. Try again in a few minutes."), 429

    row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        db.execute("INSERT INTO login_attempts(email, ip) VALUES(?,?)", (email, request.remote_addr))
        db.commit()
        return jsonify(ok=False, error="Invalid email or password."), 401

    session.clear()
    session["user_id"] = row["id"]
    session["role"] = row["role"]
    session.permanent = True
    return jsonify(ok=True, user=_user_public(row))


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify(ok=True)


@auth_bp.route("/me")
def me():
    if not session.get("user_id"):
        return jsonify(ok=True, user=None)
    row = get_db().execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
    if not row:
        session.clear()
        return jsonify(ok=True, user=None)
    return jsonify(ok=True, user=_user_public(row))
