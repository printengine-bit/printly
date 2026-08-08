# ── Promo codes ──────────────────────────────────────────────────
# A coupon knocks a flat amount or a percentage off the cart subtotal.
# Validated and priced entirely here — never trusted from the browser,
# same rule as every other figure in catalog.py. quote() is what actually
# applies a code to an order; this module is the code's own lifecycle
# (admin CRUD, redemption bookkeeping) plus the cart-preview endpoint.
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, session

from db import get_db
from permissions import require

promo_bp = Blueprint("promo", __name__, url_prefix="/api")


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def find_promo(db, code):
    code = (code or "").strip().upper()
    if not code:
        return None
    return db.execute("SELECT * FROM promo_codes WHERE code=?", (code,)).fetchone()


def apply_promo(db, promo, subtotal, user_id):
    """Returns (discount_amount, error) for a promo row that already exists
    (see find_promo). Never mutates anything — redeem_promo() does that,
    once an order is actually being placed."""
    if not promo["active"]:
        return 0.0, "That code isn't active anymore."
    if promo["expires"] and promo["expires"] < _now_iso():
        return 0.0, "That code has expired."
    if subtotal < promo["min_subtotal"]:
        return 0.0, "Add ₹%s more to use this code." % int(promo["min_subtotal"] - subtotal)
    if promo["max_uses"] is not None:
        used = db.execute("SELECT COUNT(*) c FROM promo_redemptions WHERE promo_id=?",
                          (promo["id"],)).fetchone()["c"]
        if used >= promo["max_uses"]:
            return 0.0, "That code has been fully redeemed."
    if user_id:
        # Guests previewing a code in the cart have no identity to check yet
        # — checkout itself is login-gated, so the real check always runs
        # with a real user_id by the time an order is actually placed.
        used_by_user = db.execute(
            "SELECT COUNT(*) c FROM promo_redemptions WHERE promo_id=? AND user_id=?",
            (promo["id"], user_id)).fetchone()["c"]
        if used_by_user >= promo["per_user_limit"]:
            return 0.0, "You've already used this code."

    discount = (subtotal * promo["value"] / 100.0) if promo["kind"] == "percent" else promo["value"]
    if promo["max_discount"] is not None:
        discount = min(discount, promo["max_discount"])
    return round(min(discount, subtotal), 2), None


def redeem_promo(db, promo_code, user_id, order_id, discount_amount):
    """Records the redemption. Called once, inside the same request that
    places the order — see orders.py — never from the preview endpoint."""
    promo = find_promo(db, promo_code)
    if not promo:
        return
    db.execute(
        """INSERT INTO promo_redemptions(promo_id,user_id,order_id,discount_amount)
           VALUES(?,?,?,?)""",
        (promo["id"], user_id, order_id, discount_amount))


# ── Cart preview ─────────────────────────────────────────────────
@promo_bp.route("/promo/check", methods=["POST"])
def check_promo():
    """Recomputes the whole cart itself rather than trusting a subtotal from
    the browser — otherwise a crafted request could low-ball the subtotal to
    dodge min_subtotal or inflate a percentage discount."""
    from catalog import quote
    d = request.get_json(force=True, silent=True) or {}
    q, err = quote(get_db(), d.get("items"), promo_code=d.get("code"),
                   user_id=session.get("user_id"))
    if err:
        return jsonify(ok=False, error=err), 400
    return jsonify(ok=True, code=q["promo_code"], discount=q["discount"], total=q["total"])


# ── Admin ────────────────────────────────────────────────────────
def _public(r):
    return {"id": r["id"], "code": r["code"], "kind": r["kind"], "value": r["value"],
            "min_subtotal": r["min_subtotal"], "max_discount": r["max_discount"],
            "max_uses": r["max_uses"], "per_user_limit": r["per_user_limit"],
            "active": bool(r["active"]), "expires": r["expires"], "created": r["created"],
            "featured": bool(r["featured"])}


def featured_promos(db):
    """Codes an admin explicitly opted into showing on the storefront —
    active, not expired, and flagged. Never every active code: a code
    emailed to one customer or handed to a corporate buyer is still
    'active' but was never meant to be public. See promo_codes.featured."""
    rows = db.execute(
        """SELECT code,kind,value,min_subtotal FROM promo_codes
           WHERE featured=1 AND active=1
             AND (expires IS NULL OR expires > ?)""", (_now_iso(),)).fetchall()
    return [{"code": r["code"], "kind": r["kind"], "value": r["value"],
             "min_subtotal": r["min_subtotal"]} for r in rows]


@promo_bp.route("/admin/promo")
@require("inventory")
def list_promo():
    db = get_db()
    rows = db.execute("SELECT * FROM promo_codes ORDER BY created DESC").fetchall()
    out = []
    for r in rows:
        p = _public(r)
        p["redeemed"] = db.execute(
            "SELECT COUNT(*) c FROM promo_redemptions WHERE promo_id=?", (r["id"],)
        ).fetchone()["c"]
        out.append(p)
    return jsonify(ok=True, promos=out)


@promo_bp.route("/admin/promo", methods=["POST"])
@require("inventory")
def create_promo():
    d = request.get_json(force=True, silent=True) or {}
    code = (d.get("code") or "").strip().upper()[:32]
    kind = d.get("kind") if d.get("kind") in ("percent", "flat") else "percent"
    if not code:
        return jsonify(ok=False, error="Give the code a name."), 400
    if not isinstance(d.get("value"), (int, float)) or d["value"] <= 0:
        return jsonify(ok=False, error="Enter a discount value greater than 0."), 400
    if kind == "percent" and d["value"] > 100:
        return jsonify(ok=False, error="A percentage discount can't exceed 100."), 400

    db = get_db()
    if db.execute("SELECT id FROM promo_codes WHERE code=?", (code,)).fetchone():
        return jsonify(ok=False, error="That code already exists."), 400

    def num_or_none(key):
        v = d.get(key)
        return float(v) if isinstance(v, (int, float)) and v > 0 else None

    def int_or_none(key):
        v = d.get(key)
        return int(v) if isinstance(v, (int, float)) and v > 0 else None

    cur = db.execute(
        """INSERT INTO promo_codes(code,kind,value,min_subtotal,max_discount,
                                   max_uses,per_user_limit,expires,featured)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (code, kind, float(d["value"]),
         float(d.get("min_subtotal") or 0), num_or_none("max_discount"),
         int_or_none("max_uses"), int(d.get("per_user_limit") or 1),
         (d.get("expires") or "").strip() or None,
         1 if d.get("featured") else 0),
    )
    db.commit()
    row = db.execute("SELECT * FROM promo_codes WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(ok=True, promo=_public(row))


@promo_bp.route("/admin/promo/<int:promo_id>", methods=["POST"])
@require("inventory")
def update_promo(promo_id):
    d = request.get_json(force=True, silent=True) or {}
    db = get_db()
    if not db.execute("SELECT id FROM promo_codes WHERE id=?", (promo_id,)).fetchone():
        return jsonify(ok=False, error="Code not found."), 404
    if d.get("active") is not None:
        db.execute("UPDATE promo_codes SET active=? WHERE id=?",
                   (1 if d["active"] else 0, promo_id))
        db.commit()
    if d.get("featured") is not None:
        db.execute("UPDATE promo_codes SET featured=? WHERE id=?",
                   (1 if d["featured"] else 0, promo_id))
        db.commit()
    row = db.execute("SELECT * FROM promo_codes WHERE id=?", (promo_id,)).fetchone()
    return jsonify(ok=True, promo=_public(row))
