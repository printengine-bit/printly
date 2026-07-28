# ── Catalogue: products, pricing and stock ──────────────────────
# The storefront used to hold all of this in a JavaScript array. Now the
# database owns it, which is what makes three things possible: the shop can
# edit its own prices, stock can be tracked per colour and size, and — most
# importantly — the server can compute an order total instead of believing
# whatever the browser sends.
import json

from flask import Blueprint, request, jsonify, session

from db import get_db, ONE_SIZE_KEY
from permissions import require, owner_required

catalog_bp = Blueprint("catalog", __name__, url_prefix="/api/admin/catalog")

STOCK_REASONS = ("purchase", "order", "cancel", "adjust", "damage", "stocktake")


# ── Read model ───────────────────────────────────────────────────
def _tiers_for(db, product_id):
    return [[r["min_qty"], r["unit_price"]] for r in db.execute(
        "SELECT min_qty,unit_price FROM price_tiers WHERE product_id=? ORDER BY min_qty",
        (product_id,))]


def catalog_payload(db=None):
    """The catalogue in exactly the shape frontend/js/data.js used to
    declare by hand — same keys, same types — so every render function
    downstream keeps working untouched. Injected into index.html rather
    than fetched, because init.js builds the studio synchronously at boot
    and a fetch would mean making all of that async."""
    db = db or get_db()
    products = []
    for p in db.execute("SELECT * FROM products WHERE active=1 ORDER BY sort,id"):
        tiers = _tiers_for(db, p["id"])
        cheapest = min(tiers, key=lambda t: t[1]) if tiers else [1, p["base_price"]]
        products.append({
            "id": p["slug"],
            "name": p["name"],
            "emoji": p["emoji"],
            "base": p["base_price"],
            "tiers": tiers,
            "cost": "₹%s at %s+" % (int(cheapest[1]), cheapest[0]),
            "one_size": bool(p["one_size"]),
            "fabric": p["fabric"],
            "fit": p["fit_label"],
            "care": json.loads(p["care_json"] or "[]"),
            "chart": json.loads(p["size_chart_json"] or "{}"),
        })
    colors = [{"hex": r["color_hex"], "name": r["color_name"]} for r in db.execute(
        "SELECT DISTINCT color_hex,color_name FROM variants WHERE active=1 "
        "ORDER BY color_name")]
    sizes = [r["size_label"] for r in db.execute(
        "SELECT DISTINCT size_label FROM variants WHERE size_label<>? ", (ONE_SIZE_KEY,))]
    # Keep the display order the size chart assumes, not alphabetical.
    order = ["S", "M", "L", "XL", "2XL", "3XL"]
    sizes.sort(key=lambda s: order.index(s) if s in order else 99)
    # Tax and shipping ride along with the catalogue so the storefront can
    # show a total without hardcoding rates that only the admin should set.
    # It is still only a preview: quote() recomputes every figure from these
    # same rows at checkout and a mismatch is refused.
    return {"products": products, "colors": colors, "sizes": sizes,
            "oneSizeKey": ONE_SIZE_KEY, "tax": tax_settings(db)}


def tax_settings(db):
    r = db.execute("""SELECT gst_percent,gst_percent_high,gst_threshold,
                             shipping_flat,free_shipping_over
                      FROM company WHERE id=1""").fetchone()
    return {"gst_percent": r["gst_percent"],
            "gst_percent_high": r["gst_percent_high"],
            "gst_threshold": r["gst_threshold"],
            "shipping_flat": r["shipping_flat"],
            "free_shipping_over": r["free_shipping_over"]}


def gst_rate(tax, unit):
    """Which slab a single piece falls into.

    Apparel GST is charged per piece on its sale value, not on the order
    total — so a cart holding a Rs 599 tee and a Rs 1,299 hoodie carries
    both rates at once. The value that counts is what the piece actually
    sells for, which means the tier price: a hoodie discounted under the
    threshold at volume moves down a slab, and that is correct.
    """
    return tax["gst_percent_high"] if unit > tax["gst_threshold"] else tax["gst_percent"]


# ── Pricing ──────────────────────────────────────────────────────
def unit_price(db, product_id, qty):
    """Highest tier whose minimum the quantity reaches."""
    r = db.execute(
        """SELECT unit_price FROM price_tiers
           WHERE product_id=? AND min_qty<=? ORDER BY min_qty DESC LIMIT 1""",
        (product_id, max(1, qty))).fetchone()
    if r:
        return r["unit_price"]
    base = db.execute("SELECT base_price FROM products WHERE id=?",
                      (product_id,)).fetchone()
    return base["base_price"] if base else 0.0


