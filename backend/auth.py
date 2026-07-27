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
from permissions import is_staff

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
    """Any staff member. Kept for routes that predate the module matrix;
    new endpoints should use `require("<module>")` from permissions.py so
    access is scoped to what the role actually does."""
    @wraps(fn)
    def wrapped(*a, **kw):
        if not session.get("user_id"):
            return jsonify(ok=False, error="Sign in required"), 401
        if not is_staff(session.get("role")):
            return jsonify(ok=False, error="Admin access required"), 403
        return fn(*a, **kw)
    return wrapped


def _user_public(row):
    d = {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}
    # Columns from later migrations — a row read against an older schema
    # shouldn't be able to break sign-in.
    for col, default in (("must_change_password", 0), ("active", 1)):
        try:
            d[col] = bool(row[col])
        except (IndexError, KeyError):
            d[col] = bool(default)
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

    # ADMIN_EMAIL is a bootstrap, not an ongoing rule: it exists so the very
    # first owner can exist at all. Once one owner is in the table, every
    # further staff account is created inside the panel — otherwise anyone
    # who learns the address could claim the role by signing up.
    role = "customer"
    if ADMIN_EMAIL and email == ADMIN_EMAIL.strip().lower():
        has_owner = db.execute("SELECT 1 FROM users WHERE role='owner' LIMIT 1").fetchone()
        if not has_owner:
            role = "owner"
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
    # Deactivated staff: same generic message as a bad password, so the form
    # doesn't confirm which accounts exist.
    try:
        if not row["active"]:
            return jsonify(ok=False, error="Invalid email or password."), 401
    except (IndexError, KeyError):
        pass

    session.clear()
    session["user_id"] = row["id"]
    session["role"] = row["role"]
    session.permanent = True
    return jsonify(ok=True, user=_user_public(row))


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify(ok=True)


@auth_bp.route("/change-password", methods=["POST"])
@login_required
def change_password():
    """Also the exit route from a handed-over staff password: the panel
    blocks on this until must_change_password clears."""
    d = request.get_json(force=True, silent=True) or {}
    current = d.get("current") or ""
    fresh = d.get("password") or ""
    if len(fresh) < 8:
        return jsonify(ok=False, error="New password must be at least 8 characters."), 400
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
    if not row or not check_password_hash(row["password_hash"], current):
        return jsonify(ok=False, error="Current password is wrong."), 401
    if check_password_hash(row["password_hash"], fresh):
        return jsonify(ok=False, error="Pick a password you haven't used here."), 400
    db.execute(
        "UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?",
        (generate_password_hash(fresh), row["id"]),
    )
    db.commit()
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
