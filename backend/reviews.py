# ── Product reviews ─────────────────────────────────────────────
# Posting requires both a login AND a real order containing the product.
# Without the purchase check this is just a spam target, and fake ratings
# are worse than no ratings.
import json
from flask import Blueprint, request, jsonify, session

from db import get_db
from auth import login_required

reviews_bp = Blueprint("reviews", __name__, url_prefix="/api/reviews")

MAX_BODY = 1000


def _has_purchased(db, user_id, product_id):
    """True if any of this user's orders contains the product.

    Cart lines added since this feature carry `pid`; older orders only have
    the display `product` name, so match either — otherwise every
    pre-existing customer would be wrongly blocked from reviewing.
    """
    rows = db.execute("SELECT items_json FROM orders WHERE user_id=?", (user_id,)).fetchall()
    for r in rows:
        try:
            items = json.loads(r["items_json"])
        except (ValueError, TypeError):
            continue
        if not isinstance(items, list):
            continue
        for it in items:
            if not isinstance(it, dict):
                continue
            if it.get("pid") == product_id:
                return True
            name = (it.get("product") or "").strip().lower()
            if name and name == (PRODUCT_NAMES.get(product_id) or "").lower():
                return True
    return False


# Mirrors PRODUCTS in frontend/js/data.js. Only used to match legacy orders
# that stored the product name instead of the id.
PRODUCT_NAMES = {
    "rn": "Round Neck T-Shirt",
    "po": "Polo Shirt",
    "hd": "Hoodie",
    "js": "Sports Jersey",
    "tb": "Tote Bag",
}


@reviews_bp.route("/<product_id>")
def list_reviews(product_id):
    db = get_db()
    rows = db.execute(
        """SELECT reviews.*, users.name AS author
           FROM reviews JOIN users ON users.id = reviews.user_id
           WHERE product_id=? ORDER BY reviews.created DESC LIMIT 50""",
        (product_id,),
    ).fetchall()
    agg = db.execute(
        "SELECT COUNT(*) n, COALESCE(AVG(rating),0) avg FROM reviews WHERE product_id=?",
        (product_id,),
    ).fetchone()
    return jsonify(
        ok=True,
        count=agg["n"],
        average=round(agg["avg"], 1),
        can_review=_can_review(db, product_id),
        reviews=[{
            "id": r["id"],
            "author": r["author"],
            "rating": r["rating"],
            "body": r["body"],
            "created": r["created"],
        } for r in rows],
    )


def _can_review(db, product_id):
    uid = session.get("user_id")
    if not uid:
        return False
    already = db.execute(
        "SELECT 1 FROM reviews WHERE user_id=? AND product_id=?", (uid, product_id)
    ).fetchone()
    if already:
        return False
    return _has_purchased(db, uid, product_id)


@reviews_bp.route("/<product_id>", methods=["POST"])
@login_required
def post_review(product_id):
    d = request.get_json(force=True, silent=True) or {}
    try:
        rating = int(d.get("rating", 0))
    except (TypeError, ValueError):
        rating = 0
    if not 1 <= rating <= 5:
        return jsonify(ok=False, error="Pick a rating from 1 to 5."), 400

    body = (d.get("body") or "").strip()[:MAX_BODY]
    db = get_db()

    if not _has_purchased(db, session["user_id"], product_id):
        return jsonify(ok=False, error="Only verified buyers can review this product."), 403
    if db.execute("SELECT 1 FROM reviews WHERE user_id=? AND product_id=?",
                  (session["user_id"], product_id)).fetchone():
        return jsonify(ok=False, error="You've already reviewed this product."), 400

    db.execute(
        "INSERT INTO reviews(product_id,user_id,rating,body) VALUES(?,?,?,?)",
        (product_id, session["user_id"], rating, body),
    )
    db.commit()
    return jsonify(ok=True)


@reviews_bp.route("/summary")
def summary():
    """Per-product rating rollup for the catalog grid — one query instead of
    one request per card."""
    rows = get_db().execute(
        """SELECT product_id, COUNT(*) n, AVG(rating) avg
           FROM reviews GROUP BY product_id"""
    ).fetchall()
    return jsonify(ok=True, summary={
        r["product_id"]: {"count": r["n"], "average": round(r["avg"], 1)} for r in rows
    })