def line_qty(item):
    sizes = item.get("sizes")
    if isinstance(sizes, dict) and sizes:
        return sum(int(n) for n in sizes.values() if isinstance(n, int) and n > 0)
    qty = item.get("qty")
    return qty if isinstance(qty, int) and qty > 0 else 0


def quote(db, items):
    """Recompute an order from the database. Returns (quote, error).

    This is the authority on what an order costs. The browser's figure is
    only ever compared against it — never trusted — because the price
    tiers, GST rate and shipping rule are all admin-editable now, and a
    stale or hostile client would otherwise set its own price.
    """
    if not isinstance(items, list) or not items:
        return None, "Cart is empty or invalid."
    tax = tax_settings(db)
    lines, subtotal, gst = [], 0.0, 0.0
    for it in items:
        if not isinstance(it, dict):
            return None, "Cart is empty or invalid."
        p = db.execute("SELECT * FROM products WHERE slug=? AND active=1",
                       (it.get("pid"),)).fetchone()
        if not p:
            return None, "%s is no longer available." % (it.get("product") or "That product")
        qty = line_qty(it)
        if qty < 1:
            return None, "Pick at least one size before ordering."
        unit = unit_price(db, p["id"], qty)
        total = round(unit * qty, 2)
        rate = gst_rate(tax, unit)
        subtotal += total
        gst += total * rate / 100.0
        lines.append({"pid": p["slug"], "product": p["name"], "qty": qty,
                      "unit": unit, "total": total, "gst_percent": rate})
    subtotal = round(subtotal, 2)
    # Rounded once at the end, not per line, so the figure matches what the
    # browser shows — it sums the same way.
    gst = round(gst)
    shipping = 0.0 if subtotal > tax["free_shipping_over"] else tax["shipping_flat"]
    return {"lines": lines, "subtotal": subtotal, "gst": gst, "shipping": shipping,
            "total": round(subtotal + gst + shipping, 2), "tax": tax,
            # The rates actually applied, so the cart can label the line
            # "GST 5%" or "GST 5% + 12%" instead of guessing.
            "gst_rates": sorted({l["gst_percent"] for l in lines})}, None


# ── Stock ────────────────────────────────────────────────────────
def apply_stock(db, items, order_row_id, sign, reason):
    """Move stock for every size in every line. `sign` is -1 when an order
    is placed and +1 when one is cancelled.

    Deliberately does NOT block an order that would go negative. Stock
    starts at zero on a fresh install because nobody has counted the blanks
    yet, so refusing to sell without stock would take the shop offline the
    moment this shipped. Negative stock is surfaced as an alert instead —
    a wrong count should be visible, not load-bearing.
    """
    missing = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        p = db.execute("SELECT id,one_size FROM products WHERE slug=?",
                       (it.get("pid"),)).fetchone()
        if not p:
            missing.append(str(it.get("pid")))
            continue
        hexv = (it.get("shirt") or "").upper()
        sizes = it.get("sizes")
        if not isinstance(sizes, dict) or not sizes:
            qty = line_qty(it)
            sizes = {ONE_SIZE_KEY if p["one_size"] else "M": qty} if qty else {}
        for label, n in sizes.items():
            if not isinstance(n, int) or n <= 0:
                continue
            v = db.execute(
                """SELECT id FROM variants
                   WHERE product_id=? AND UPPER(color_hex)=? AND size_label=?""",
                (p["id"], hexv, label)).fetchone()
            if not v:
                missing.append("%s/%s/%s" % (it.get("pid"), hexv, label))
                continue
            db.execute("UPDATE variants SET stock_qty=stock_qty+? WHERE id=?",
                       (sign * n, v["id"]))
            db.execute(
                """INSERT INTO stock_moves(variant_id,delta,reason,order_id,actor_id,note)
                   VALUES(?,?,?,?,?,?)""",
                (v["id"], sign * n, reason, order_row_id, session.get("user_id"), ""))
    return missing


# ── Admin: products ──────────────────────────────────────────────
def _product_public(db, p):
    stock = db.execute(
        """SELECT COALESCE(SUM(stock_qty),0) s, COUNT(*) n,
                  SUM(CASE WHEN stock_qty<=low_stock_at THEN 1 ELSE 0 END) low
           FROM variants WHERE product_id=?""", (p["id"],)).fetchone()
    return {"id": p["id"], "slug": p["slug"], "name": p["name"], "emoji": p["emoji"],
            "fabric": p["fabric"], "fit": p["fit_label"], "hsn_code": p["hsn_code"],
            "base_price": p["base_price"], "one_size": bool(p["one_size"]),
            "active": bool(p["active"]), "sort": p["sort"],
            "tiers": _tiers_for(db, p["id"]),
            "stock": stock["s"], "variants": stock["n"], "low": stock["low"]}


