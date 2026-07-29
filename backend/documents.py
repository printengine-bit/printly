# ── Printable documents: tax invoice, shipping label, manifest ──
#
# Standalone HTML, printed by the browser. No PDF library and no headless
# renderer: those cost memory this 1GB host doesn't have, and every OS
# already ships a competent print-to-PDF. Each page sets its own @page size,
# so the invoice comes out A4 and the label comes out 4x6 without anyone
# touching the print dialog.
#
# These pages are rendered server-side rather than in the admin app because
# a document is not an app screen — it opens in its own tab with no nav, no
# theme switcher and nothing that could reflow between preview and paper.
from html import escape as e


def _rupees(v):
    """Indian digit grouping: 1,23,456.00, not 123,456.00."""
    v = float(v or 0)
    neg = v < 0
    whole, frac = divmod(round(abs(v) * 100), 100)
    s = str(whole)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if neg else "") + s + ".%02d" % frac


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
         "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
         "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy",
         "Eighty", "Ninety"]


def _under_thousand(n):
    if n < 20:
        return _ONES[n]
    if n < 100:
        return (_TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else "")).strip()
    return (_ONES[n // 100] + " Hundred"
            + (" " + _under_thousand(n % 100) if n % 100 else ""))


def amount_in_words(v):
    """Indian scale — lakh and crore, not million. Invoices are expected to
    carry this, and getting the scale wrong is the kind of thing an auditor
    notices immediately."""
    n = int(round(float(v or 0)))
    if n == 0:
        return "Zero Rupees Only"
    parts = []
    for div, name in ((10 ** 7, "Crore"), (10 ** 5, "Lakh"), (1000, "Thousand")):
        if n >= div:
            parts.append(_under_thousand(n // div) + " " + name)
            n %= div
    if n:
        parts.append(_under_thousand(n))
    return " ".join(parts) + " Rupees Only"


BASE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font:12px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;background:#f4f4f2}
.sheet{background:#fff;margin:14px auto;padding:16mm 14mm;width:210mm;min-height:297mm;
  box-shadow:0 1px 6px rgba(0,0,0,.18)}
h1{font-size:19px;letter-spacing:.04em;text-transform:uppercase}
table{width:100%;border-collapse:collapse}
th,td{padding:6px 8px;text-align:left;vertical-align:top}
.grid th{background:#f2f2ee;font-size:10px;letter-spacing:.06em;text-transform:uppercase;
  border-bottom:1px solid #000}
.grid td{border-bottom:1px solid #ddd}
.num{text-align:right;font-variant-numeric:tabular-nums}
.muted{color:#666}
.tiny{font-size:10px}
.box{border:1px solid #bbb;padding:10px}
.row{display:flex;gap:10px}
.row>*{flex:1}
.head{display:flex;justify-content:space-between;gap:20px;
  border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:12px}
.totals{width:60mm;margin-left:auto;margin-top:10px}
.totals td{padding:4px 8px}
.totals tr.grand td{border-top:1px solid #000;font-weight:700;font-size:14px}
.warn{border:1px solid #b00;background:#fff3f3;color:#b00;padding:8px 10px;margin-bottom:12px;font-size:11px}
.sign{margin-top:26px;display:flex;justify-content:space-between;align-items:flex-end}
.sign div{text-align:center;font-size:11px}
.sign span{display:block;border-top:1px solid #888;padding-top:5px;margin-top:44px;min-width:52mm}
.noprint{text-align:center;margin:14px}
.noprint button{font:inherit;padding:9px 18px;cursor:pointer;border:1px solid #333;background:#fff;border-radius:5px}
@media print{
  @page{size:A4;margin:0}
  body{background:#fff}
  .sheet{margin:0;box-shadow:none;width:auto;min-height:0}
  .noprint{display:none}
}
"""


def _page(title, css, body, autoprint=True):
    return ("<!doctype html><html lang=en><head><meta charset=utf-8>"
            "<meta name=viewport content='width=device-width,initial-scale=1'>"
            "<title>%s</title><style>%s</style></head><body>%s"
            "<div class=noprint><button onclick='window.print()'>Print</button></div>"
            "%s</body></html>") % (
        e(title), css, body,
        "<script>addEventListener('load',()=>setTimeout(()=>window.print(),250))</script>"
        if autoprint else "")


# ── Tax invoice ──────────────────────────────────────────────────
def invoice_html(doc):
    s, b = doc["seller"], doc["buyer"]
    warn = ""
    if not s.get("gstin"):
        warn += ("<div class=warn><b>No GSTIN on the company profile.</b> "
                 "This cannot be issued as a tax invoice until one is on file.</div>")
    if not doc.get("split_known"):
        warn += ("<div class=warn><b>Tax split unverified.</b> The seller or buyer "
                 "state is missing, so CGST/SGST vs IGST could not be determined "
                 "from the place of supply.</div>")
    if doc.get("reconstructed"):
        warn += ("<div class=warn><b>Rebuilt from the order.</b> This order predates "
                 "stored tax breakdowns. The rates below are today's slabs applied to "
                 "the recorded line values, not necessarily what was charged at the "
                 "time — check it against the payment before filing.</div>")
    if doc.get("imbalance"):
        warn += ("<div class=warn><b>Figures do not reconcile.</b> Taxable value, tax "
                 "and shipping are %s short of the order total. Do not file this "
                 "until the difference is explained.</div>" % _rupees(abs(doc["imbalance"])))
    if any(not l.get("hsn") for l in doc["lines"]):
        warn += ("<div class=warn><b>Missing HSN code(s).</b> Set them per product "
                 "under Inventory before filing this.</div>")

    def line_row(i, l):
        rate = "" if l["rate"] is None else "%g%%" % l["rate"]
        tax = "" if l["tax"] is None else _rupees(l["tax"])
        sizes = l.get("sizes") or {}
        detail = " · ".join("%s x %s" % (n, k) for k, n in sizes.items() if n)
        return ("<tr><td class=num>%d</td><td>%s%s</td><td>%s</td>"
                "<td class=num>%s</td><td class=num>%s</td><td class=num>%s</td>"
                "<td class=num>%s</td><td class=num>%s</td></tr>") % (
            i, e(l["product"]),
            "<br><span class='tiny muted'>%s</span>" % e(detail) if detail else "",
            e(l["hsn"] or "—"), l["qty"], _rupees(l["unit"]),
            _rupees(l["amount"]), rate, tax)

    tax_rows = ""
    if doc["interstate"]:
        tax_rows = "<tr><td>IGST</td><td class=num>%s</td></tr>" % _rupees(doc["igst"])
    else:
        tax_rows = ("<tr><td>CGST</td><td class=num>%s</td></tr>"
                    "<tr><td>SGST</td><td class=num>%s</td></tr>") % (
            _rupees(doc["cgst"]), _rupees(doc["sgst"]))

    body = """<div class=sheet>
  %(warn)s
  <div class=head>
    <div>
      <h1>Tax Invoice</h1>
      <div class=tiny style="margin-top:4px">Original for recipient</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:16px;font-weight:700">%(trade)s</div>
      <div class=tiny>%(saddr)s</div>
      <div class=tiny>%(scity)s %(spin)s · %(sstate)s</div>
      <div class=tiny>%(sphone)s%(semail)s</div>
      <div class=tiny><b>GSTIN %(sgstin)s</b></div>
    </div>
  </div>

  <div class=row style="margin-bottom:12px">
    <div class=box>
      <div class="tiny muted">Billed &amp; shipped to</div>
      <div style="font-weight:700;margin-top:3px">%(bname)s</div>
      <div class=tiny>%(bline1)s%(bline2)s</div>
      <div class=tiny>%(bcity)s %(bpin)s · %(bstate)s</div>
      <div class=tiny>%(bphone)s</div>
    </div>
    <div class=box>
      <table class=tiny>
        <tr><td class=muted>Invoice no.</td><td style="font-weight:700">%(number)s</td></tr>
        <tr><td class=muted>Invoice date</td><td>%(date)s</td></tr>
        <tr><td class=muted>Order</td><td>%(order)s (%(odate)s)</td></tr>
        <tr><td class=muted>Place of supply</td><td>%(pos)s</td></tr>
        <tr><td class=muted>Supply type</td><td>%(supply)s</td></tr>
        <tr><td class=muted>Reverse charge</td><td>No</td></tr>
      </table>
    </div>
  </div>

  <table class=grid>
    <thead><tr><th>#</th><th>Description</th><th>HSN</th><th class=num>Qty</th>
      <th class=num>Rate</th><th class=num>Taxable</th><th class=num>GST</th>
      <th class=num>Tax</th></tr></thead>
    <tbody>%(rows)s</tbody>
  </table>

  <table class=totals>
    <tr><td>Taxable value</td><td class=num>%(taxable)s</td></tr>
    %(taxrows)s
    <tr><td>Shipping</td><td class=num>%(shipping)s</td></tr>
    <tr class=grand><td>Total</td><td class=num>%(total)s</td></tr>
  </table>

  <p class=tiny style="margin-top:10px"><b>Amount in words:</b> %(words)s</p>
  <p class="tiny muted" style="margin-top:8px">%(note)s</p>

  <div class=sign>
    <div class=tiny style="text-align:left;max-width:95mm">
      <b>Declaration</b><br>
      We declare that this invoice shows the actual price of the goods
      described and that all particulars are true and correct.
    </div>
    <div>For %(legal)s<span>Authorised signatory</span></div>
  </div>
</div>""" % {
        "warn": warn,
        "trade": e(s["trade"] or s["name"]), "legal": e(s["name"] or s["trade"]),
        "saddr": e(s["address"]), "scity": e(s["city"]), "spin": e(s["pincode"]),
        "sstate": e("%s-%s" % (s["state_code"], s["state"]) if s["state_code"] else s["state"]),
        "sphone": e(s["phone"]),
        "semail": (" · " + e(s["email"])) if s["email"] else "",
        "sgstin": e(s["gstin"] or "not on file"),
        "bname": e(b["name"]), "bline1": e(b["line1"]),
        "bline2": ("<br>" + e(b["line2"])) if b["line2"] else "",
        "bcity": e(b["city"]), "bpin": e(b["pincode"]), "bstate": e(b["state"]),
        "bphone": e(b["phone"]),
        "number": e(doc["number"]), "date": e(doc["date"]),
        "order": e(doc["order"]), "odate": e(doc["order_date"]),
        "pos": e(doc["place_of_supply"] or "—"),
        "supply": "Inter-state (IGST)" if doc["interstate"] else "Intra-state (CGST + SGST)",
        "rows": "".join(line_row(i + 1, l) for i, l in enumerate(doc["lines"])),
        "taxable": _rupees(doc["taxable"]), "taxrows": tax_rows,
        "shipping": _rupees(doc["shipping"]), "total": _rupees(doc["total"]),
        "words": e(amount_in_words(doc["total"])),
        "note": "Custom-printed to order. Goods once sold are not returnable "
                "unless the print is defective.",
    }
    return _page("Invoice %s" % doc["number"], BASE_CSS, body)


# ── Shipping label (4 x 6 in) ────────────────────────────────────
LABEL_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font:11px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#000;background:#f4f4f2}
.label{width:4in;height:6in;background:#fff;margin:14px auto;padding:8px;
  border:1px solid #000;display:flex;flex-direction:column;box-shadow:0 1px 6px rgba(0,0,0,.18)}
.lrow{display:flex;justify-content:space-between;align-items:flex-start;
  border-bottom:2px solid #000;padding-bottom:5px}
.brand{font-size:16px;font-weight:800;letter-spacing:.04em}
.cell{border-bottom:1px dashed #999;padding:6px 0}
.cap{font-size:8px;letter-spacing:.09em;text-transform:uppercase;color:#555}
.to{font-size:15px;font-weight:700;line-height:1.25}
.addr{font-size:12px;line-height:1.4}
.pin{font-size:19px;font-weight:800;letter-spacing:.06em}
.awb{font-size:17px;font-weight:800;letter-spacing:.05em;word-break:break-all}
.bars{display:flex;gap:1px;height:38px;margin-top:4px}
.bars i{display:block;background:#000}
.foot{margin-top:auto;display:flex;justify-content:space-between;
  border-top:2px solid #000;padding-top:5px;font-size:10px}
.noprint{text-align:center;margin:14px}
.noprint button{font:inherit;padding:9px 18px;cursor:pointer;border:1px solid #333;background:#fff;border-radius:5px}
@media print{
  @page{size:4in 6in;margin:0}
  body{background:#fff}
  .label{margin:0;border:none;box-shadow:none;page-break-after:always}
  .noprint{display:none}
}
"""


def _bars(text):
    """A visual code-ish stripe, NOT a scannable barcode.

    Deliberately not pretending otherwise: a real Code128 needs the courier's
    own check digits and quiet zones, and every Indian courier issues its own
    scannable label from its portal anyway. This is here so a human can eyeball
    that two parcels aren't carrying the same AWB.
    """
    out = []
    for i, ch in enumerate(str(text)[:24]):
        w = 1 + (ord(ch) + i) % 4
        out.append("<i style='width:%dpx'></i>" % w)
        out.append("<i style='width:%dpx;background:#fff'></i>" % (1 + (ord(ch) >> 2) % 3))
    return "".join(out)


def label_html(labels):
    cards = []
    for d in labels:
        s, b = d["seller"], d["buyer"]
        cards.append("""<div class=label>
  <div class=lrow>
    <div><div class=brand>%(brand)s</div><div class=cap>%(order)s</div></div>
    <div style="text-align:right"><div class=cap>Pieces</div>
      <div style="font-size:15px;font-weight:800">%(boxes)s</div></div>
  </div>
  <div class=cell>
    <div class=cap>Deliver to</div>
    <div class=to>%(bname)s</div>
    <div class=addr>%(bline1)s%(bline2)s<br>%(bcity)s, %(bstate)s</div>
    <div class=pin>%(bpin)s</div>
    <div class=addr>%(bphone)s</div>
  </div>
  <div class=cell>
    <div class=cap>%(courier)s · AWB</div>
    <div class=awb>%(awb)s</div>
    <div class=bars>%(bars)s</div>
  </div>
  <div class=cell>
    <div class=cap>Return to</div>
    <div class=addr>%(sname)s, %(saddr)s, %(scity)s %(spin)s, %(sstate)s · %(sphone)s</div>
  </div>
  <div class=foot>
    <span>%(weight)s</span><span>%(invoice)s</span><span>%(date)s</span>
  </div>
</div>""" % {
            "brand": e(s["trade"] or s["name"] or "Printly"),
            "order": e(d["order"]), "boxes": e(str(d.get("boxes") or 1)),
            "bname": e(b["name"]), "bline1": e(b["line1"]),
            "bline2": ("<br>" + e(b["line2"])) if b["line2"] else "",
            "bcity": e(b["city"]), "bstate": e(b["state"]), "bpin": e(b["pincode"]),
            "bphone": e(b["phone"]),
            "courier": e(d.get("courier") or "Courier"),
            "awb": e(d.get("awb") or "—"), "bars": _bars(d.get("awb") or d["order"]),
            "sname": e(s["trade"] or s["name"]), "saddr": e(s["address"]),
            "scity": e(s["city"]), "spin": e(s["pincode"]), "sstate": e(s["state"]),
            "sphone": e(s["phone"]),
            "weight": ("%.0f g" % d["weight_g"]) if d.get("weight_g") else "",
            "invoice": e(d.get("invoice_no") or ""), "date": e(d.get("date") or ""),
        })
    return _page("Shipping label", LABEL_CSS, "".join(cards))


# ── Courier manifest ─────────────────────────────────────────────
def manifest_html(day, rows, seller):
    body_rows = "".join(
        "<tr><td class=num>%d</td><td>%s</td><td>%s</td><td>%s</td>"
        "<td>%s<br><span class='tiny muted'>%s, %s %s</span></td>"
        "<td class=num>%s</td><td class=num>%s</td></tr>" % (
            i + 1, e(r["order"]), e(r["invoice_no"] or "—"), e(r["awb"]),
            e(r["to"] or ""), e(r["city"] or ""), e(r["state"] or ""), e(r["pincode"] or ""),
            r["boxes"], ("%d g" % r["weight_g"]) if r["weight_g"] else "—")
        for i, r in enumerate(rows))
    boxes = sum(int(r["boxes"] or 0) for r in rows)
    grams = sum(int(r["weight_g"] or 0) for r in rows)
    couriers = sorted({(r["courier"] or "").strip() for r in rows if r["courier"]})
    body = """<div class=sheet>
  <div class=head>
    <div><h1>Pickup manifest</h1>
      <div class=tiny style="margin-top:4px">%(day)s · %(couriers)s</div></div>
    <div style="text-align:right">
      <div style="font-size:16px;font-weight:700">%(trade)s</div>
      <div class=tiny>%(saddr)s, %(scity)s %(spin)s</div>
      <div class=tiny>%(sphone)s</div>
    </div>
  </div>
  <table class=grid>
    <thead><tr><th>#</th><th>Order</th><th>Invoice</th><th>AWB</th>
      <th>Consignee</th><th class=num>Boxes</th><th class=num>Weight</th></tr></thead>
    <tbody>%(rows)s</tbody>
  </table>
  <table class=totals>
    <tr><td>Consignments</td><td class=num>%(n)d</td></tr>
    <tr><td>Boxes</td><td class=num>%(boxes)d</td></tr>
    <tr class=grand><td>Weight</td><td class=num>%(kg).2f kg</td></tr>
  </table>
  <div class=sign>
    <div>Handed over by<span>&nbsp;</span></div>
    <div>Received by (courier)<span>Name, signature &amp; time</span></div>
  </div>
</div>""" % {
        "day": e(day or "All shipments"),
        "couriers": e(", ".join(couriers) or "no courier recorded"),
        "trade": e(seller["trade_name"] or seller["legal_name"] or "Printly"),
        "saddr": e(seller["address"] or ""), "scity": e(seller["city"] or ""),
        "spin": e(seller["pincode"] or ""), "sphone": e(seller["phone"] or ""),
        "rows": body_rows or "<tr><td colspan=7 class=muted>Nothing dispatched.</td></tr>",
        "n": len(rows), "boxes": boxes, "kg": grams / 1000.0,
    }
    return _page("Manifest %s" % (day or ""), BASE_CSS, body, autoprint=False)
