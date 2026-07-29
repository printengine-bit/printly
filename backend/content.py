# ── Content blueprint: templates, review moderation, print zones ──
#
# The three things a shop edits that aren't products or orders.
#
# Review moderation hides, never deletes: a review taken down for language
# is still evidence the purchase happened, and "who removed this and why"
# is a question that gets asked.
#
# Print zones used to live in js/mockup-data.js, which meant correcting a
# measurement was a code change. They matter more than they look: every
# garment size is derived from the reference zone by scaling, so one wrong
# figure is wrong on all six sizes at once.
import json

from flask import Blueprint, request, jsonify, session

from db import get_db
from permissions import require

content_bp = Blueprint("content", __name__, url_prefix="/api/admin/content")


def zones_payload(db=None):
    """{mock_key: {cx,cy,w,h,cmW,cmH}} in the shape mockup-data.js uses, so
    the storefront can merge it straight over the file defaults."""
    db = db or get_db()
    rows = db.execute("SELECT * FROM print_zones").fetchall()
    return {r["mock_key"]: {"cx": r["cx"], "cy": r["cy"], "w": r["w"], "h": r["h"],
                            "cmW": r["cm_w"], "cmH": r["cm_h"]} for r in rows}


# ── Design templates ─────────────────────────────────────────────
@content_bp.route("/templates")
@require("content")
def list_templates():
    db = get_db()
    rows = db.execute(
        """SELECT d.id,d.name,d.product_id,d.shirt_color,d.thumb,d.is_template,
                  d.sort,d.created,u.name AS author
           FROM saved_designs d LEFT JOIN users u ON u.id=d.user_id
           WHERE d.is_template=1 ORDER BY d.sort, d.id""").fetchall()
    # Recent customer designs, offered as promotion candidates. A good
    # template is usually something a customer already made, not something
    # invented in an empty studio.
    cand = db.execute(
        """SELECT d.id,d.name,d.product_id,d.thumb,d.created,u.name AS author
           FROM saved_designs d LEFT JOIN users u ON u.id=d.user_id
           WHERE d.is_template=0 ORDER BY d.id DESC LIMIT 24""").fetchall()
    pub = lambda r, extra=(): dict(
        {"id": r["id"], "name": r["name"], "product": r["product_id"],
         "thumb": r["thumb"], "created": r["created"], "author": r["author"]},
        **{k: r[k] for k in extra})
    return jsonify(ok=True,
                   templates=[pub(r, ("sort",)) for r in rows],
                   candidates=[pub(r) for r in cand])


@content_bp.route("/templates/<int:did>")
@require("content")
def template_detail(did):
    """Enough to decide whether to publish it. A 56px thumbnail isn't —
    publishing puts someone's design in front of every visitor, and the two
    things that decide it are what the artwork actually says and whether any
    of it is a customer's own uploaded logo."""
    db = get_db()
    r = db.execute(
        """SELECT d.*, u.name AS author, u.email AS author_email
           FROM saved_designs d LEFT JOIN users u ON u.id=d.user_id
           WHERE d.id=?""", (did,)).fetchone()
    if not r:
        return jsonify(ok=False, error="No such design."), 404
    try:
        layers = json.loads(r["layers_json"]) or {}
    except (ValueError, TypeError):
        layers = {}

    sides, uploaded = {}, 0
    for side in ("front", "back"):
        out = []
        for l in layers.get(side) or []:
            if not isinstance(l, dict):
                continue
            if l.get("type") == "text":
                out.append({"kind": "text", "text": l.get("text") or "",
                            "font": l.get("font") or "", "color": l.get("color") or "",
                            "size": l.get("size")})
            else:
                uploaded += 1
                out.append({"kind": "image",
                            "w": round(l.get("w") or 0), "h": round(l.get("h") or 0)})
        sides[side] = out

    prod = db.execute("SELECT name FROM products WHERE slug=?", (r["product_id"],)).fetchone()
    return jsonify(ok=True, design={
        "id": r["id"], "name": r["name"], "product_id": r["product_id"],
        "product": prod["name"] if prod else r["product_id"],
        "shirt_color": r["shirt_color"], "thumb": r["thumb"],
        "is_template": bool(r["is_template"]), "created": r["created"],
        "author": r["author"], "author_email": r["author_email"],
        "layers": sides,
        # Publishing a design built on a customer's uploaded logo hands that
        # logo to everyone. The panel can't tell whose it is — it can only
        # make sure nobody publishes one without noticing.
        "uploaded_images": uploaded,
    })


