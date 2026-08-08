# ── Saved address book ───────────────────────────────────────────
# Separate from orders.ship_* on purpose. Those columns are a frozen copy
# of what a specific parcel was actually addressed to — like tax_json,
# never rewritten after the order is placed. This table is the opposite:
# a live, editable list checkout can prefill from, with nothing tying a
# row here to any order it was ever used on.
import re

from flask import Blueprint, request, jsonify, session

from db import get_db
from auth import login_required

addresses_bp = Blueprint("addresses", __name__, url_prefix="/api/account/addresses")

# Same shape orders.py already validates a delivery address against —
# imported rather than redefined, so the two can't quietly drift apart.
from orders import _clean_shipping

MAX_LABEL = 40


def _public(row):
    return {"id": row["id"], "label": row["label"], "name": row["name"],
            "phone": row["phone"], "line1": row["line1"], "line2": row["line2"],
            "city": row["city"], "state": row["state"], "pincode": row["pincode"],
            "is_default": bool(row["is_default"])}


def _clear_other_defaults(db, user_id, keep_id=None):
    if keep_id:
        db.execute("UPDATE addresses SET is_default=0 WHERE user_id=? AND id<>?",
                   (user_id, keep_id))
    else:
        db.execute("UPDATE addresses SET is_default=0 WHERE user_id=?", (user_id,))


@addresses_bp.route("")
@login_required
def list_addresses():
    rows = get_db().execute(
        "SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, created DESC",
        (session["user_id"],)).fetchall()
    return jsonify(ok=True, addresses=[_public(r) for r in rows])


@addresses_bp.route("", methods=["POST"])
@login_required
def create_address():
    d = request.get_json(force=True, silent=True) or {}
    ship, error = _clean_shipping(d)
    if error:
        return jsonify(ok=False, error=error), 400
    label = (d.get("label") or "").strip()[:MAX_LABEL]

    db = get_db()
    user_id = session["user_id"]
    # A user's first address is the default whether they ticked the box or
    # not — there's no meaningful "no default" state for someone who has
    # exactly one address.
    is_first = not db.execute(
        "SELECT 1 FROM addresses WHERE user_id=?", (user_id,)).fetchone()
    make_default = bool(d.get("is_default")) or is_first
    if make_default:
        _clear_other_defaults(db, user_id)

    cur = db.execute(
        """INSERT INTO addresses(user_id,label,name,phone,line1,line2,city,state,
                                 pincode,is_default)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (user_id, label, ship["name"], ship["phone"], ship["line1"], ship["line2"],
         ship["city"], ship["state"], ship["pincode"], 1 if make_default else 0))
    db.commit()
    row = db.execute("SELECT * FROM addresses WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(ok=True, address=_public(row))


@addresses_bp.route("/<int:addr_id>", methods=["POST"])
@login_required
def update_address(addr_id):
    db = get_db()
    row = db.execute("SELECT * FROM addresses WHERE id=? AND user_id=?",
                     (addr_id, session["user_id"])).fetchone()
    if not row:
        return jsonify(ok=False, error="Address not found."), 404

    d = request.get_json(force=True, silent=True) or {}
    ship, error = _clean_shipping(d)
    if error:
        return jsonify(ok=False, error=error), 400
    label = (d.get("label") or "").strip()[:MAX_LABEL]

    if d.get("is_default"):
        _clear_other_defaults(db, session["user_id"], keep_id=addr_id)

    db.execute(
        """UPDATE addresses SET label=?,name=?,phone=?,line1=?,line2=?,city=?,
                                state=?,pincode=?,is_default=?
           WHERE id=?""",
        (label, ship["name"], ship["phone"], ship["line1"], ship["line2"],
         ship["city"], ship["state"], ship["pincode"],
         1 if d.get("is_default") else row["is_default"], addr_id))
    db.commit()
    row = db.execute("SELECT * FROM addresses WHERE id=?", (addr_id,)).fetchone()
    return jsonify(ok=True, address=_public(row))


@addresses_bp.route("/<int:addr_id>", methods=["DELETE"])
@login_required
def delete_address(addr_id):
    db = get_db()
    row = db.execute("SELECT * FROM addresses WHERE id=? AND user_id=?",
                     (addr_id, session["user_id"])).fetchone()
    if not row:
        return jsonify(ok=False, error="Address not found."), 404
    db.execute("DELETE FROM addresses WHERE id=?", (addr_id,))
    # Deleting the default shouldn't leave the book in a state where nothing
    # is — promote whatever's now the most recent remaining one.
    if row["is_default"]:
        nxt = db.execute(
            "SELECT id FROM addresses WHERE user_id=? ORDER BY created DESC LIMIT 1",
            (session["user_id"],)).fetchone()
        if nxt:
            db.execute("UPDATE addresses SET is_default=1 WHERE id=?", (nxt["id"],))
    db.commit()
    return jsonify(ok=True)
