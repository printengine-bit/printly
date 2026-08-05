# ── Production: print queue, artwork files, proof tracking ──────
# The order list answers "what did this customer buy". The print floor needs
# the opposite view: what to pull off the shelf and what to put on the press,
# batched across every open order.
import json
import os

from flask import Blueprint, jsonify, request

from db import get_db
from permissions import require
from artwork import ART_DIR

production_bp = Blueprint("production", __name__, url_prefix="/api/admin/production")

# Stages a garment is actually being made in. 0 is waiting on the customer's
# proof approval and 4/5 have left the building, so neither belongs in a
# queue for the press.
IN_PRODUCTION = (1, 2, 3)

# The storefront promises a digital proof within 2 hours. Anything sitting
# unapproved past that is a broken promise, so the panel says so rather than
# leaving it to be noticed.
PROOF_SLA_HOURS = 2


def _open_orders(db, stages=IN_PRODUCTION):
    marks = ",".join("?" * len(stages))
    return db.execute(
        """SELECT o.*, u.name AS customer FROM orders o
           JOIN users u ON u.id=o.user_id
           WHERE o.cancelled=0 AND o.payment_status!='pending' AND o.status IN (%s)
           ORDER BY o.created""" % marks, stages).fetchall()


@production_bp.route("/jobs")
@require("production")
def print_jobs():
    """Everything on the floor, grouped by blank: product + garment colour.

    Grouping by artwork would be pointless — every design is bespoke, so
    each would be its own group. Grouping by the blank is what lets someone
    pull twelve green polos once instead of walking to the shelf per order.
    """
    db = get_db()
    colors = {r["color_hex"].upper(): r["color_name"] for r in db.execute(
        "SELECT DISTINCT color_hex,color_name FROM variants")}

    groups = {}
    for o in _open_orders(db):
        try:
            items = json.loads(o["items_json"])
        except (ValueError, TypeError):
            continue
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict):
                continue
            hexv = (it.get("shirt") or "").upper()
            key = (it.get("pid") or "?", hexv)
            g = groups.setdefault(key, {
                "pid": key[0], "product": it.get("product") or key[0],
                "color_hex": hexv, "color_name": colors.get(hexv, hexv),
                "qty": 0, "lines": [],
            })
            sizes = it.get("sizes") if isinstance(it.get("sizes"), dict) else {}
            qty = sum(n for n in sizes.values() if isinstance(n, int) and n > 0) \
                or (it.get("qty") if isinstance(it.get("qty"), int) else 0)
            g["qty"] += qty
            g["lines"].append({
                "order": "PL-" + str(1000 + o["id"]),
                "customer": o["customer"],
                "status": o["status"],
                "created": o["created"],
                "sizes": sizes,
                "qty": qty,
                "art": it.get("art") or {},
                "spec": it.get("spec") or {},
                "thumb": it.get("thumb"),
            })
    out = sorted(groups.values(), key=lambda g: (-g["qty"], g["product"]))
    return jsonify(ok=True, jobs=out,
                   total_pieces=sum(g["qty"] for g in out))


@production_bp.route("/artwork")
@require("production")
def artwork_files():
    """Every print file, matched back to the order that produced it.

    Also reports orphans — files on the volume that no order references.
    Those come from a checkout that uploaded artwork and then failed, and
    they're the only thing on the volume that grows without bound.
    """
    db = get_db()
    used = {}
    for o in db.execute("SELECT id,items_json,cancelled,status,created FROM orders"):
        try:
            items = json.loads(o["items_json"])
        except (ValueError, TypeError):
            continue
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict):
                continue
            for side, url in (it.get("art") or {}).items():
                if not isinstance(url, str):
                    continue
                used[os.path.basename(url)] = {
                    "url": url, "side": side,
                    "order": "PL-" + str(1000 + o["id"]),
                    "product": it.get("product"),
                    "cancelled": bool(o["cancelled"]),
                    "created": o["created"],
                }

    files, orphans, total = [], 0, 0
    try:
        names = sorted(os.listdir(ART_DIR))
    except OSError:
        names = []
    for name in names:
        path = os.path.join(ART_DIR, name)
        if not os.path.isfile(path):
            continue
        size = os.path.getsize(path)
        total += size
        meta = used.get(name)
        if not meta:
            orphans += 1
        files.append({
            "name": name, "bytes": size,
            "format": name.rsplit(".", 1)[-1].lower(),
            "url": "/api/artwork/" + name,
            "order": meta["order"] if meta else None,
            "side": meta["side"] if meta else None,
            "product": meta["product"] if meta else None,
            "cancelled": meta["cancelled"] if meta else False,
            "orphan": meta is None,
        })
    files.sort(key=lambda f: (f["order"] or "", f["name"]), reverse=True)
    return jsonify(ok=True, files=files, orphans=orphans, total_bytes=total)


@production_bp.route("/proofs")
@require("production")
def proofs():
    """Orders waiting on proof approval, oldest first, with the ones past
    the 2-hour promise flagged. Approval history comes from the audit log —
    a 0 -> 1 stage change is exactly "customer approved the proof"."""
    db = get_db()
    waiting = []
    for o in db.execute("""SELECT o.*, u.name AS customer, u.email FROM orders o
                           JOIN users u ON u.id=o.user_id
                           WHERE o.cancelled=0 AND o.payment_status!='pending' AND o.status=0
                           ORDER BY o.created"""):
        age = db.execute(
            "SELECT (julianday('now') - julianday(?)) * 24 AS h", (o["created"],)
        ).fetchone()["h"]
        waiting.append({
            "id": "PL-" + str(1000 + o["id"]), "customer": o["customer"],
            "email": o["email"], "created": o["created"],
            "hours": round(age, 1), "overdue": age > PROOF_SLA_HOURS,
        })
    approved = [{
        "id": "PL-" + str(1000 + r["entity_id"]), "created": r["created"],
        "actor": r["actor_name"],
    } for r in db.execute("""
        SELECT a.*, u.name AS actor_name FROM audit_log a
        LEFT JOIN users u ON u.id=a.actor_id
        WHERE a.entity_type='order' AND a.action='stage'
          AND a.from_val='0' AND a.to_val='1'
        ORDER BY a.id DESC LIMIT 30""")]
    return jsonify(ok=True, waiting=waiting, approved=approved,
                   sla_hours=PROOF_SLA_HOURS,
                   overdue=sum(1 for w in waiting if w["overdue"]))
