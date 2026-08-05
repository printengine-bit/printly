# ── Reports blueprint ────────────────────────────────────────────
#
# Every figure here is computed from the same rows the rest of the panel
# reads — nothing is precomputed into a summary table, because a summary
# that drifts from the orders it claims to describe is worse than no report.
# At this size the aggregates are milliseconds.
#
# Cancelled orders are excluded from money and included in counts, and each
# report says which it did. "Revenue" that quietly includes cancellations is
# the classic way a dashboard lies.
import json
from datetime import datetime, timedelta, timezone

from flask import Blueprint, request, jsonify

from db import get_db
from permissions import require

reports_bp = Blueprint("reports", __name__, url_prefix="/api/admin/reports")

STAGE_LABELS = ["Proof sent", "Approved", "Printing", "Quality check",
                "Shipped", "Delivered"]


def _days(n):
    """Ordered list of the last n dates as YYYY-MM-DD, oldest first. Built in
    Python rather than SQL so days with no orders still appear — a gap in a
    chart is information, a missing row is just absence."""
    today = datetime.now(timezone.utc).date()
    return [(today - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


@reports_bp.route("/sales")
@require("reports")
def sales():
    db = get_db()
    try:
        span = max(7, min(365, int(request.args.get("days") or 30)))
    except ValueError:
        span = 30
    days = _days(span)
    since = days[0]

    rows = db.execute(
        """SELECT date(created) d, COUNT(*) n,
                  SUM(CASE WHEN cancelled=0 THEN total_inr ELSE 0 END) rev,
                  SUM(CASE WHEN cancelled=1 THEN 1 ELSE 0 END) cancelled
           FROM orders WHERE date(created) >= date(?) AND payment_status!='pending'
           GROUP BY date(created)""", (since,)).fetchall()
    by_day = {r["d"]: r for r in rows}
    series = [{"date": d,
               "orders": by_day[d]["n"] if d in by_day else 0,
               "revenue": (by_day[d]["rev"] or 0) if d in by_day else 0,
               "cancelled": by_day[d]["cancelled"] if d in by_day else 0}
              for d in days]

    # Per product and the tax split — walked in Python because the figures
    # live inside items_json and tax_json, not in columns we can GROUP BY.
    prod, gst_by_rate, pieces, taxable = {}, {}, 0, 0.0
    orders = db.execute(
        """SELECT items_json, tax_json, total_inr, cancelled
           FROM orders WHERE date(created) >= date(?) AND cancelled=0 AND payment_status!='pending'""",
        (since,)).fetchall()
    for o in orders:
        try:
            items = json.loads(o["items_json"]) or []
        except (ValueError, TypeError):
            items = []
        for it in items:
            if not isinstance(it, dict):
                continue
            k = it.get("product") or it.get("pid") or "—"
            e = prod.setdefault(k, {"product": k, "qty": 0, "revenue": 0.0, "orders": 0})
            e["qty"] += int(it.get("qty") or 0)
            e["revenue"] += float(it.get("total") or 0)
            e["orders"] += 1
            pieces += int(it.get("qty") or 0)
        if o["tax_json"]:
            try:
                t = json.loads(o["tax_json"])
            except ValueError:
                continue
            taxable += float(t.get("subtotal") or 0)
            for l in t.get("lines") or []:
                rate = l.get("gst_percent")
                if rate is None:
                    continue
                b = gst_by_rate.setdefault(str(rate), {"rate": rate, "taxable": 0.0, "tax": 0.0})
                b["taxable"] += float(l.get("total") or 0)
                b["tax"] += float(l.get("total") or 0) * float(rate) / 100.0

    live = [o for o in orders]
    revenue = sum(o["total_inr"] for o in live)
    return jsonify(ok=True, days=span, series=series,
                   totals={
                       "orders": len(live),
                       "revenue": round(revenue, 2),
                       "aov": round(revenue / len(live), 2) if live else 0,
                       "pieces": pieces,
                       "cancelled": sum(s["cancelled"] for s in series),
                   },
                   products=sorted(prod.values(), key=lambda x: -x["revenue"]),
                   gst=[{**v, "taxable": round(v["taxable"], 2), "tax": round(v["tax"], 2)}
                        for v in sorted(gst_by_rate.values(), key=lambda x: x["rate"])],
                   # Orders placed before tax_json existed carry no breakdown,
                   # so the GST table below can cover fewer orders than the
                   # revenue above. Saying so beats a silent mismatch.
                   gst_covered=sum(1 for o in orders if o["tax_json"]),
                   gst_total_orders=len(orders))


@reports_bp.route("/throughput")
@require("reports")
def throughput():
    db = get_db()
    days = _days(30)

    stages = db.execute(
        """SELECT status, COUNT(*) n FROM orders WHERE cancelled=0 AND payment_status!='pending' GROUP BY status""").fetchall()
    by_stage = {r["status"]: r["n"] for r in stages}
    pipeline = [{"stage": i, "label": STAGE_LABELS[i], "orders": by_stage.get(i, 0)}
                for i in range(len(STAGE_LABELS))]

    # Dispatches per day, from the shipments table — the only record of goods
    # physically leaving, which is what throughput means.
    ship = db.execute(
        """SELECT date(created) d, COUNT(*) n, SUM(boxes) boxes
           FROM shipments WHERE date(created) >= date(?) GROUP BY date(created)""",
        (days[0],)).fetchall()
    sm = {r["d"]: r for r in ship}
    dispatched = [{"date": d, "count": sm[d]["n"] if d in sm else 0,
                   "boxes": (sm[d]["boxes"] or 0) if d in sm else 0} for d in days]

    # How long orders sit at each stage, from the audit log's stage moves.
    # Only pairs where we saw both the entry and the exit — an order still
    # sitting somewhere has no duration yet, and assuming "now" would make
    # a stalled queue look fast.
    moves = db.execute(
        """SELECT entity_id, from_val, to_val, created FROM audit_log
           WHERE entity_type='order' AND action='stage' ORDER BY entity_id, id""").fetchall()
    dwell, last = {}, {}
    for m in moves:
        oid, frm = m["entity_id"], m["from_val"]
        prev = last.get(oid)
        if prev and frm is not None:
            try:
                a = datetime.fromisoformat(prev[1].replace(" ", "T"))
                b = datetime.fromisoformat(m["created"].replace(" ", "T"))
                hrs = (b - a).total_seconds() / 3600.0
                if 0 <= hrs < 24 * 90:
                    d = dwell.setdefault(prev[0], [])
                    d.append(hrs)
            except (ValueError, AttributeError):
                pass
        last[oid] = (m["to_val"], m["created"])
    stage_time = []
    for i, label in enumerate(STAGE_LABELS):
        vals = dwell.get(str(i), [])
        # Kept in minutes: a stage cleared in four minutes rounds to "0.1 h",
        # which reads like a bug rather than like speed. The panel picks the
        # unit; rounding to hours here would throw the detail away first.
        stage_time.append({"stage": i, "label": label, "n": len(vals),
                           "avg_minutes": round(sum(vals) / len(vals) * 60, 1) if vals else None})

    proofed = db.execute(
        """SELECT COUNT(*) c FROM audit_log
           WHERE entity_type='order' AND action='stage'
             AND from_val='0' AND to_val='1'""").fetchone()["c"]
    return jsonify(ok=True, pipeline=pipeline, dispatched=dispatched,
                   stage_time=stage_time, proofs_approved=proofed)


@reports_bp.route("/stock")
@require("reports")
def stock_value():
    db = get_db()
    rows = db.execute(
        """SELECT p.id, p.slug, p.name, p.cost_price,
                  (SELECT COALESCE(MIN(unit_price),p.base_price) FROM price_tiers t
                    WHERE t.product_id=p.id) AS floor_price,
                  COALESCE(SUM(v.stock_qty),0) AS qty,
                  SUM(CASE WHEN v.stock_qty < 0 THEN 1 ELSE 0 END) AS negative
           FROM products p LEFT JOIN variants v ON v.product_id=p.id
           GROUP BY p.id ORDER BY p.sort,p.id""").fetchall()
    out, cost_total, retail_total, no_cost = [], 0.0, 0.0, 0
    for r in rows:
        qty = r["qty"] or 0
        cost = r["cost_price"] or 0
        if not cost:
            no_cost += 1
        cost_total += qty * cost
        retail_total += qty * (r["floor_price"] or 0)
        out.append({"product": r["name"], "product_id": r["slug"], "qty": qty,
                    "cost": cost, "value": round(qty * cost, 2),
                    "retail": round(qty * (r["floor_price"] or 0), 2),
                    "negative": r["negative"] or 0})
    counted = db.execute(
        """SELECT COUNT(DISTINCT variant_id) c FROM stock_moves""").fetchone()["c"]
    variants = db.execute("SELECT COUNT(*) c FROM variants").fetchone()["c"]
    return jsonify(ok=True, products=out,
                   cost_value=round(cost_total, 2), retail_value=round(retail_total, 2),
                   # A valuation is only as good as its cost prices; if none
                   # are set the number is zero and must say why.
                   missing_cost=no_cost,
                   counted_variants=counted, total_variants=variants)


@reports_bp.route("/ai")
@require("reports")
def ai_usage():
    db = get_db()
    days = _days(30)
    rows = db.execute(
        """SELECT date(created) d, COUNT(*) n, COALESCE(SUM(cost_inr),0) cost
           FROM generations WHERE date(created) >= date(?) GROUP BY date(created)""",
        (days[0],)).fetchall()
    m = {r["d"]: r for r in rows}
    series = [{"date": d, "count": m[d]["n"] if d in m else 0,
               "cost": round(m[d]["cost"], 2) if d in m else 0} for d in days]
    models = db.execute(
        """SELECT COALESCE(model,'unknown') model, COUNT(*) n,
                  COALESCE(SUM(cost_inr),0) cost
           FROM generations GROUP BY model ORDER BY n DESC""").fetchall()
    allt = db.execute(
        "SELECT COUNT(*) n, COALESCE(SUM(cost_inr),0) cost FROM generations").fetchone()
    return jsonify(ok=True, series=series,
                   models=[{"model": r["model"], "count": r["n"],
                            "cost": round(r["cost"], 2)} for r in models],
                   total={"count": allt["n"], "cost": round(allt["cost"], 2)})
