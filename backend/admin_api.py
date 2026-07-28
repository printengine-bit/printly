# ── Admin panel API: staff, company profile, audit log, dashboard ──
# Everything the /admin shell needs that isn't a business module of its own.
# Business modules (inventory, orders, dispatch...) get their own blueprints
# as they land; this is the foundation they hang off.
import re

from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash

from db import get_db
from auth import login_required, EMAIL_RE
from permissions import (
    ROLES, ROLE_LABELS, MODULES, STAFF_ROLES, modules_for, require, owner_required,
)

admin_bp = Blueprint("admin_api", __name__, url_prefix="/api/admin")


def log(db, entity_type, entity_id, action, from_val=None, to_val=None, note=""):
    """Append to audit_log. Every state change a staff member causes should
    go through here — it's the only record of who did what."""
    db.execute(
        """INSERT INTO audit_log(entity_type,entity_id,actor_id,action,from_val,to_val,note)
           VALUES(?,?,?,?,?,?,?)""",
        (entity_type, entity_id, session.get("user_id"), action,
         None if from_val is None else str(from_val),
         None if to_val is None else str(to_val), (note or "")[:500]),
    )


# ── Shell bootstrap ──────────────────────────────────────────────
@admin_bp.route("/session")
@login_required
def admin_session():
    """What the panel needs to draw itself: who you are and which sections
    you may open. The sidebar is built from `modules`, so it can never offer
    something the API would refuse."""
    row = get_db().execute(
        "SELECT * FROM users WHERE id=?", (session["user_id"],)
    ).fetchone()
    if not row:
        session.clear()
        return jsonify(ok=False, error="Sign in required"), 401
    role = row["role"]
    return jsonify(
        ok=True,
        user={"id": row["id"], "name": row["name"], "email": row["email"], "role": role,
              "must_change_password": bool(row["must_change_password"])},
        staff=role in STAFF_ROLES,
        modules=modules_for(role),
        role_label=ROLE_LABELS.get(role, role),
    )


# ── Dashboard + live polling ─────────────────────────────────────
def _counters(db):
    live = "cancelled=0"
    row = db.execute(f"""
        SELECT
          (SELECT COUNT(*) FROM orders WHERE {live}
             AND date(created)=date('now')) AS today,
          (SELECT COUNT(*) FROM orders WHERE {live} AND status>0 AND status<5) AS in_production,
          (SELECT COUNT(*) FROM orders WHERE {live} AND status=0) AS awaiting_proof,
          (SELECT COUNT(*) FROM orders WHERE {live} AND status=5) AS delivered,
          (SELECT COUNT(*) FROM orders WHERE cancelled=1) AS cancelled,
          (SELECT COALESCE(SUM(total_inr),0) FROM orders WHERE {live}) AS live_value,
          (SELECT COUNT(*) FROM users WHERE role='customer') AS customers
    """).fetchone()
    return dict(row)


@admin_bp.route("/pulse")
@require("dashboard")
def pulse():
    """Cheap enough to poll. The panel refetches a list only when
    `watermark` moves, so the steady state is one tiny query every ~20s.

    Polling rather than SSE on purpose: an open event stream holds a
    gunicorn worker thread per admin tab, and those threads are what serve
    the blocking image-generation calls.
    """
    db = get_db()
    mark = db.execute("SELECT COALESCE(MAX(updated),'') m FROM orders").fetchone()["m"]
    return jsonify(ok=True, watermark=mark, counters=_counters(db))