@catalog_bp.route("/products")
@require("inventory")
def list_products():
    db = get_db()
    rows = db.execute("SELECT * FROM products ORDER BY sort,id").fetchall()
    gstin = db.execute("SELECT gstin FROM company WHERE id=1").fetchone()["gstin"]
    return jsonify(ok=True, products=[_product_public(db, p) for p in rows],
                   tax=tax_settings(db),
                   # Whether charging tax here is legitimate depends on this,
                   # so the screen that sets the rates has to know it.
                   gst_registered=bool((gstin or "").strip()))


@catalog_bp.route("/products/<int:pid>", methods=["POST"])
@require("inventory")
def update_product(pid):
    from admin_api import log
    db = get_db()
    p = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if not p:
        return jsonify(ok=False, error="Product not found."), 404
    d = request.get_json(force=True, silent=True) or {}

    fields, vals = [], []
    for key, col in (("name", "name"), ("fabric", "fabric"), ("fit", "fit_label"),
                     ("hsn_code", "hsn_code"), ("emoji", "emoji")):
        if isinstance(d.get(key), str):
            fields.append(col + "=?")
            vals.append(d[key].strip()[:200])
    if isinstance(d.get("base_price"), (int, float)) and d["base_price"] >= 0:
        fields.append("base_price=?")
        vals.append(float(d["base_price"]))
    if d.get("active") is not None:
        fields.append("active=?")
        vals.append(1 if d["active"] else 0)
    if isinstance(d.get("sort"), int):
        fields.append("sort=?")
        vals.append(d["sort"])
    if fields:
        vals.append(pid)
        db.execute("UPDATE products SET %s, updated=CURRENT_TIMESTAMP WHERE id=?"
                   % ",".join(fields), vals)

    tiers = d.get("tiers")
    if isinstance(tiers, list):
        clean = []
        for t in tiers:
            if (not isinstance(t, list) or len(t) != 2
                    or not isinstance(t[0], int) or t[0] < 1
                    or not isinstance(t[1], (int, float)) or t[1] < 0):
                return jsonify(ok=False, error="Every tier needs a quantity and a price."), 400
            clean.append((t[0], float(t[1])))
        if not clean:
            return jsonify(ok=False, error="A product needs at least one price tier."), 400
        # A tier starting above 1 would leave single-unit orders unpriced.
        if min(c[0] for c in clean) != 1:
            return jsonify(ok=False, error="The first tier has to start at quantity 1."), 400
        db.execute("DELETE FROM price_tiers WHERE product_id=?", (pid,))
        for min_qty, price in sorted(set(clean)):
            db.execute("INSERT INTO price_tiers(product_id,min_qty,unit_price) VALUES(?,?,?)",
                       (pid, min_qty, price))

    log(db, "product", pid, "updated", note=p["slug"])
    db.commit()
    row = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    return jsonify(ok=True, product=_product_public(db, row))


# ── Admin: stock ─────────────────────────────────────────────────
@catalog_bp.route("/products/<int:pid>/stock")
@require("inventory")
def product_stock(pid):
    db = get_db()
    p = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if not p:
        return jsonify(ok=False, error="Product not found."), 404
    rows = db.execute(
        "SELECT * FROM variants WHERE product_id=? ORDER BY color_name,id", (pid,)
    ).fetchall()
    order = ["S", "M", "L", "XL", "2XL", "3XL", ONE_SIZE_KEY]
    sizes = sorted({r["size_label"] for r in rows},
                   key=lambda s: order.index(s) if s in order else 99)
    return jsonify(ok=True, product={"id": p["id"], "slug": p["slug"], "name": p["name"]},
                   sizes=sizes,
                   variants=[{"id": r["id"], "color_hex": r["color_hex"],
                              "color_name": r["color_name"], "size": r["size_label"],
                              "sku": r["sku"], "stock": r["stock_qty"],
                              "low_at": r["low_stock_at"]} for r in rows])


