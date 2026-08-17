# ── Auth blueprint: email+password signup/login, session-based ─
# Signup is still unverified — anyone can register any address. Password
# *reset* is real now (see /forgot and /reset below), which is the half that
# actually locked people out; verifying the address at signup is a separate
# decision and hasn't been made.
import hashlib
import os
import re
import secrets
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

# Reset links are a password-equivalent in an inbox, so they expire fast and
# die on first use.
RESET_TTL_MINUTES = 60
MAX_RESET_REQUESTS = 5           # per email per window, same shape as login
MAX_RESET_REQUESTS_PER_IP = 20


def _token_hash(token):
    """Reset tokens are stored hashed, never in the clear — a leaked database
    must not hand out account takeovers. Plain SHA-256 rather than a password
    KDF is right here: the token is 32 random bytes, so there is no weak
    input to slow an attacker down over."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


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
    try:
        d["phone"] = row["phone"]
    except (IndexError, KeyError):
        d["phone"] = ""
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


def get_or_create_guest(db, email, name):
    """Guest checkout still becomes a real `users` row rather than a
    parallel guest_email/guest_name column on orders — every downstream
    query (admin order list, customer lifetime value in customers.py,
    loyalty, order emails) already assumes orders.user_id resolves to a
    real user, per the "a customer IS a users row" model documented in
    CLAUDE.md. Duplicating that with a second, nullable path through every
    one of them would be far more code than reusing this one. Returns
    (user_id, error). A returning guest (same email) reuses their row, so
    their order history accumulates in one place.

    password_hash is NOT NULL, so this gets an unusable one — a hash of
    32 random bytes nobody will ever type — instead of a special-cased
    NULL that every login() call would need to guard against. The account
    sits dormant until claimed: the same email can run the existing
    forgot-password flow to set a real password and sign into the order
    history that's already there. """
    email = (email or "").strip().lower()
    if not EMAIL_RE.match(email):
        return None, "Enter a valid email so we can send your order confirmation."
    row = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
    if row:
        return row["id"], None
    display_name = (name or "").strip()[:120] or "Guest"
    cur = db.execute(
        "INSERT INTO users(email,password_hash,name,role) VALUES(?,?,?,?)",
        (email, generate_password_hash(secrets.token_hex(32)), display_name, "customer"),
    )
    return cur.lastrowid, None


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


@auth_bp.route("/profile", methods=["POST"])
@login_required
def update_profile():
    """Name and phone only. Email is deliberately not editable here — it's
    the login identity and (once real verification exists) the reset-link
    destination, so changing it needs its own re-verification flow rather
    than a bare text field that could hand the account to a typo or an
    attacker with a stolen session."""
    d = request.get_json(force=True, silent=True) or {}
    name = (d.get("name") or "").strip()[:120]
    if not name:
        return jsonify(ok=False, error="Enter your name."), 400
    phone = (d.get("phone") or "").strip()
    if phone and not re.match(r"^[6-9]\d{9}$", phone):
        return jsonify(ok=False, error="Enter a 10-digit Indian mobile number, or leave it blank."), 400
    db = get_db()
    db.execute("UPDATE users SET name=?, phone=? WHERE id=?",
              (name, phone, session["user_id"]))
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
    return jsonify(ok=True, user=_user_public(row))


@auth_bp.route("/forgot", methods=["POST"])
def forgot_password():
    """Start a reset. Emails a single-use link if the address exists.

    **Always answers the same way**, whether or not the account exists —
    otherwise this endpoint becomes a free account-enumeration oracle, which
    would undo the care taken in login() to give a deactivated account the
    same error as a wrong password.
    """
    d = request.get_json(force=True, silent=True) or {}
    email = (d.get("email") or "").strip().lower()
    generic = jsonify(ok=True, message="If that address has an account, "
                                       "a reset link is on its way.")
    if not EMAIL_RE.match(email):
        return generic

    db = get_db()
    ip = request.remote_addr
    # Same DB-backed sliding window as login() — in-memory counters wouldn't
    # survive gunicorn forking workers. Reuses login_attempts rather than a
    # second table: both are "someone is hammering this account" signals.
    window = "-%d minutes" % LOGIN_WINDOW_MIN
    by_email = db.execute(
        "SELECT COUNT(*) c FROM login_attempts WHERE email=? AND created > datetime('now', ?)",
        (email, window)).fetchone()["c"]
    by_ip = db.execute(
        "SELECT COUNT(*) c FROM login_attempts WHERE ip=? AND created > datetime('now', ?)",
        (ip, window)).fetchone()["c"]
    if by_email >= MAX_RESET_REQUESTS or by_ip >= MAX_RESET_REQUESTS_PER_IP:
        # Still generic — a 429 here would leak that the address is real.
        return generic
    db.execute("INSERT INTO login_attempts(email, ip) VALUES(?,?)", (email, ip))
    db.commit()

    row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row:
        return generic
    try:
        if not row["active"]:
            return generic
    except (IndexError, KeyError):
        pass                      # column predates this migration — treat as active

    token = secrets.token_urlsafe(32)
    # Any older link for this account stops working the moment a new one is
    # asked for, so a forwarded/leaked earlier email goes dead.
    db.execute("UPDATE password_resets SET used=1 WHERE user_id=? AND used=0",
               (row["id"],))
    db.execute(
        """INSERT INTO password_resets(user_id,token_hash,expires)
           VALUES(?,?,datetime('now', ?))""",
        (row["id"], _token_hash(token), "+%d minutes" % RESET_TTL_MINUTES))
    db.commit()

    # After the commit, and it cannot raise — see mailer.send.
    from mailer import send, PUBLIC_BASE_URL
    from mail_templates import password_reset
    send(row["email"], "Reset your Print Engine password",
         password_reset(row["name"], "%s/?reset=%s" % (PUBLIC_BASE_URL, token),
                        RESET_TTL_MINUTES),
         sender="hello", kind="password_reset",
         entity_type="user", entity_id=row["id"])
    return generic


@auth_bp.route("/reset", methods=["POST"])
def reset_password():
    """Finish a reset. Single-use, time-limited."""
    d = request.get_json(force=True, silent=True) or {}
    token = (d.get("token") or "").strip()
    fresh = d.get("password") or ""
    bad = jsonify(ok=False, error="That reset link is invalid or has expired. "
                                  "Ask for a new one."), 400
    if not token:
        return bad
    if len(fresh) < 8:
        return jsonify(ok=False, error="New password must be at least 8 characters."), 400

    db = get_db()
    row = db.execute(
        """SELECT pr.id, pr.user_id, users.email, users.name
           FROM password_resets pr JOIN users ON users.id = pr.user_id
           WHERE pr.token_hash=? AND pr.used=0 AND pr.expires > datetime('now')""",
        (_token_hash(token),)).fetchone()
    if not row:
        return bad

    db.execute("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?",
               (generate_password_hash(fresh), row["user_id"]))
    # Burn the token in the same transaction as the password change, so a
    # concurrent second use can't slip through between the two.
    db.execute("UPDATE password_resets SET used=1 WHERE id=?", (row["id"],))
    db.commit()
    # A reset is a takeover of the account; don't leave the requester signed
    # in as whoever was using this browser before.
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
