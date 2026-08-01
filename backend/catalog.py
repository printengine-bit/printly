# ── Catalogue: products, pricing and stock ──────────────────────
# The storefront used to hold all of this in a JavaScript array. Now the
# database owns it, which is what makes three things possible: the shop can
# edit its own prices, stock can be tracked per colour and size, and — most
# importantly — the server can compute an order total instead of believing
# whatever the browser sends.
import json

from flask import Blueprint, request, jsonify, session

from db import get_db, ONE_SIZE_KEY, COLORS
from permissions import require, owner_required

catalog_bp = Blueprint("catalog", __name__, url_prefix="/api/admin/catalog")

STOCK_REASONS = ("purchase", "order", "cancel", "adjust", "damage", "stocktake")


# ── Read model ───────────────────────────────────────────────────
def _tiers_for(db, product_id):
    return [[r["min_qty"], r["unit_price"]] for r in db.execute(
        "SELECT min_qty,unit_price FROM price_tiers WHERE product_id=? ORDER BY min_qty",
        (product_id,))]


def _print_views_for(db, product_id):
    return [{
        "key": r["view_key"], "label": r["label"], "group": r["group_key"],
        "mock": r["mock_key"], "required": bool(r["required"]),
        "default": bool(r["default_enabled"]), "surcharge": r["surcharge"],
    } for r in db.execute(
        """SELECT * FROM product_print_views
           WHERE product_id=? AND active=1 ORDER BY sort,id""", (product_id,))]


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
            "audience": p["audience"],
            "category": p["category"],
            # A product's own size labels, when it doesn't use the shared
            # adult S..3XL scale (kids' age bands). None means "use the
            # shared list" — sizeKeys() in data.js falls back accordingly.
            "sizes": json.loads(p["size_labels_json"]) if p["size_labels_json"] else None,
            "print_views": _print_views_for(db, p["id"]),
        })
    rows = db.execute(
        "SELECT DISTINCT color_hex,color_name FROM variants WHERE active=1"
    ).fetchall()
    by_hex = {r["color_hex"].upper(): {
        "hex": r["color_hex"], "name": r["color_name"]} for r in rows}
    colors = [by_hex[h.upper()] for h, _, _ in COLORS if h.upper() in by_hex]
    known = {h.upper() for h, _, _ in COLORS}
    colors.extend(sorted(
        ({"hex": r["color_hex"], "name": r["color_name"]} for r in rows
         if r["color_hex"].upper() not in known),
        key=lambda c: c["name"]))
    # Only the shared adult scale belongs in this fallback list — a product
    # with its own size_labels_json (kids' age bands) is excluded, or every
    # product using the shared scale would show those alongside S..3XL.
    sizes = [r["size_label"] for r in db.execute(
        """SELECT DISTINCT v.size_label FROM variants v JOIN products p ON v.product_id=p.id
           WHERE v.size_label<>? AND (p.size_labels_json IS NULL OR p.size_labels_json='')""",
        (ONE_SIZE_KEY,))]
    # Keep the display order the size chart assumes, not alphabetical.
    order = ["S", "M", "L", "XL", "2XL", "3XL"]
    sizes.sort(key=lambda s: order.index(s) if s in order else 99)
    # Tax and shipping ride along with the catalogue so the storefront can
    # show a total without hardcoding rates that only the admin should set.
    # It is still only a preview: quote() recomputes every figure from these
    # same rows at checkout and a mismatch is refused.
    from content import zones_payload
    return {"products": products, "colors": colors, "sizes": sizes,
            "oneSizeKey": ONE_SIZE_KEY, "tax": tax_settings(db),
            # Print zones are admin-editable now. mockups.js merges these
            # over the defaults in mockup-data.js, so a corrected measurement
            # reaches the studio on the next load without a deploy.
            "zones": zones_payload(db)}


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


def print_view_price(db, product_id, requested, layer_keys=None):
    """Return (selected keys, grouped surcharge, error).

    Required locations are always included. Optional locations are validated
    against the product, and a commercial group is charged once even when it
    contains two canvases (left and right sleeve).
    """
    rows = db.execute(
        """SELECT * FROM product_print_views
           WHERE product_id=? AND active=1 ORDER BY sort,id""",
        (product_id,)).fetchall()
    by_key = {r["view_key"]: r for r in rows}
    if isinstance(requested, list):
        wanted = {str(k) for k in requested}
    else:
        # Backward compatibility for carts saved before print_views existed.
        wanted = {str(k) for k in (layer_keys or []) if k in by_key}
    wanted.update(r["view_key"] for r in rows if r["required"])
    unknown = sorted(k for k in wanted if k not in by_key)
    if unknown:
        return None, 0, "That print location is not available for this product."
    selected = [r["view_key"] for r in rows if r["view_key"] in wanted]
    groups = {}
    for key in selected:
        r = by_key[key]
        groups[r["group_key"]] = max(groups.get(r["group_key"], 0), r["surcharge"])
    return selected, round(sum(groups.values()), 2), None


def line_qty(item):
    sizes = item.get("sizes")
    if isinstance(sizes, dict) and sizes:
        return sum(int(n) for n in sizes.values() if isinstance(n, int) and n > 0)
    qty = item.get("qty")
    return qty if isinstance(qty, int) and qty > 0 else 0