@catalog_bp.route("/stock", methods=["POST"])
@require("inventory")
def adjust_stock():
    """Either `delta` (received 20 more) or `set` (a stocktake said 14).
    Both land in the ledger — `set` is stored as the delta it implies, so
    the running total always reconciles against the movement history."""
    from admin_api import log
    d = request.get_json(force=True, silent=True) or {}
    vid = d.get("variant_id")
    reason = d.get("reason") if d.get("reason") in STOCK_REASONS else "adjust"
    note = (d.get("note") or "")[:200] if isinstance(d.get("note"), str) else ""
    db = get_db()
    v = db.execute("SELECT * FROM variants WHERE id=?", (vid,)).fetchone()
    if not v:
        return jsonify(ok=False, error="Variant not found."), 404

    if isinstance(d.get("set"), int):
        delta = d["set"] - v["stock_qty"]
    elif isinstance(d.get("delta"), int):
        delta = d["delta"]
    else:
        return jsonify(ok=False, error="Give a new count or a change."), 400
    if delta == 0:
        return jsonify(ok=True, variant={"id": v["id"], "stock": v["stock_qty"]})

    db.execute("UPDATE variants SET stock_qty=stock_qty+? WHERE id=?", (delta, vid))
    db.execute("""INSERT INTO stock_moves(variant_id,delta,reason,actor_id,note)
                  VALUES(?,?,?,?,?)""", (vid, delta, reason, session.get("user_id"), note))
    log(db, "stock", vid, reason, v["stock_qty"], v["stock_qty"] + delta, v["sku"])
    db.commit()
    row = db.execute("SELECT stock_qty FROM variants WHERE id=?", (vid,)).fetchone()
    return jsonify(ok=True, variant={"id": vid, "stock": row["stock_qty"]})


@catalog_bp.route("/moves")
@require("inventory")
def moves():
    rows = get_db().execute("""
        SELECT m.*, v.sku, v.color_name, v.size_label, p.name AS product, u.name AS actor
        FROM stock_moves m
        JOIN variants v ON v.id=m.variant_id
        JOIN products p ON p.id=v.product_id
        LEFT JOIN users u ON u.id=m.actor_id
        ORDER BY m.id DESC LIMIT 200""").fetchall()
    return jsonify(ok=True, moves=[{
        "id": r["id"], "sku": r["sku"], "product": r["product"],
        "color": r["color_name"], "size": r["size_label"], "delta": r["delta"],
        "reason": r["reason"], "order_id": r["order_id"], "note": r["note"],
        "actor": r["actor"], "created": r["created"]} for r in rows])


# "Low" has to mean "this ran down", not "this was never set up". On a fresh
# install every variant is at zero with a reorder point of 10, so a naive
# query returns the entire catalogue — 199 rows of noise that makes both this
# screen and the dashboard alert worthless. A variant with no movement
# history has never been counted in, which is a different problem, reported
# separately as a number rather than a list.
LOW_STOCK_SQL = """
    SELECT v.*, p.name AS product FROM variants v
    JOIN products p ON p.id=v.product_id
    WHERE v.active=1 AND v.stock_qty <= v.low_stock_at
      AND EXISTS (SELECT 1 FROM stock_moves m WHERE m.variant_id=v.id)
    ORDER BY v.stock_qty, p.sort"""


def low_stock_rows(db):
    return db.execute(LOW_STOCK_SQL).fetchall()


@catalog_bp.route("/low-stock")
@require("inventory")
def low_stock():
    db = get_db()
    rows = low_stock_rows(db)
    uncounted = db.execute("""
        SELECT COUNT(*) c FROM variants v WHERE v.active=1
        AND NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.variant_id=v.id)
    """).fetchone()["c"]
    return jsonify(ok=True, uncounted=uncounted, variants=[{
        "id": r["id"], "sku": r["sku"], "product": r["product"],
        "color": r["color_name"], "size": r["size_label"],
        "stock": r["stock_qty"], "low_at": r["low_stock_at"],
        "negative": r["stock_qty"] < 0} for r in rows])


# ── Admin: tax & shipping ────────────────────────────────────────
@catalog_bp.route("/tax", methods=["POST"])
@owner_required
def set_tax():
    from admin_api import log
    d = request.get_json(force=True, silent=True) or {}
    vals = {}
    for k, lo, hi in (("gst_percent", 0, 50), ("gst_percent_high", 0, 50),
                      ("gst_threshold", 0, 10 ** 6), ("shipping_flat", 0, 10000),
                      ("free_shipping_over", 0, 10 ** 7)):
        v = d.get(k)
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not lo <= v <= hi:
            return jsonify(ok=False, error="%s is out of range." % k.replace("_", " ")), 400
        vals[k] = float(v)
    if vals["gst_percent_high"] < vals["gst_percent"]:
        return jsonify(ok=False,
                       error="The above-threshold rate can't be lower than the one below it."), 400
    db = get_db()
    db.execute("""UPDATE company SET gst_percent=?, gst_percent_high=?, gst_threshold=?,
                  shipping_flat=?, free_shipping_over=?,
                  updated=CURRENT_TIMESTAMP WHERE id=1""",
               (vals["gst_percent"], vals["gst_percent_high"], vals["gst_threshold"],
                vals["shipping_flat"], vals["free_shipping_over"]))
    log(db, "company", 1, "tax_updated", note=json.dumps(vals))
    db.commit()
    return jsonify(ok=True, tax=tax_settings(db))
