# ── Dispatch blueprint: shipments, tax invoices, labels, manifest ──
#
# This is the module that turns a finished print into a parcel with a legal
# document attached. Three things here are not free to be approximate:
#
#  1. The invoice NUMBER. GST wants a consecutive series, unique within a
#     financial year, with no gaps and no reuse. It's allocated inside the
#     same transaction that issues the invoice.
#  2. The tax SPLIT. The same 5% is CGST 2.5 + SGST 2.5 when the parcel stays
#     inside the seller's state and IGST 5 when it crosses one. Same money,
#     different heads, and the return won't reconcile if it's wrong.
#  3. The FROZEN copy. Once issued, an invoice is reprinted from what was
#     stored, never recomputed — rates and the company profile are editable.
import json
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, session, Response

from db import get_db
from permissions import require
from orders import _display_id, _row_id_from_display, _shipping

dispatch_bp = Blueprint("dispatch", __name__, url_prefix="/api/admin/dispatch")

READY = 3        # Quality check — the stage an order waits at to be packed
SHIPPED = 4

# GST state codes. The invoice has to carry the place of supply as
# "<code>-<state>", and the code is what decides CGST+SGST vs IGST.
STATE_CODES = {
    "jammu and kashmir": "01", "himachal pradesh": "02", "punjab": "03",
    "chandigarh": "04", "uttarakhand": "05", "haryana": "06", "delhi": "07",
    "rajasthan": "08", "uttar pradesh": "09", "bihar": "10", "sikkim": "11",
    "arunachal pradesh": "12", "nagaland": "13", "manipur": "14",
    "mizoram": "15", "tripura": "16", "meghalaya": "17", "assam": "18",
    "west bengal": "19", "jharkhand": "20", "odisha": "21", "orissa": "21",
    "chhattisgarh": "22", "madhya pradesh": "23", "gujarat": "24",
    "dadra and nagar haveli and daman and diu": "26", "maharashtra": "27",
    "karnataka": "29", "goa": "30", "lakshadweep": "31", "kerala": "32",
    "tamil nadu": "33", "puducherry": "34", "pondicherry": "34",
    "andaman and nicobar islands": "35", "telangana": "36",
    "andhra pradesh": "37", "ladakh": "38", "other territory": "97",
}


def state_code(name):
    return STATE_CODES.get((name or "").strip().lower(), "")


def financial_year(dt):
    """India's FY runs April–March, so 2026-27 starts on 1 April 2026."""
    y = dt.year if dt.month >= 4 else dt.year - 1
    return "%d-%02d" % (y, (y + 1) % 100)


def next_invoice_no(db, company, now):
    """Allocate the next number in the series, restarting each FY.

    Read-modify-write on a single row. SQLite serialises writers, and this
    only ever runs inside the caller's transaction, so two staff clicking
    Dispatch at the same moment can't be handed the same number.
    """
    fy = financial_year(now)
    n = company["invoice_next"] if company["invoice_fy"] == fy else 1
    db.execute("UPDATE company SET invoice_next=?, invoice_fy=? WHERE id=1", (n + 1, fy))
    return "%s/%s/%04d" % (company["invoice_prefix"] or "INV", fy, n)


def _money(v):
    return round(float(v or 0) + 0.0, 2)


