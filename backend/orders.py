# ── Orders blueprint: place orders, list mine, admin pipeline ──
import json
import re
from flask import Blueprint, request, jsonify, session

from db import get_db
from auth import login_required
from permissions import require
from catalog import quote, apply_stock

orders_bp = Blueprint("orders", __name__, url_prefix="/api")

# Matches frontend STAGES.length-1 (index.html: 'Proof sent'..'Delivered',
# 6 stages, indices 0-5). Enforced here too since this route is the real
# authority — a client-side cap alone isn't security.
MAX_STATUS = 5


def _display_id(row_id):
    # Purely a display code derived from the real integer PK — never stored,
    # so there's no placeholder-value collision risk between concurrent
    # inserts (matches the frontend's old 'PL-'+seq convention, starting at 1001).
    return "PL-" + str(1000 + row_id)


def _shipping(row):
    keys = ("name", "phone", "line1", "line2", "city", "state", "pincode")
    d = {k: (row["ship_" + k] or "") for k in keys}
    # Orders placed before addresses were collected have every field blank —
    # say so explicitly rather than rendering an empty card.
    d["recorded"] = bool(d["line1"])
    return d


def _order_public(row, items=True):
    """`items=False` omits the cart payload — see admin_orders for why."""
    o = {
        "id": _display_id(row["id"]),
        "total": row["total_inr"],
        "status": row["status"],
        "cancelled": bool(row["cancelled"]),
        "created": row["created"],
        "updated": row["updated"],
        "shipping": _shipping(row),
    }
    if items:
        o["items"] = json.loads(row["items_json"])
    return o


def _summarise(items):
    """The few per-line fields the admin table needs, without the thumbnails
    or layer data — those are what made the list response megabytes wide."""
    out = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        out.append({
            "product": it.get("product"),
            "qty": it.get("qty"),
            "sizes": it.get("sizes"),
        })
    return out


# Deliberately loose: Indian addresses don't fit a strict grammar, and the
# only fields worth machine-checking are the two that have a fixed shape.
PHONE_RE = re.compile(r"^[6-9]\d{9}$")
PINCODE_RE = re.compile(r"^[1-9]\d{5}$")
MAX_FIELD = 120


def _clean_shipping(d):
    """Returns (values_dict, error). Every field except line2 is required."""
    if not isinstance(d, dict):
        return None, "Add a delivery address before placing the order."
    v = {}
    for k in ("name", "phone", "line1", "line2", "city", "state", "pincode"):
        raw = d.get(k)
        v[k] = raw.strip()[:MAX_FIELD] if isinstance(raw, str) else ""
    if not v["name"]:
        return None, "Add the name the parcel should go to."
    if not PHONE_RE.match(v["phone"]):
        return None, "Enter a 10-digit Indian mobile number."
    if not v["line1"]:
        return None, "Add the street address."
    if not v["city"] or not v["state"]:
        return None, "Add the city and state."
    if not PINCODE_RE.match(v["pincode"]):
        return None, "Enter a valid 6-digit PIN code."
    return v, None


def _log_event(db, order_id, kind, from_status=None, to_status=None, note=""):
    """Order history lives in the shared audit_log — see admin_api.log().
    order_events is legacy: still written by nothing, kept only until the
    backfill is confirmed good in production."""
    from admin_api import log
    log(db, "order", order_id, kind, from_status, to_status, note)


def _row_id_from_display(order_id):
    """'PL-1001' -> 1, or None if malformed."""
    if not order_id.startswith("PL-"):
        return None
    try:
        return int(order_id[3:]) - 1000
    except ValueError:
        return None


def _validate_sizes(items):
    """Check each cart line's size breakdown is sane and matches its qty.

    Returns an error string, or None if everything is fine. Lines without a
    `sizes` key are allowed through — orders placed before sizing existed
    don't have one, and rejecting them would break re-ordering.
    """
    if not isinstance(items, list):
        return "Cart is empty or invalid."
    for it in items:
        if not isinstance(it, dict):
            return "Cart is empty or invalid."
        sizes = it.get("sizes")
        if sizes is None:
            continue
        if not isinstance(sizes, dict) or not sizes:
            return "That order's size breakdown is invalid."
        subtotal = 0
        for label, n in sizes.items():
            if not isinstance(label, str) or not label.strip() or len(label) > 12:
                return "That order's size breakdown is invalid."
            if isinstance(n, bool) or not isinstance(n, int) or n < 0 or n > 9999:
                return "That order's size breakdown is invalid."
            subtotal += n
        if subtotal < 1:
            return "Pick at least one size before ordering."
        qty = it.get("qty")
        if isinstance(qty, int) and qty != subtotal:
            return "Sizes don't add up to the quantity ordered."
    return None


