# ── Customers blueprint: who they are, what they've bought, their points ──
#
# There is no customers *table* — a customer is a `users` row with the
# default role, and everything interesting about them is derived from their
# orders. Denormalising lifetime value into a column would be one more thing
# to keep in step with cancellations; the aggregate is cheap at this size.
import json

from flask import Blueprint, request, jsonify, session

from db import get_db
from permissions import require

customers_bp = Blueprint("customers", __name__, url_prefix="/api/admin/customers")

# Cancelled orders still happened, but they aren't revenue. Every money
# figure below excludes them; counts report both so the difference is visible.
SPEND = "SUM(CASE WHEN o.cancelled=0 THEN o.total_inr ELSE 0 END)"


def award_points(db, user_id, delta, reason, order_id=None, actor_id=None):
    """The only way loyalty points move.

    Writes the ledger row and the running total together, so the two can't
    drift. `users.loyalty_points` stays the authoritative balance because
    every read wants it and summing the ledger on each page load would not
    scale — but it is now reconstructable, which it wasn't.
    """
    delta = int(delta)
    if not delta:
        return
    db.execute("""INSERT INTO loyalty_moves(user_id,delta,reason,order_id,actor_id)
                  VALUES(?,?,?,?,?)""",
               (user_id, delta, (reason or "")[:200], order_id, actor_id))
    db.execute("UPDATE users SET loyalty_points = loyalty_points + ? WHERE id=?",
               (delta, user_id))


@customers_bp.route("")
@require("customers")
def list_customers():
    db = get_db()
    q = (request.args.get("q") or "").strip()
    sql = """
        SELECT u.id, u.name, u.email, u.created, u.loyalty_points, u.role,
               COUNT(o.id) AS orders,
               SUM(CASE WHEN o.cancelled=1 THEN 1 ELSE 0 END) AS cancelled,
               %s AS spend,
               MAX(o.created) AS last_order,
               MAX(o.ship_city) AS city
        FROM users u LEFT JOIN orders o ON o.user_id = u.id
        WHERE u.role='customer'""" % SPEND
    args = []
    if q:
        sql += " AND (u.name LIKE ? OR u.email LIKE ?)"
        like = "%" + q + "%"
        args += [like, like]
    sql += " GROUP BY u.id ORDER BY spend DESC, u.id DESC LIMIT 300"
    rows = db.execute(sql, args).fetchall()
    return jsonify(ok=True, customers=[{
        "id": r["id"], "name": r["name"], "email": r["email"],
        "joined": r["created"], "points": r["loyalty_points"],
        "orders": r["orders"] or 0, "cancelled": r["cancelled"] or 0,
        "spend": r["spend"] or 0, "last_order": r["last_order"], "city": r["city"],
    } for r in rows])


@customers_bp.route("/<int:uid>")
@require("customers")
def customer_detail(uid):
    from orders import _display_id, _shipping, _summarise
    db = get_db()
    u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not u:
        return jsonify(ok=False, error="No such customer."), 404

    orders = db.execute(
        "SELECT * FROM orders WHERE user_id=? ORDER BY created DESC", (uid,)).fetchall()
    out_orders = []
    for o in orders:
        try:
            items = json.loads(o["items_json"])
        except (ValueError, TypeError):
            items = []
        out_orders.append({
            "id": _display_id(o["id"]), "total": o["total_inr"],
            "status": o["status"], "cancelled": bool(o["cancelled"]),
            "created": o["created"], "invoice_no": o["invoice_no"],
            "lines": _summarise(items),
        })

    # Addresses they've actually used, most recent first — the practical
    # answer to "where does this customer live", without a separate book.
    seen, addresses = set(), []
    for o in orders:
        a = _shipping(o)
        if not a["recorded"]:
            continue
        key = (a["line1"], a["pincode"])
        if key in seen:
            continue
        seen.add(key)
        addresses.append(a)

    moves = db.execute(
        """SELECT m.*, s.name AS actor_name FROM loyalty_moves m
           LEFT JOIN users s ON s.id=m.actor_id
           WHERE m.user_id=? ORDER BY m.id DESC LIMIT 50""", (uid,)).fetchall()

    tickets = db.execute(
        """SELECT id,subject,status,created FROM tickets
           WHERE user_id=? ORDER BY id DESC LIMIT 20""", (uid,)).fetchall()

    designs = db.execute(
        "SELECT COUNT(*) c FROM saved_designs WHERE user_id=?", (uid,)).fetchone()["c"]

    live = [o for o in orders if not o["cancelled"]]
    spend = sum(o["total_inr"] for o in live)
    return jsonify(ok=True, customer={
        "id": u["id"], "name": u["name"], "email": u["email"],
        "joined": u["created"], "points": u["loyalty_points"], "role": u["role"],
        "orders": out_orders, "addresses": addresses, "designs": designs,
        "spend": spend, "avg": round(spend / len(live), 2) if live else 0,
        "loyalty": [{"delta": m["delta"], "reason": m["reason"],
                     "order_id": _display_id(m["order_id"]) if m["order_id"] else None,
                     "actor": m["actor_name"], "created": m["created"]} for m in moves],
        "tickets": [{"id": t["id"], "subject": t["subject"], "status": t["status"],
                     "created": t["created"]} for t in tickets],
    })


@customers_bp.route("/<int:uid>/loyalty", methods=["POST"])
@require("customers")
def adjust_loyalty(uid):
    from admin_api import log
    d = request.get_json(force=True, silent=True) or {}
    try:
        delta = int(d.get("delta"))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="How many points?"), 400
    if not delta or abs(delta) > 100000:
        return jsonify(ok=False, error="That's not a usable number of points."), 400
    reason = (d.get("reason") or "").strip()
    # An adjustment with no reason is indistinguishable from a mistake six
    # months later, which is the whole point of keeping a ledger.
    if len(reason) < 3:
        return jsonify(ok=False, error="Say why — the ledger is only useful with reasons."), 400

    db = get_db()
    u = db.execute("SELECT id,loyalty_points FROM users WHERE id=?", (uid,)).fetchone()
    if not u:
        return jsonify(ok=False, error="No such customer."), 404
    if u["loyalty_points"] + delta < 0:
        return jsonify(ok=False,
                       error="That would take the balance below zero (currently %d)."
                             % u["loyalty_points"]), 400

    award_points(db, uid, delta, reason, actor_id=session.get("user_id"))
    log(db, "customer", uid, "loyalty_adjusted", None, delta, reason)
    db.commit()
    balance = db.execute("SELECT loyalty_points FROM users WHERE id=?", (uid,)).fetchone()
    return jsonify(ok=True, points=balance["loyalty_points"])