def build_invoice(db, row, company, now, number):
    """The whole document, as a dict, ready to be frozen into the order.

    Line values come from the order's stored tax_json — the pricing that was
    actually applied — not from today's tiers. An order placed before that
    column existed has none, and rather than invent figures we mark the
    invoice as reconstructed so whoever signs it knows.
    """
    stored = None
    if row["tax_json"]:
        try:
            stored = json.loads(row["tax_json"])
        except ValueError:
            stored = None

    items = []
    try:
        items = json.loads(row["items_json"]) or []
    except (ValueError, TypeError):
        items = []

    hsn = {}
    for p in db.execute("SELECT slug,hsn_code FROM products").fetchall():
        hsn[p["slug"]] = p["hsn_code"] or ""

    ship = _shipping(row)
    seller_state = (company["state"] or "").strip()
    buyer_state = (ship["state"] or "").strip()
    # No seller state on file means we can't tell intra from inter. Defaulting
    # either way would silently mis-split the tax, so it's flagged instead.
    interstate = bool(seller_state and buyer_state
                      and state_code(seller_state) != state_code(buyer_state))

    from catalog import gst_rate, tax_settings

    lines, taxable = [], 0.0
    src = stored["lines"] if stored and stored.get("lines") else None
    rows_in = src if src else [i for i in items if isinstance(i, dict)]
    live = None if src else tax_settings(db)
    for l in rows_in:
        amount = _money(l.get("total"))
        unit = _money(l.get("unit"))
        rate = float(l.get("gst_percent")) if src else float(gst_rate(live, unit))
        taxable += amount
        lines.append({
            "product": l.get("product") or "", "hsn": hsn.get(l.get("pid"), ""),
            "qty": l.get("qty") or 0, "unit": unit,
            "amount": amount, "rate": rate, "tax": round(amount * rate / 100.0, 2),
            "sizes": (l.get("sizes") if not src else
                      next((i.get("sizes") for i in items
                            if isinstance(i, dict) and i.get("pid") == l.get("pid")), None)),
        })
    taxable = round(taxable, 2)
    total = _money(row["total_inr"])

    if stored:
        tax_total = float(stored.get("gst") or 0)
        shipping_charge = _money(stored.get("shipping"))
    else:
        # No stored breakdown, so the rates are today's applied to what the
        # order recorded. Shipping is whatever the charged total leaves over
        # — the one figure we can derive rather than guess.
        tax_total = round(sum(l["tax"] for l in lines), 2)
        shipping_charge = round(total - taxable - tax_total, 2)

    # The per-line tax column has to sum to the tax actually charged. quote()
    # rounds the GST once over the whole order, so summing the lines can land
    # a few paise away; the difference goes on the largest line rather than
    # being left as a column that doesn't add up on a filed document.
    drift = round(tax_total - sum(l["tax"] for l in lines), 2)
    if lines and drift:
        big = max(lines, key=lambda l: l["amount"])
        big["tax"] = round(big["tax"] + drift, 2)

    # Everything on the paper must reconcile: taxable + tax + shipping = total.
    # If it doesn't, say so on the document instead of printing a sum that
    # quietly disagrees with itself.
    imbalance = round(total - (taxable + tax_total + shipping_charge), 2)
    if abs(imbalance) < 0.02:
        imbalance = 0.0
    if shipping_charge < 0:
        shipping_charge = 0.0
        imbalance = round(total - (taxable + tax_total), 2)

    return {
        "number": number,
        "date": now.strftime("%Y-%m-%d"),
        "order": _display_id(row["id"]),
        "order_date": (row["created"] or "")[:10],
        "reconstructed": src is None,
        "seller": {
            "name": company["legal_name"] or company["trade_name"] or "",
            "trade": company["trade_name"] or "",
            "address": company["address"] or "", "city": company["city"] or "",
            "state": seller_state, "state_code": state_code(seller_state),
            "pincode": company["pincode"] or "", "phone": company["phone"] or "",
            "email": company["email"] or "", "gstin": company["gstin"] or "",
        },
        "buyer": {
            "name": ship["name"] or row["customer_name"] or "",
            "email": row["customer_email"] or "",
            "phone": ship["phone"], "line1": ship["line1"], "line2": ship["line2"],
            "city": ship["city"], "state": buyer_state,
            "state_code": state_code(buyer_state), "pincode": ship["pincode"],
        },
        "place_of_supply": ("%s-%s" % (state_code(buyer_state), buyer_state)
                            if buyer_state else ""),
        "interstate": interstate,
        # Unknown when either state is missing — the template says so rather
        # than printing a confident CGST/SGST split that may be wrong.
        "split_known": bool(seller_state and buyer_state),
        "lines": lines,
        "taxable": taxable,
        "shipping": shipping_charge,
        "imbalance": imbalance,
        "tax_total": round(tax_total, 2),
        "cgst": 0.0 if interstate else round(tax_total / 2.0, 2),
        "sgst": 0.0 if interstate else round(tax_total / 2.0, 2),
        "igst": round(tax_total, 2) if interstate else 0.0,
        "total": total,
    }