@content_bp.route("/templates/<int:did>", methods=["POST"])
@require("content")
def set_template(did):
    from admin_api import log
    d = request.get_json(force=True, silent=True) or {}
    db = get_db()
    row = db.execute("SELECT * FROM saved_designs WHERE id=?", (did,)).fetchone()
    if not row:
        return jsonify(ok=False, error="No such design."), 404
    if "is_template" in d:
        on = 1 if d["is_template"] else 0
        db.execute("UPDATE saved_designs SET is_template=? WHERE id=?", (on, did))
        log(db, "design", did, "template" if on else "untemplate", None, None, row["name"])
    if "name" in d:
        name = (d["name"] or "").strip()[:80]
        if name:
            db.execute("UPDATE saved_designs SET name=? WHERE id=?", (name, did))
    if "sort" in d:
        try:
            db.execute("UPDATE saved_designs SET sort=? WHERE id=?", (int(d["sort"]), did))
        except (TypeError, ValueError):
            pass
    db.commit()
    return jsonify(ok=True)


# ── Review moderation ────────────────────────────────────────────
@content_bp.route("/reviews")
@require("content")
def list_reviews_admin():
    db = get_db()
    scope = (request.args.get("scope") or "all").strip()
    sql = """SELECT r.*, u.name AS author, u.email AS author_email, p.name AS product_name
             FROM reviews r
             LEFT JOIN users u ON u.id=r.user_id
             LEFT JOIN products p ON p.slug=r.product_id
             WHERE 1=1"""
    if scope == "hidden":
        sql += " AND r.hidden=1"
    elif scope == "visible":
        sql += " AND r.hidden=0"
    elif scope == "low":
        sql += " AND r.rating<=2 AND r.hidden=0"
    sql += " ORDER BY r.id DESC LIMIT 300"
    rows = db.execute(sql).fetchall()
    counts = {
        "all": db.execute("SELECT COUNT(*) c FROM reviews").fetchone()["c"],
        "hidden": db.execute("SELECT COUNT(*) c FROM reviews WHERE hidden=1").fetchone()["c"],
        "low": db.execute(
            "SELECT COUNT(*) c FROM reviews WHERE rating<=2 AND hidden=0").fetchone()["c"],
    }
    counts["visible"] = counts["all"] - counts["hidden"]
    return jsonify(ok=True, scope=scope, counts=counts, reviews=[{
        "id": r["id"], "product": r["product_name"] or r["product_id"],
        "product_id": r["product_id"], "rating": r["rating"], "body": r["body"],
        "author": r["author"], "author_email": r["author_email"],
        "created": r["created"], "hidden": bool(r["hidden"]),
        "hidden_reason": r["hidden_reason"],
    } for r in rows])


@content_bp.route("/reviews/<int:rid>", methods=["POST"])
@require("content")
def moderate_review(rid):
    from admin_api import log
    d = request.get_json(force=True, silent=True) or {}
    hide = 1 if d.get("hidden") else 0
    reason = (d.get("reason") or "").strip()[:200]
    if hide and len(reason) < 3:
        return jsonify(ok=False, error="Say why it's being hidden."), 400
    db = get_db()
    r = db.execute("SELECT * FROM reviews WHERE id=?", (rid,)).fetchone()
    if not r:
        return jsonify(ok=False, error="No such review."), 404
    db.execute("UPDATE reviews SET hidden=?, hidden_reason=? WHERE id=?",
               (hide, reason if hide else "", rid))
    log(db, "review", rid, "hidden" if hide else "restored", None, None, reason)
    db.commit()
    return jsonify(ok=True)