@orders_bp.route("/orders", methods=["POST"])
@login_required
def create_order():
    d = request.get_json(force=True, silent=True) or {}
    items = d.get("items")
    total = d.get("total")
    if not items or not isinstance(total, (int, float)) or total <= 0:
        return jsonify(ok=False, error="Cart is empty or invalid."), 400

    # The size breakdown is what the print floor actually works from, so
    # reject anything malformed here rather than letting a bad order reach
    # production. Money is checked separately, below.
    err = _validate_sizes(items)
    if err:
        return jsonify(ok=False, error=err), 400

    ship, err = _clean_shipping(d.get("shipping"))
    if err:
        return jsonify(ok=False, error=err), 400

    db = get_db()
    # The server prices the order. `total` from the request is only ever
    # compared against this, never stored — prices, GST and shipping are all
    # admin-editable now, so a stale tab or a crafted request would
    # otherwise set its own price. A mismatch means the customer was shown
    # something different from what we'd charge, so refuse rather than
    # quietly billing a number they never saw.
    q, err = quote(db, items)
    if err:
        return jsonify(ok=False, error=err), 400
    if abs(q["total"] - float(total)) > 1.0:
        return jsonify(
            ok=False,
            error="Prices have changed since you opened the cart. Refresh and try again.",
            total=q["total"],
        ), 409
    total = q["total"]

    cur = db.execute(
        """INSERT INTO orders(user_id,total_inr,items_json,ship_name,ship_phone,
                              ship_line1,ship_line2,ship_city,ship_state,ship_pincode)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (session["user_id"], total, json.dumps(items), ship["name"], ship["phone"],
         ship["line1"], ship["line2"], ship["city"], ship["state"], ship["pincode"]),
    )
    _log_event(db, cur.lastrowid, "placed", None, 0)
    # Blanks leave the shelf when the order is placed, not when it ships —
    # they're committed to this order either way. Never blocks the sale; see
    # apply_stock() for why.
    missing = apply_stock(db, items, cur.lastrowid, -1, "order")
    if missing:
        _log_event(db, cur.lastrowid, "note",
                   note="No stock record for: " + ", ".join(missing[:6]))
    # Loyalty points. ⚠️ PLACEHOLDER RULE — 1 point per ₹100 spent, with no
    # redemption path yet. The real earn/burn policy is a business decision
    # that hasn't been made; this exists so the dashboard has something
    # truthful to show. Decide the policy before advertising it to customers.
    points = int(total // 100)
    if points:
        db.execute("UPDATE users SET loyalty_points = loyalty_points + ? WHERE id=?",
                   (points, session["user_id"]))
    db.commit()

    row = db.execute("SELECT * FROM orders WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(ok=True, order=_order_public(row), points_earned=points)


@orders_bp.route("/orders/mine")
@login_required
def my_orders():
    rows = get_db().execute(
        "SELECT * FROM orders WHERE user_id=? ORDER BY created DESC", (session["user_id"],)
    ).fetchall()
    return jsonify(ok=True, orders=[_order_public(r) for r in rows])


@orders_bp.route("/admin/orders")
@require("orders")
def admin_orders():
    """List view. Returns a per-line *summary* rather than the cart payload:
    each line carries a base64 mockup thumbnail (~58KB), so sending the full
    items_json made this response grow without bound as orders accumulate.
    The detail endpoint below serves the heavy data, one order at a time."""
    rows = get_db().execute(
        """SELECT orders.*, users.name AS customer_name, users.email AS customer_email
           FROM orders JOIN users ON users.id = orders.user_id
           ORDER BY orders.created DESC"""
    ).fetchall()
    out = []
    for r in rows:
        o = _order_public(r, items=False)
        o["customer"] = r["customer_name"]
        o["customer_email"] = r["customer_email"]
        o["lines"] = _summarise(json.loads(r["items_json"]))
        out.append(o)
    return jsonify(ok=True, orders=out)


def _load_order(order_id):
    """(row, db) for a display id, or (None, db) if it doesn't resolve."""
    db = get_db()
    row_id = _row_id_from_display(order_id)
    if row_id is None:
        return None, db
    return db.execute(
        """SELECT orders.*, users.name AS customer_name, users.email AS customer_email
           FROM orders JOIN users ON users.id = orders.user_id
           WHERE orders.id=?""", (row_id,)
    ).fetchone(), db


@orders_bp.route("/admin/orders/<order_id>")
@require("orders")
def admin_order_detail(order_id):
    row, db = _load_order(order_id)
    if not row:
        return jsonify(ok=False, error="Order not found."), 404
    o = _order_public(row)
    o["customer"] = row["customer_name"]
    o["customer_email"] = row["customer_email"]
    events = db.execute(
        """SELECT a.*, u.name AS actor_name FROM audit_log a
           LEFT JOIN users u ON u.id = a.actor_id
           WHERE a.entity_type='order' AND a.entity_id=? ORDER BY a.id""", (row["id"],)
    ).fetchall()
    o["events"] = [{
        "kind": e["action"], "from": e["from_val"], "to": e["to_val"],
        "note": e["note"], "actor": e["actor_name"], "created": e["created"],
    } for e in events]
    return jsonify(ok=True, order=o)


@orders_bp.route("/admin/orders/<order_id>/status", methods=["POST"])
@require("orders")
def set_order_status(order_id):
    """Set the stage directly, in either direction. Forward-only meant a
    mis-click couldn't be undone; the audit trail is what keeps that honest."""
    row, db = _load_order(order_id)
    if not row:
        return jsonify(ok=False, error="Order not found."), 404
    to = (request.get_json(force=True, silent=True) or {}).get("to")
    if isinstance(to, bool) or not isinstance(to, int) or not 0 <= to <= MAX_STATUS:
        return jsonify(ok=False, error="That isn't a valid stage."), 400
    if row["cancelled"]:
        return jsonify(ok=False, error="Restore the order before changing its stage."), 400
    if to != row["status"]:
        db.execute("UPDATE orders SET status=?, updated=CURRENT_TIMESTAMP WHERE id=?",
                   (to, row["id"]))
        _log_event(db, row["id"], "stage", row["status"], to)
        db.commit()
    return jsonify(ok=True, order=_order_public(
        db.execute("SELECT * FROM orders WHERE id=?", (row["id"],)).fetchone()))


@orders_bp.route("/admin/orders/<order_id>/cancel", methods=["POST"])
@require("orders")
def cancel_order(order_id):
    """Cancel or restore. The stage is left untouched so a restored order
    picks up exactly where it was rather than resetting to Proof sent."""
    row, db = _load_order(order_id)
    if not row:
        return jsonify(ok=False, error="Order not found."), 404
    d = request.get_json(force=True, silent=True) or {}
    cancelled = 0 if d.get("restore") else 1
    note = d.get("reason") if isinstance(d.get("reason"), str) else ""
    if cancelled != row["cancelled"]:
        db.execute("UPDATE orders SET cancelled=?, updated=CURRENT_TIMESTAMP WHERE id=?",
                   (cancelled, row["id"]))
        _log_event(db, row["id"], "cancelled" if cancelled else "restored", note=note)
        # Blanks go back on the shelf when an order is cancelled, and come
        # off again if it's restored — otherwise stock drifts down by one
        # order every time somebody changes their mind.
        items = json.loads(row["items_json"])
        apply_stock(db, items, row["id"], 1 if cancelled else -1,
                    "cancel" if cancelled else "order")
        db.commit()
    return jsonify(ok=True, order=_order_public(
        db.execute("SELECT * FROM orders WHERE id=?", (row["id"],)).fetchone()))


@orders_bp.route("/admin/orders/<order_id>/note", methods=["POST"])
@require("orders")
def add_order_note(order_id):
    row, db = _load_order(order_id)
    if not row:
        return jsonify(ok=False, error="Order not found."), 404
    note = (request.get_json(force=True, silent=True) or {}).get("note")
    if not isinstance(note, str) or not note.strip():
        return jsonify(ok=False, error="Write something first."), 400
    _log_event(db, row["id"], "note", note=note.strip())
    db.commit()
    return jsonify(ok=True)