def _issue(db, row, company):
    """Assign a number and freeze the document. Idempotent: an order that
    already has an invoice keeps it, because reissuing under a new number
    would leave the first one unaccounted for in the series."""
    if row["invoice_no"]:
        return row["invoice_no"], json.loads(row["invoice_json"] or "{}")
    now = datetime.now(timezone.utc)
    number = next_invoice_no(db, company, now)
    doc = build_invoice(db, row, company, now, number)
    db.execute("UPDATE orders SET invoice_no=?, invoice_json=?, invoice_at=? WHERE id=?",
               (number, json.dumps(doc), now.strftime("%Y-%m-%d %H:%M:%S"), row["id"]))
    return number, doc


def _company(db):
    return db.execute("SELECT * FROM company WHERE id=1").fetchone()


def _order_or_404(order_id):
    db = get_db()
    rid = _row_id_from_display(order_id)
    if rid is None:
        return None, db
    return db.execute(
        """SELECT orders.*, users.name AS customer_name, users.email AS customer_email
           FROM orders JOIN users ON users.id=orders.user_id WHERE orders.id=?""",
        (rid,)).fetchone(), db


# ── Pending shipments ────────────────────────────────────────────
@dispatch_bp.route("/pending")
@require("dispatch")
def pending():
    db = get_db()
    rows = db.execute(
        """SELECT orders.*, users.name AS customer_name, users.email AS customer_email
           FROM orders JOIN users ON users.id=orders.user_id
           WHERE orders.status=? AND orders.cancelled=0
           ORDER BY orders.created""", (READY,)).fetchall()
    out = []
    for r in rows:
        try:
            items = json.loads(r["items_json"]) or []
        except (ValueError, TypeError):
            items = []
        ship = _shipping(r)
        out.append({
            "id": _display_id(r["id"]), "customer": r["customer_name"],
            "created": r["created"], "total": r["total_inr"],
            "qty": sum(int(i.get("qty") or 0) for i in items if isinstance(i, dict)),
            "lines": [{"product": i.get("product"), "qty": i.get("qty"),
                       "sizes": i.get("sizes")} for i in items if isinstance(i, dict)],
            "shipping": ship,
            # Nothing here can ship without somewhere to send it.
            "ready": bool(ship["recorded"]),
            "invoice_no": r["invoice_no"],
        })
    company = _company(db)
    return jsonify(ok=True, orders=out,
                   # The dispatch screen prints documents, so it's the screen
                   # that has to say when the details on them are missing.
                   company_ready=bool((company["legal_name"] or "").strip()
                                      and (company["state"] or "").strip()),
                   gst_registered=bool((company["gstin"] or "").strip()))


# ── Ship it ──────────────────────────────────────────────────────
@dispatch_bp.route("/ship", methods=["POST"])
@require("dispatch")
def ship():
    from admin_api import log
    d = request.get_json(force=True, silent=True) or {}
    row, db = _order_or_404(d.get("order") or "")
    if not row:
        return jsonify(ok=False, error="Order not found."), 404
    if row["cancelled"]:
        return jsonify(ok=False, error="That order is cancelled."), 400

    courier = (d.get("courier") or "").strip()[:60]
    awb = (d.get("awb") or "").strip()[:60]
    if not courier:
        return jsonify(ok=False, error="Which courier is taking it?"), 400
    if not awb:
        return jsonify(ok=False, error="Add the AWB / tracking number."), 400
    if not (row["ship_line1"] or "").strip():
        return jsonify(ok=False, error="This order has no delivery address."), 400

    dupe = db.execute("SELECT order_id FROM shipments WHERE awb=? AND courier=?",
                      (awb, courier)).fetchone()
    if dupe and dupe["order_id"] != row["id"]:
        return jsonify(ok=False,
                       error="That AWB is already on %s." % _display_id(dupe["order_id"])), 409

    try:
        boxes = max(1, min(99, int(d.get("boxes") or 1)))
        weight = max(0, min(200000, int(d.get("weight_g") or 0)))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="Boxes and weight must be numbers."), 400

    company = _company(db)
    # Goods moving is what makes the invoice due, so it's raised here rather
    # than left to whoever remembers to press print.
    number, _doc = _issue(db, row, company)
    db.execute("""INSERT INTO shipments(order_id,courier,awb,boxes,weight_g,note,actor_id)
                  VALUES(?,?,?,?,?,?,?)""",
               (row["id"], courier, awb, boxes, weight,
                (d.get("note") or "").strip()[:200], session.get("user_id")))
    if row["status"] != SHIPPED:
        db.execute("UPDATE orders SET status=?, updated=CURRENT_TIMESTAMP WHERE id=?",
                   (SHIPPED, row["id"]))
        log(db, "order", row["id"], "stage", row["status"], SHIPPED,
            "Dispatched via %s, AWB %s" % (courier, awb))
    else:
        log(db, "order", row["id"], "reshipped", None, None,
            "Second parcel via %s, AWB %s" % (courier, awb))
    db.commit()

    # Hung off the shipment, not the stage change: a reship takes the `else`
    # branch above and never moves the stage, but it is a second real parcel
    # with its own AWB and the customer needs to hear about it.
    if row["customer_email"]:
        from mailer import send
        from mail_templates import order_shipped
        display = _display_id(row["id"])
        send(row["customer_email"], "%s shipped" % display,
             order_shipped(row["customer_name"], display, courier, awb),
             sender="orders", kind="order_shipped",
             entity_type="order", entity_id=row["id"])
    return jsonify(ok=True, invoice_no=number, order=_display_id(row["id"]))


