# ── Wishlist ──────────────────────────────────────────────────
# A signed-in user's saved-for-later list. Storage mirrors reviews.py:
# product_id is the catalogue slug, not a products.id FK, so the frontend
# never needs a join — it already holds the full catalogue in memory as
# PRODUCTS and just filters by id.
from flask import Blueprint, request, jsonify, session

from db import get_db
from auth import login_required

wishlist_bp = Blueprint("wishlist", __name__, url_prefix="/api/wishlist")


@wishlist_bp.route("")
@login_required
def my_wishlist():
    rows = get_db().execute(
        "SELECT product_id FROM wishlist WHERE user_id=? ORDER BY created DESC",
        (session["user_id"],),
    ).fetchall()
    return jsonify(ok=True, product_ids=[r["product_id"] for r in rows])


@wishlist_bp.route("/toggle", methods=["POST"])
@login_required
def toggle():
    d = request.get_json(force=True, silent=True) or {}
    pid = (d.get("product_id") or "").strip()[:64]
    if not pid:
        return jsonify(ok=False, error="No product given."), 400

    db = get_db()
    existing = db.execute(
        "SELECT id FROM wishlist WHERE user_id=? AND product_id=?",
        (session["user_id"], pid),
    ).fetchone()
    if existing:
        db.execute("DELETE FROM wishlist WHERE id=?", (existing["id"],))
        db.commit()
        return jsonify(ok=True, wishlisted=False)

    db.execute("INSERT INTO wishlist(user_id,product_id) VALUES(?,?)",
               (session["user_id"], pid))
    db.commit()
    return jsonify(ok=True, wishlisted=True)