@admin_bp.route("/dashboard")
@require("dashboard")
def dashboard():
    db = get_db()
    alerts = []
    stuck = db.execute("""
        SELECT COUNT(*) c FROM orders
        WHERE cancelled=0 AND status<5 AND updated < datetime('now','-3 days')
    """).fetchone()["c"]
    if stuck:
        alerts.append({"level": "warn", "module": "orders",
                       "text": f"{stuck} order(s) haven't moved in 3 days"})
    noaddr = db.execute(
        "SELECT COUNT(*) c FROM orders WHERE cancelled=0 AND ship_line1=''"
    ).fetchone()["c"]
    if noaddr:
        alerts.append({"level": "warn", "module": "orders",
                       "text": f"{noaddr} order(s) have no delivery address"})
    from catalog import low_stock_rows
    low = low_stock_rows(db)
    negative = [r for r in low if r["stock_qty"] < 0]
    if negative:
        alerts.append({"level": "warn", "module": "inventory",
                       "text": "%d variant(s) have gone negative — sold more than "
                               "was counted in" % len(negative)})
    elif low:
        alerts.append({"level": "warn", "module": "inventory",
                       "text": "%d variant(s) are at or below their reorder point" % len(low)})
    company = db.execute("SELECT * FROM company WHERE id=1").fetchone()
    if not company["legal_name"]:
        alerts.append({"level": "info", "module": "settings",
                       "text": "Company profile is empty — delivery notes can't be printed"})
    if (company["gst_percent"] or company["gst_percent_high"]) and not company["gstin"]:
        alerts.append({"level": "warn", "module": "inventory",
                       "text": "Charging %g%% / %g%% GST with no GSTIN on file"
                               % (company["gst_percent"], company["gst_percent_high"])})
    recent = db.execute("""
        SELECT a.*, u.name AS actor_name FROM audit_log a
        LEFT JOIN users u ON u.id=a.actor_id
        ORDER BY a.id DESC LIMIT 8""").fetchall()
    return jsonify(ok=True, counters=_counters(db), alerts=alerts,
                   recent=[_audit_public(r) for r in recent])


# ── Audit log ────────────────────────────────────────────────────
def _audit_public(r):
    return {"id": r["id"], "entity": r["entity_type"], "entity_id": r["entity_id"],
            "action": r["action"], "from": r["from_val"], "to": r["to_val"],
            "note": r["note"], "actor": r["actor_name"], "created": r["created"]}


@admin_bp.route("/audit")
@owner_required
def audit():
    db = get_db()
    entity = request.args.get("entity") or ""
    sql = """SELECT a.*, u.name AS actor_name FROM audit_log a
             LEFT JOIN users u ON u.id=a.actor_id"""
    args = []
    if entity:
        sql += " WHERE a.entity_type=?"
        args.append(entity)
    sql += " ORDER BY a.id DESC LIMIT 200"
    rows = db.execute(sql, args).fetchall()
    return jsonify(ok=True, entries=[_audit_public(r) for r in rows])


# ── Company profile ──────────────────────────────────────────────
COMPANY_FIELDS = ("legal_name", "trade_name", "address", "city", "state",
                  "pincode", "phone", "email", "gstin", "doc_prefix")
GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$")


@admin_bp.route("/company")
@require("settings")
def get_company():
    row = get_db().execute("SELECT * FROM company WHERE id=1").fetchone()
    d = {k: row[k] for k in COMPANY_FIELDS}
    d["challan_next"] = row["challan_next"]
    # Drives the "these are delivery notes, not tax challans" banner.
    d["gst_registered"] = bool(row["gstin"])
    return jsonify(ok=True, company=d)


@admin_bp.route("/company", methods=["POST"])
@owner_required
def set_company():
    d = request.get_json(force=True, silent=True) or {}
    vals = {}
    for k in COMPANY_FIELDS:
        v = d.get(k)
        vals[k] = v.strip()[:160] if isinstance(v, str) else ""
    # Blank is valid — Printly isn't registered yet. A *wrong* one isn't:
    # it would print onto documents that claim to be tax invoices.
    if vals["gstin"] and not GSTIN_RE.match(vals["gstin"].upper()):
        return jsonify(ok=False, error="That doesn't look like a valid 15-character GSTIN."), 400
    vals["gstin"] = vals["gstin"].upper()
    if not vals["doc_prefix"]:
        vals["doc_prefix"] = "PL"

    db = get_db()
    db.execute(
        "UPDATE company SET " + ",".join(f"{k}=?" for k in COMPANY_FIELDS) +
        ", updated=CURRENT_TIMESTAMP WHERE id=1",
        [vals[k] for k in COMPANY_FIELDS],
    )
    log(db, "company", 1, "updated")
    db.commit()
    return get_company()