@dispatch_bp.route("/issue", methods=["POST"])
@require("dispatch")
def issue_invoice():
    d = request.get_json(force=True, silent=True) or {}
    row, db = _order_or_404(d.get("order") or "")
    if not row:
        return jsonify(ok=False, error="Order not found."), 404
    if row["cancelled"]:
        return jsonify(ok=False, error="Won't raise an invoice for a cancelled order."), 400
    number, _doc = _issue(db, row, _company(db))
    db.commit()
    return jsonify(ok=True, invoice_no=number)


# ── Shipment list / manifest data ────────────────────────────────
@dispatch_bp.route("/shipments")
@require("dispatch")
def shipments():
    db = get_db()
    day = (request.args.get("date") or "").strip()
    sql = """SELECT s.*, o.ship_name, o.ship_city, o.ship_state, o.ship_pincode,
                    o.invoice_no, o.total_inr, u.name AS actor_name
             FROM shipments s JOIN orders o ON o.id=s.order_id
             LEFT JOIN users u ON u.id=s.actor_id"""
    args = ()
    if day:
        sql += " WHERE date(s.created)=date(?)"
        args = (day,)
    sql += " ORDER BY s.id DESC LIMIT 300"
    rows = db.execute(sql, args).fetchall()
    return jsonify(ok=True, date=day, shipments=[{
        "id": r["id"], "order": _display_id(r["order_id"]),
        "courier": r["courier"], "awb": r["awb"], "boxes": r["boxes"],
        "weight_g": r["weight_g"], "note": r["note"], "actor": r["actor_name"],
        "created": r["created"], "invoice_no": r["invoice_no"],
        "to": r["ship_name"], "city": r["ship_city"], "state": r["ship_state"],
        "pincode": r["ship_pincode"], "total": r["total_inr"],
    } for r in rows])


# ── Printable documents ──────────────────────────────────────────
# These return HTML, not JSON: they open in their own tab and print. Same
# session cookie, same permission decorator — a document is as sensitive as
# the order behind it.
def _html(markup):
    return Response(markup, mimetype="text/html; charset=utf-8",
                    headers={"Cache-Control": "no-store"})


@dispatch_bp.route("/invoice/<order_id>.html")
@require("dispatch")
def invoice_doc(order_id):
    from documents import invoice_html
    row, db = _order_or_404(order_id)
    if not row:
        return _html("<p>Order not found.</p>"), 404
    if row["invoice_no"]:
        # Reprint exactly what was issued — never rebuilt from today's rates
        # or today's company profile.
        doc = json.loads(row["invoice_json"] or "{}")
    else:
        _no, doc = _issue(db, row, _company(db))
        db.commit()
    return _html(invoice_html(doc))