# ── Product photos + print zones ─────────────────────────────────
@content_bp.route("/photos")
@require("content")
def photos():
    """What each product's mockup is, and the zone measured on it.

    The image files themselves ship with the code — they are not uploadable
    here on purpose. Railway's filesystem outside the volume is replaced on
    every deploy, so an uploaded photo would vanish at the next push and
    nobody would connect the two events. Replacing a photo is a commit.
    """
    import os
    db = get_db()
    zones = zones_payload(db)
    names = {p["slug"]: p["name"]
             for p in db.execute("SELECT slug,name FROM products").fetchall()}

    # Built from the files that are actually on disk, not from the product
    # list. A product with no mockup (the tote) draws a vector silhouette
    # instead, so inventing a row for it would report a problem that isn't
    # one — and inventing `tb_back` would report a second.
    mdir = os.path.join(os.path.dirname(__file__), "..", "frontend", "mockups")
    try:
        files = sorted(f for f in os.listdir(mdir) if f.lower().endswith(".jpg"))
    except OSError:
        files = []

    out = []
    for f in files:
        key = os.path.splitext(f)[0]
        slug = key[:-5] if key.endswith("_back") else key
        try:
            size = os.path.getsize(os.path.join(mdir, f))
        except OSError:
            size = 0
        out.append({
            "product": names.get(slug, slug), "product_id": slug,
            "side": "back" if key.endswith("_back") else "front",
            "key": key, "file": "mockups/%s" % f, "bytes": size,
            "zone": zones.get(key),
            # A photo with no zone row is the real fault: mockLayout() would
            # fall through to the round-neck tee's measurements.
            "missing": key not in zones,
        })

    # Products drawn without a photo, so the screen accounts for everything
    # rather than silently omitting them.
    no_photo = [names[s] for s in names
                if not any(p["product_id"] == s for p in out)]
    return jsonify(ok=True, photos=out, no_photo=sorted(no_photo),
                   orphan_zones=sorted(k for k in zones
                                       if not any(p["key"] == k for p in out)))


@content_bp.route("/zones/<key>", methods=["POST"])
@require("content")
def set_zone(key):
    from admin_api import log
    d = request.get_json(force=True, silent=True) or {}
    db = get_db()
    cur = db.execute("SELECT * FROM print_zones WHERE mock_key=?", (key,)).fetchone()
    if not cur:
        return jsonify(ok=False, error="No such mockup."), 404
    vals = {}
    # Bounds are sanity, not policy: mockup space is 720px wide, and a print
    # zone measured in metres or millimetres is a typo either way.
    for field, lo, hi in (("cx", 0, 720), ("cy", 0, 900), ("w", 10, 720),
                          ("h", 10, 900), ("cm_w", 1, 200), ("cm_h", 1, 200)):
        v = d.get(field, cur[field])
        try:
            v = float(v)
        except (TypeError, ValueError):
            return jsonify(ok=False, error="%s isn't a number." % field), 400
        if not lo <= v <= hi:
            return jsonify(ok=False,
                           error="%s must be between %g and %g." % (field, lo, hi)), 400
        vals[field] = v
    db.execute("""UPDATE print_zones SET cx=?,cy=?,w=?,h=?,cm_w=?,cm_h=?,
                  updated=CURRENT_TIMESTAMP WHERE mock_key=?""",
               (vals["cx"], vals["cy"], vals["w"], vals["h"],
                vals["cm_w"], vals["cm_h"], key))
    log(db, "zone", 0, "zone_updated", None, None,
        "%s → %g×%g cm" % (key, vals["cm_w"], vals["cm_h"]))
    db.commit()
    return jsonify(ok=True, zone=zones_payload(db).get(key))
