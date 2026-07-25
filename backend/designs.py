# ── Saved designs ("My Designs") + starter templates ────────────
# Unlike the cart — which strips image data because it only needs a
# thumbnail — a saved design keeps its image layers inline so it can be
# fully restored onto the canvas. That makes rows potentially large, hence
# the caps below.
import json
from flask import Blueprint, request, jsonify, session

from db import get_db
from auth import login_required, admin_required

designs_bp = Blueprint("designs", __name__, url_prefix="/api/designs")

MAX_DESIGNS_PER_USER = 20
# Generous enough for a couple of full-res AI images, small enough that one
# user can't fill a 1GB volume. Enforced here as well as by Flask's global
# MAX_CONTENT_LENGTH so the error message is useful rather than a bare 413.
MAX_DESIGN_BYTES = 4 * 1024 * 1024


def _public(row, include_layers=False):
    d = {
        "id": row["id"],
        "name": row["name"],
        "product_id": row["product_id"],
        "shirt_color": row["shirt_color"],
        "thumb": row["thumb"],
        "is_template": bool(row["is_template"]),
        "created": row["created"],
        "updated": row["updated"],
    }
    if include_layers:
        d["layers"] = json.loads(row["layers_json"])
    return d


@designs_bp.route("", methods=["POST"])
@login_required
def save_design():
    d = request.get_json(force=True, silent=True) or {}
    name = (d.get("name") or "").strip()[:80]
    product_id = (d.get("product_id") or "").strip()
    layers = d.get("layers")
    if not name or not product_id or not isinstance(layers, dict):
        return jsonify(ok=False, error="Give the design a name and try again."), 400

    layers_json = json.dumps(layers)
    if len(layers_json.encode()) > MAX_DESIGN_BYTES:
        return jsonify(ok=False, error="This design is too large to save. Try fewer or smaller images."), 413

    db = get_db()
    design_id = d.get("id")

    if design_id:  # update in place — only ever the caller's own row
        row = db.execute(
            "SELECT id FROM saved_designs WHERE id=? AND user_id=?",
            (design_id, session["user_id"]),
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Design not found."), 404
        db.execute(
            """UPDATE saved_designs
               SET name=?, product_id=?, shirt_color=?, layers_json=?, thumb=?,
                   updated=CURRENT_TIMESTAMP
               WHERE id=?""",
            (name, product_id, d.get("shirt_color") or "#FFFFFF", layers_json, d.get("thumb"), design_id),
        )
        db.commit()
    else:
        n = db.execute(
            "SELECT COUNT(*) c FROM saved_designs WHERE user_id=? AND is_template=0",
            (session["user_id"],),
        ).fetchone()["c"]
        if n >= MAX_DESIGNS_PER_USER:
            return jsonify(
                ok=False,
                error=f"You've saved the maximum of {MAX_DESIGNS_PER_USER} designs. Delete one to make room.",
            ), 400
        cur = db.execute(
            """INSERT INTO saved_designs(user_id,name,product_id,shirt_color,layers_json,thumb)
               VALUES(?,?,?,?,?,?)""",
            (session["user_id"], name, product_id, d.get("shirt_color") or "#FFFFFF",
             layers_json, d.get("thumb")),
        )
        db.commit()
        design_id = cur.lastrowid

    row = db.execute("SELECT * FROM saved_designs WHERE id=?", (design_id,)).fetchone()
    return jsonify(ok=True, design=_public(row))


@designs_bp.route("/mine")
@login_required
def my_designs():
    # Thumbnails only — layers_json can be megabytes, and the gallery never
    # needs it. The full payload comes from GET /api/designs/<id>.
    rows = get_db().execute(
        """SELECT id,name,product_id,shirt_color,thumb,is_template,created,updated
           FROM saved_designs WHERE user_id=? AND is_template=0
           ORDER BY updated DESC""",
        (session["user_id"],),
    ).fetchall()
    return jsonify(ok=True, designs=[_public(r) for r in rows])


@designs_bp.route("/templates")
def templates():
    """Starter designs for the studio's 'Start from template' modal.

    Public — browsing templates shouldn't require an account, same as the
    rest of the design tool.
    """
    rows = get_db().execute(
        """SELECT id,name,product_id,shirt_color,thumb,is_template,created,updated
           FROM saved_designs WHERE is_template=1 ORDER BY id"""
    ).fetchall()
    return jsonify(ok=True, designs=[_public(r) for r in rows])


@designs_bp.route("/<int:design_id>")
def get_design(design_id):
    row = get_db().execute("SELECT * FROM saved_designs WHERE id=?", (design_id,)).fetchone()
    if not row:
        return jsonify(ok=False, error="Design not found."), 404
    # Templates are public; a personal design is only ever its owner's.
    if not row["is_template"] and row["user_id"] != session.get("user_id"):
        return jsonify(ok=False, error="Design not found."), 404
    return jsonify(ok=True, design=_public(row, include_layers=True))


@designs_bp.route("/<int:design_id>", methods=["DELETE"])
@login_required
def delete_design(design_id):
    db = get_db()
    cur = db.execute(
        "DELETE FROM saved_designs WHERE id=? AND user_id=? AND is_template=0",
        (design_id, session["user_id"]),
    )
    db.commit()
    if not cur.rowcount:
        return jsonify(ok=False, error="Design not found."), 404
    return jsonify(ok=True)


@designs_bp.route("/<int:design_id>/promote", methods=["POST"])
@admin_required
def promote_to_template(design_id):
    """Turn one of your own saved designs into a public starter template.

    Seeding templates this way (rather than hardcoding them) means the
    template gallery and My Designs share one storage format and one
    load path.
    """
    db = get_db()
    cur = db.execute("UPDATE saved_designs SET is_template=1 WHERE id=?", (design_id,))
    db.commit()
    if not cur.rowcount:
        return jsonify(ok=False, error="Design not found."), 404
    return jsonify(ok=True)