@dispatch_bp.route("/label.html")
@require("dispatch")
def label_doc():
    """One or more labels in a single print job. Printing a stack of parcels
    one tab at a time is how AWBs get put on the wrong box.

    Two ways in. `orders=PL-1002,PL-1003` takes each order's latest shipment
    and is what the Dispatch button uses, since the parcel was created a
    moment ago. `ships=4,7` names exact shipment rows and is what the reprint
    list uses — an order that went out twice has two AWBs, and picking "the
    latest" there would print the wrong one on the older parcel.
    """
    from documents import label_html
    db = get_db()
    company = _company(db)
    ship_ids = [s.strip() for s in (request.args.get("ships") or "").split(",") if s.strip()]
    ids = [s.strip() for s in (request.args.get("orders") or "").split(",") if s.strip()]
    if not ids and not ship_ids:
        return _html("<p>No orders given.</p>"), 400
    seller = {"trade": company["trade_name"] or "", "name": company["legal_name"] or "",
              "address": company["address"] or "", "city": company["city"] or "",
              "state": company["state"] or "", "pincode": company["pincode"] or "",
              "phone": company["phone"] or ""}
    # (order_row, shipment_row_or_None) pairs, in the order asked for.
    parcels = []
    for sid in ship_ids[:60]:
        try:
            sh = db.execute("SELECT * FROM shipments WHERE id=?", (int(sid),)).fetchone()
        except ValueError:
            continue
        if not sh:
            continue
        row = db.execute(
            """SELECT orders.*, users.name AS customer_name, users.email AS customer_email
               FROM orders JOIN users ON users.id=orders.user_id WHERE orders.id=?""",
            (sh["order_id"],)).fetchone()
        if row:
            parcels.append((row, sh))
    for oid in ids[:60]:
        row, _db = _order_or_404(oid)
        if not row:
            continue
        parcels.append((row, db.execute(
            """SELECT * FROM shipments WHERE order_id=?
               ORDER BY id DESC LIMIT 1""", (row["id"],)).fetchone()))

    labels = []
    for row, sh in parcels:
        ship = _shipping(row)
        labels.append({
            "order": _display_id(row["id"]), "seller": seller,
            "buyer": {"name": ship["name"] or row["customer_name"], "line1": ship["line1"],
                      "line2": ship["line2"], "city": ship["city"],
                      "state": ship["state"], "pincode": ship["pincode"],
                      "phone": ship["phone"]},
            "courier": sh["courier"] if sh else "", "awb": sh["awb"] if sh else "",
            "boxes": sh["boxes"] if sh else 1,
            "weight_g": sh["weight_g"] if sh else 0,
            "invoice_no": row["invoice_no"] or "",
            "date": (sh["created"] if sh else row["created"] or "")[:10],
        })
    if not labels:
        return _html("<p>None of those parcels resolved.</p>"), 404
    return _html(label_html(labels))


@dispatch_bp.route("/manifest.html")
@require("dispatch")
def manifest_doc():
    from documents import manifest_html
    db = get_db()
    day = (request.args.get("date") or "").strip()
    sql = """SELECT s.*, o.ship_name, o.ship_city, o.ship_state, o.ship_pincode,
                    o.invoice_no, o.id AS oid
             FROM shipments s JOIN orders o ON o.id=s.order_id"""
    args = ()
    if day:
        sql += " WHERE date(s.created)=date(?)"
        args = (day,)
    sql += " ORDER BY s.id"
    rows = [{"order": _display_id(r["oid"]), "invoice_no": r["invoice_no"],
             "awb": r["awb"], "courier": r["courier"], "to": r["ship_name"],
             "city": r["ship_city"], "state": r["ship_state"],
             "pincode": r["ship_pincode"], "boxes": r["boxes"],
             "weight_g": r["weight_g"]}
            for r in db.execute(sql, args).fetchall()]
    return _html(manifest_html(day, rows, _company(db)))


@dispatch_bp.route("/invoices")
@require("dispatch")
def invoices():
    db = get_db()
    rows = db.execute(
        """SELECT id,invoice_no,invoice_at,total_inr,ship_name,ship_state,cancelled
           FROM orders WHERE invoice_no IS NOT NULL
           ORDER BY invoice_at DESC, id DESC LIMIT 300""").fetchall()
    return jsonify(ok=True, invoices=[{
        "order": _display_id(r["id"]), "number": r["invoice_no"],
        "at": r["invoice_at"], "total": r["total_inr"], "to": r["ship_name"],
        "state": r["ship_state"], "cancelled": bool(r["cancelled"]),
    } for r in rows])