def quote(db, items, promo_code=None, user_id=None):
    """Recompute an order from the database. Returns (quote, error).

    This is the authority on what an order costs. The browser's figure is
    only ever compared against it — never trusted — because the price
    tiers, GST rate and shipping rule are all admin-editable now, and a
    stale or hostile client would otherwise set its own price. A promo code
    is checked here too, for the same reason: the discount the customer sees
    has to be the discount that gets charged.
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
        selected, print_extra, view_error = print_view_price(
            db, p["id"], it.get("print_views"), (it.get("layers") or {}).keys())
        if view_error:
            return None, view_error
        base_unit = unit_price(db, p["id"], qty)
        unit = base_unit + print_extra
        total = round(unit * qty, 2)
        rate = gst_rate(tax, unit)
        subtotal += total
        gst += total * rate / 100.0
        lines.append({"pid": p["slug"], "product": p["name"], "qty": qty,
                      "base_unit": base_unit, "print_extra": print_extra,
                      "print_views": selected, "unit": unit, "total": total,
                      "gst_percent": rate})
    subtotal = round(subtotal, 2)
    # Rounded once at the end, not per line, so the figure matches what the
    # browser shows — it sums the same way.
    gst = round(gst)
    shipping = 0.0 if subtotal > tax["free_shipping_over"] else tax["shipping_flat"]

    discount = 0.0
    applied_code = None
    if promo_code:
        # A code submitted with the order has to actually work — if it's
        # expired, exhausted or invalid by the time checkout happens, that's
        # a hard error the same way a stale total is, not a silent full-price
        # charge the customer never agreed to.
        from promo import find_promo, apply_promo
        promo_row = find_promo(db, promo_code)
        if not promo_row:
            return None, "That code doesn't exist."
        discount, promo_error = apply_promo(db, promo_row, subtotal, user_id)
        if promo_error:
            return None, promo_error
        applied_code = promo_row["code"]

    # GST is charged on what each piece actually sells for, so a coupon
    # doesn't reopen which slab a line falls into — only the tax *amount* is
    # prorated down by the same fraction the discount takes off the
    # subtotal. Shipping's free-delivery threshold reads the undiscounted
    # subtotal (order size), so a coupon can't be used to dodge shipping.
    gst_after_discount = round(gst * (subtotal - discount) / subtotal, 2) if subtotal else 0.0
    return {"lines": lines, "subtotal": subtotal, "gst": gst_after_discount,
            "shipping": shipping, "discount": discount, "promo_code": applied_code,
            "total": round(subtotal - discount + gst_after_discount + shipping, 2), "tax": tax,
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
            "cost_price": p["cost_price"], "audience": p["audience"], "category": p["category"],
            "base_price": p["base_price"], "one_size": bool(p["one_size"]),
            "active": bool(p["active"]), "sort": p["sort"],
            "tiers": _tiers_for(db, p["id"]),
            "print_views": _print_views_for(db, p["id"]),
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
    # What the blank costs us. Feeds the stock valuation report, which reads
    # zero (and says so) until this is set.
    if isinstance(d.get("cost_price"), (int, float)) and d["cost_price"] >= 0:
        fields.append("cost_price=?")
        vals.append(float(d["cost_price"]))
    if d.get("active") is not None:
        fields.append("active=?")
        vals.append(1 if d["active"] else 0)
    if isinstance(d.get("sort"), int):
        fields.append("sort=?")
        vals.append(d["sort"])
    if "audience" in d:
        audience = str(d.get("audience") or "").strip().lower()
        if audience not in {"men", "women", "kids", "unisex"}:
            return jsonify(ok=False, error="Choose a valid storefront audience."), 400
        fields.append("audience=?")
        vals.append(audience)
    if "category" in d:
        category = str(d.get("category") or "").strip().lower()
        if category not in {"tees", "polos", "hoodies", "sweatshirts", "jerseys", "bags"}:
            return jsonify(ok=False, error="Choose a valid product category."), 400
        fields.append("category=?")
        vals.append(category)
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

    views = d.get("print_views")
    if isinstance(views, list):
        import re
        clean_views, seen = [], set()
        for i, v in enumerate(views):
            if not isinstance(v, dict):
                return jsonify(ok=False, error="Every print view needs its settings."), 400
            key = str(v.get("key") or "").strip().lower()
            label = str(v.get("label") or "").strip()[:40]
            group = str(v.get("group") or key).strip().lower()
            mock = str(v.get("mock") or "").strip()[:80]
            fee = v.get("surcharge", 0)
            if (not re.match(r"^[a-z0-9_]+$", key) or key in seen or not label
                    or not re.match(r"^[a-z0-9_]+$", group) or not mock
                    or not isinstance(fee, (int, float)) or fee < 0):
                return jsonify(ok=False, error="Check the print view keys, labels, mockups and fees."), 400
            seen.add(key)
            clean_views.append((key, label, group, mock, 1 if v.get("required") else 0,
                                1 if v.get("default") else 0, float(fee), i))
        if not clean_views or not any(v[4] for v in clean_views):
            return jsonify(ok=False, error="A product needs at least one required print view."), 400
        db.execute("DELETE FROM product_print_views WHERE product_id=?", (pid,))
        db.executemany(
            """INSERT INTO product_print_views(
                   product_id,view_key,label,group_key,mock_key,required,
                   default_enabled,surcharge,sort)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            [(pid,) + v for v in clean_views])

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
    # A product with its own size labels (kids' age bands) orders columns by
    # that list; everything else keeps the shared adult S..3XL order.
    own_sizes = json.loads(p["size_labels_json"]) if p["size_labels_json"] else None
    order = own_sizes or ["S", "M", "L", "XL", "2XL", "3XL", ONE_SIZE_KEY]
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