# ── Staff ────────────────────────────────────────────────────────
def _staff_public(r):
    return {"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"],
            "active": bool(r["active"]),
            "must_change_password": bool(r["must_change_password"]),
            "created": r["created"]}


@admin_bp.route("/staff")
@owner_required
def list_staff():
    rows = get_db().execute(
        "SELECT * FROM users WHERE role<>'customer' ORDER BY id"
    ).fetchall()
    return jsonify(ok=True, staff=[_staff_public(r) for r in rows],
                   roles=[{"key": k, "label": ROLE_LABELS[k],
                           "modules": modules_for(k)} for k in ROLES])


@admin_bp.route("/staff", methods=["POST"])
@owner_required
def create_staff():
    """The owner sets the first password and hands it over — there's no
    email transport to send an invite through. must_change_password forces
    the new account to replace it before it can do anything."""
    d = request.get_json(force=True, silent=True) or {}
    name = (d.get("name") or "").strip()
    email = (d.get("email") or "").strip().lower()
    role = d.get("role")
    password = d.get("password") or ""

    if not name or not EMAIL_RE.match(email):
        return jsonify(ok=False, error="Enter a valid name and email."), 400
    if role not in ROLES:
        return jsonify(ok=False, error="Pick a role."), 400
    if len(password) < 8:
        return jsonify(ok=False, error="Temporary password must be at least 8 characters."), 400

    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        return jsonify(ok=False, error="Someone already has an account with that email."), 400
    cur = db.execute(
        """INSERT INTO users(email,password_hash,name,role,must_change_password)
           VALUES(?,?,?,?,1)""",
        (email, generate_password_hash(password), name, role),
    )
    log(db, "staff", cur.lastrowid, "created", to_val=role, note=email)
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(ok=True, member=_staff_public(row))


@admin_bp.route("/staff/<int:uid>", methods=["POST"])
@owner_required
def update_staff(uid):
    """Role changes and activation. The self-lockout guards matter: an owner
    who demotes or deactivates themselves, or removes the last owner, would
    have no way back into the panel."""
    d = request.get_json(force=True, silent=True) or {}
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row or row["role"] == "customer":
        return jsonify(ok=False, error="Staff member not found."), 404
    me = session["user_id"]

    role = d.get("role")
    if role is not None:
        if role not in ROLES:
            return jsonify(ok=False, error="Pick a role."), 400
        if uid == me and role != "owner":
            return jsonify(ok=False, error="You can't remove your own owner access."), 400
        if row["role"] == "owner" and role != "owner" and _owner_count(db) <= 1:
            return jsonify(ok=False, error="There has to be at least one owner."), 400
        if role != row["role"]:
            db.execute("UPDATE users SET role=? WHERE id=?", (role, uid))
            log(db, "staff", uid, "role_changed", row["role"], role)

    active = d.get("active")
    if active is not None:
        active = 1 if active else 0
        if uid == me and not active:
            return jsonify(ok=False, error="You can't deactivate your own account."), 400
        if not active and row["role"] == "owner" and _owner_count(db) <= 1:
            return jsonify(ok=False, error="There has to be at least one active owner."), 400
        if active != row["active"]:
            db.execute("UPDATE users SET active=? WHERE id=?", (active, uid))
            log(db, "staff", uid, "activated" if active else "deactivated")

    password = d.get("password")
    if password:
        if len(password) < 8:
            return jsonify(ok=False, error="Temporary password must be at least 8 characters."), 400
        db.execute(
            "UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?",
            (generate_password_hash(password), uid),
        )
        log(db, "staff", uid, "password_reset")

    db.commit()
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return jsonify(ok=True, member=_staff_public(row))


def _owner_count(db):
    return db.execute(
        "SELECT COUNT(*) c FROM users WHERE role='owner' AND active=1"
    ).fetchone()["c"]


# ── Module registry ──────────────────────────────────────────────
@admin_bp.route("/modules")
@login_required
def module_list():
    """Every section the panel knows about, so the shell can render the full
    structure and mark what isn't built yet rather than hiding it."""
    return jsonify(ok=True, modules=MODULES)
