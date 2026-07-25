# ── Orders blueprint: place orders, list mine, admin pipeline ──
import json
from flask import Blueprint, request, jsonify, session

from db import get_db
from auth import login_required, admin_required

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


def _order_public(row):
    return {
        "id": _display_id(row["id"]),
        "total": row["total_inr"],
        "status": row["status"],
        "items": json.loads(row["items_json"]),
        "created": row["created"],
        "updated": row["updated"],
    }


def _row_id_from_display(order_id):
    """'PL-1001' -> 1, or None if malformed."""
    if not order_id.startswith("PL-"):
        return None
    try:
        return int(order_id[3:]) - 1000
    except ValueError:
        return None


@orders_bp.route("/orders", methods=["POST"])
@login_required
def create_order():
    d = request.get_json(force=True, silent=True) or {}
    items = d.get("items")
    total = d.get("total")
    if not items or not isinstance(total, (int, float)) or total <= 0:
        return jsonify(ok=False, error="Cart is empty or invalid."), 400

    # NOTE: total is client-computed for now — there's no real payment yet.
    # The moment Razorpay is wired in, this MUST be recomputed server-side
    # from a price table instead of trusted from the request body.
    db = get_db()
    cur = db.execute(
        "INSERT INTO orders(user_id,total_inr,items_json) VALUES(?,?,?)",
        (session["user_id"], total, json.dumps(items)),
    )
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
@admin_required
def admin_orders():
    rows = get_db().execute(
        """SELECT orders.*, users.name AS customer_name, users.email AS customer_email
           FROM orders JOIN users ON users.id = orders.user_id
           ORDER BY orders.created DESC"""
    ).fetchall()
    out = []
    for r in rows:
        o = _order_public(r)
        o["customer"] = r["customer_name"]
        o["customer_email"] = r["customer_email"]
        out.append(o)
    return jsonify(ok=True, orders=out)


@orders_bp.route("/admin/orders/<order_id>/advance", methods=["POST"])
@admin_required
def advance_order(order_id):
    row_id = _row_id_from_display(order_id)
    if row_id is None:
        return jsonify(ok=False, error="Order not found."), 404
    db = get_db()
    row = db.execute("SELECT * FROM orders WHERE id=?", (row_id,)).fetchone()
    if not row:
        return jsonify(ok=False, error="Order not found."), 404
    if row["status"] >= MAX_STATUS:
        return jsonify(ok=False, error="Order is already at the final stage."), 400
    db.execute(
        "UPDATE orders SET status=status+1, updated=CURRENT_TIMESTAMP WHERE id=?", (row_id,)
    )
    db.commit()
    row = db.execute("SELECT * FROM orders WHERE id=?", (row_id,)).fetchone()
    return jsonify(ok=True, order=_order_public(row))
