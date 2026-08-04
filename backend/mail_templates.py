# ── Email bodies ─────────────────────────────────────────────────
#
# Hand-built HTML strings, same approach as documents.py and for the same
# reason: no template engine, no extra dependency, and full control over
# markup that has to survive email clients.
#
# Three constraints email imposes that a web page doesn't:
#
#   1. **Inline styles are the base layer.** Some clients strip <style>
#      blocks, so every rule that matters is on the element. The <style>
#      block exists only for things inline CSS cannot express — media
#      queries — and nothing depends on it rendering.
#
#   2. **Tables, not flexbox.** Outlook's renderer is Word's; grid and flex
#      collapse. Layout here stays deliberately primitive.
#
#   3. **Dark mode will rewrite your colours unless you stop it.** Gmail and
#      Outlook.com forcibly invert light emails, which turns a lime button
#      with dark text into a muddy dark button, and can drop contrast below
#      readable. `color-scheme: light` tells well-behaved clients not to;
#      the `[data-ogsc]` selectors catch Outlook.com, which ignores that and
#      rewrites inline colours instead. Both are needed — neither is enough.
#
# Everything interpolated goes through e() — these bodies carry customer
# names, product names, addresses and ticket text, all user-supplied.
from html import escape as e

from documents import _rupees
from mailer import PUBLIC_BASE_URL, MAIL_REPLY_TO

# Brand tokens, hardcoded rather than read from the stylesheet: an email is
# rendered by someone else's client, which has no access to our CSS
# variables and no theme to follow. These are the light-surface values.
INK      = "#191a14"
MUTED    = "#5c5f52"
LIME     = "#c8f232"
LIME_INK = "#4a6600"
BORDER   = "#e2e5d8"
SURFACE  = "#ffffff"
PAGE_BG  = "#f4f5ef"

# Dark-mode counterparts. Deliberately NOT a straight inversion: the lime
# fill stays exactly as it is because that's the brand, and its ink stays
# dark because dark-on-lime is the readable pairing in either mode.
D_INK     = "#e8e9e3"
D_MUTED   = "#a8ab9f"
D_BORDER  = "#33362c"
D_SURFACE = "#1c1e18"
D_PAGE    = "#121410"

_STYLE = """
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .em-page   { background:%(dpage)s !important; }
    .em-card   { background:%(dsurface)s !important; border-color:%(dborder)s !important; }
    .em-ink    { color:%(dink)s !important; }
    .em-muted  { color:%(dmuted)s !important; }
    .em-rule   { border-color:%(dborder)s !important; }
    .em-quote  { background:%(dpage)s !important; }
    .em-brand  { color:%(dink)s !important; }
  }
  /* Outlook.com ignores prefers-color-scheme and rewrites inline colours
     instead, tagging the body. These put them back. */
  [data-ogsc] .em-page  { background:%(dpage)s !important; }
  [data-ogsc] .em-card  { background:%(dsurface)s !important; }
  [data-ogsc] .em-ink   { color:%(dink)s !important; }
  [data-ogsc] .em-muted { color:%(dmuted)s !important; }
  [data-ogsc] .em-brand { color:%(dink)s !important; }
  @media (max-width:480px) {
    .em-card { padding:20px 18px !important; }
    .em-h1   { font-size:19px !important; }
  }
""" % {"dpage": D_PAGE, "dsurface": D_SURFACE, "dink": D_INK,
       "dmuted": D_MUTED, "dborder": D_BORDER}


def _shell(title, body, preheader=""):
    """Outer chrome for every email: wordmark, card, footer.

    `preheader` is the grey snippet a client shows next to the subject.
    Left unset it grabs whatever text comes first — usually the wordmark —
    so every caller sets one.
    """
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>%(title)s</title>
<style>%(style)s</style></head>
<body class="em-page" style="margin:0;padding:0;background:%(page)s;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">%(pre)s</div>
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"
       class="em-page" style="background:%(page)s;padding:24px 12px;">
 <tr><td align="center">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"
         style="max-width:560px;">
   <tr><td style="padding:0 4px 16px;">
     <span class="em-brand" style="font-family:Arial,Helvetica,sans-serif;font-weight:900;
                  font-size:20px;letter-spacing:-.5px;color:%(ink)s;">PRINT</span><span
           style="font-family:Arial,Helvetica,sans-serif;font-weight:900;
                  font-size:20px;letter-spacing:-.5px;color:%(limeink)s;">&nbsp;ENGINE</span>
   </td></tr>
   <tr><td class="em-card" style="background:%(surface)s;border:1px solid %(border)s;
                  border-radius:12px;padding:28px 26px;
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:15px;line-height:1.55;">
%(body)s
   </td></tr>
   <tr><td style="padding:18px 4px 0;font-family:Arial,Helvetica,sans-serif;
                  font-size:12px;line-height:1.7;">
     <p class="em-muted" style="margin:0 0 10px;color:%(muted)s;">
       <a href="%(base)s/" style="color:%(limeink)s;text-decoration:none;">Shop</a>
       &nbsp;·&nbsp;
       <a href="%(base)s/#orders" style="color:%(limeink)s;text-decoration:none;">My orders</a>
       &nbsp;·&nbsp;
       <a href="%(base)s/#shipping" style="color:%(limeink)s;text-decoration:none;">Shipping</a>
       &nbsp;·&nbsp;
       <a href="%(base)s/#returns" style="color:%(limeink)s;text-decoration:none;">Returns</a>
       &nbsp;·&nbsp;
       <a href="mailto:%(reply)s" style="color:%(limeink)s;text-decoration:none;">Contact</a>
     </p>
     <p class="em-muted" style="margin:0;color:%(muted)s;">
       <b>Print Engine</b> — custom streetwear, printed in Pune, shipped all-India.<br>
       Questions? Just reply to this email and a human will read it.
     </p>
   </td></tr>
  </table>
 </td></tr>
</table>
</body></html>""" % {
        "title": e(title), "pre": e(preheader), "body": body, "style": _STYLE,
        "page": PAGE_BG, "surface": SURFACE, "border": BORDER,
        "ink": INK, "muted": MUTED, "limeink": LIME_INK,
        "base": PUBLIC_BASE_URL, "reply": e(MAIL_REPLY_TO),
    }


def _h1(text):
    return ('<h1 class="em-h1 em-ink" style="margin:0 0 14px;font-size:21px;'
            'line-height:1.3;font-weight:800;color:%s;">%s</h1>' % (INK, e(text)))


def _p(html):
    """Body paragraph. Takes HTML — callers escape their own values."""
    return ('<p class="em-ink" style="margin:0 0 14px;font-size:15px;'
            'line-height:1.55;color:%s;">%s</p>' % (INK, html))


def _muted(html):
    return ('<p class="em-muted" style="margin:0 0 12px;font-size:13px;'
            'line-height:1.5;color:%s;">%s</p>' % (MUTED, html))


def _button(label, url):
    """Padded <a> rather than a styled table — simpler, and it degrades to a
    plain link anywhere the background is stripped."""
    return ('<p style="margin:0 0 18px;"><a href="%s" '
            'style="display:inline-block;background:%s;color:%s;'
            'text-decoration:none;font-weight:800;font-size:15px;'
            'padding:12px 22px;border-radius:999px;">%s</a></p>'
            % (e(url), LIME, INK, e(label)))


def _rule():
    return ('<div class="em-rule" style="border-top:1px solid %s;'
            'margin:18px 0;"></div>' % BORDER)


def _kv_table(rows):
    """Label/value rows — order id, courier, AWB and friends."""
    out = ['<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
           'width="100%" style="margin:0 0 18px;font-size:14px;">']
    for k, v in rows:
        out.append(
            '<tr><td class="em-muted" style="padding:6px 0;color:%s;width:44%%;">%s</td>'
            '<td class="em-ink" style="padding:6px 0;color:%s;font-weight:700;">%s</td></tr>'
            % (MUTED, e(k), INK, e(str(v))))
    out.append("</table>")
    return "".join(out)


def _address_block(ship):
    """Delivery address, so the email stands alone as a receipt. Skipped
    entirely rather than printed half-empty when nothing was captured."""
    if not ship:
        return ""
    parts = [ship.get("name"), ship.get("line1"), ship.get("line2")]
    city = " ".join(x for x in [ship.get("city"), ship.get("state")] if x)
    if city:
        parts.append(city)
    if ship.get("pincode"):
        parts.append("PIN " + str(ship["pincode"]))
    if ship.get("phone"):
        parts.append("Phone " + str(ship["phone"]))
    lines = [e(str(p)) for p in parts if p]
    if not lines:
        return ""
    return ('<p class="em-muted" style="margin:0 0 6px;font-size:12px;'
            'letter-spacing:.06em;text-transform:uppercase;color:%s;">Delivering to</p>'
            '<p class="em-ink" style="margin:0 0 18px;font-size:14px;line-height:1.6;'
            'color:%s;">%s</p>' % (MUTED, INK, "<br>".join(lines)))


def _items_table(items, lines=None):
    """Order lines with per-item pricing.

    `items` carries the size breakdown the cart captured; `lines` is the
    server's own quote (catalog.quote()), which is the authority on money.
    Falling back to items alone keeps this working for callers that have no
    quote to hand.
    """
    by_pid = {}
    for ln in (lines or []):
        if isinstance(ln, dict) and ln.get("pid"):
            by_pid[ln["pid"]] = ln

    out = ['<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
           'width="100%" style="margin:0 0 6px;font-size:14px;">']
    for it in (items or []):
        if not isinstance(it, dict):
            continue
        sizes = it.get("sizes") or {}
        breakdown = " · ".join(
            "%s×%s" % (n, k) for k, n in sizes.items()
            if isinstance(n, int) and n > 0)
        qty = sum(n for n in sizes.values() if isinstance(n, int) and n > 0) \
            or (it.get("qty") or 0)
        ln = by_pid.get(it.get("pid")) or {}
        unit = ln.get("unit")
        line_total = ln.get("total")
        meta = breakdown or "—"
        if unit:
            meta += "  ·  ₹%s each" % _rupees(unit)
        if it.get("plain_item"):
            meta += "  ·  no print"
        out.append(
            '<tr><td class="em-rule" style="padding:10px 0;border-bottom:1px solid %s;">'
            '<span class="em-ink" style="color:%s;font-weight:700;">%s</span><br>'
            '<span class="em-muted" style="color:%s;font-size:12px;">%s</span></td>'
            '<td class="em-rule" style="padding:10px 0;border-bottom:1px solid %s;'
            'text-align:right;white-space:nowrap;vertical-align:top;">'
            '<span class="em-ink" style="color:%s;font-weight:700;">%s</span><br>'
            '<span class="em-muted" style="color:%s;font-size:12px;">%s pc</span></td></tr>'
            % (BORDER, INK, e(str(it.get("name") or "Item")), MUTED, e(meta),
               BORDER, INK, ("₹" + _rupees(line_total)) if line_total else "",
               MUTED, e(str(qty))))
    out.append("</table>")
    return "".join(out)


def _totals_table(quote):
    """Subtotal → GST → shipping → total, straight off the server's quote.

    Never recomputed here. quote() is the only authority on what an order
    costs, and an email that disagrees with the invoice is worse than an
    email that omits the breakdown.
    """
    if not quote:
        return ""
    rows = []

    def money(label, val, bold=False, tone=INK):
        weight = "800" if bold else "400"
        size = "15px" if bold else "14px"
        rows.append(
            '<tr><td class="em-%s" style="padding:5px 0;color:%s;font-size:%s;'
            'font-weight:%s;">%s</td>'
            '<td class="em-%s" style="padding:5px 0;color:%s;font-size:%s;'
            'font-weight:%s;text-align:right;white-space:nowrap;">%s</td></tr>'
            % ("ink" if bold else "muted", tone, size, weight, e(label),
               "ink" if bold else "muted", tone, size, weight, val))

    if quote.get("subtotal"):
        money("Subtotal", "₹" + _rupees(quote["subtotal"]))
    if quote.get("discount"):
        label = "Discount"
        if quote.get("promo_code"):
            label += " (%s)" % quote["promo_code"]
        money(label, "−₹" + _rupees(quote["discount"]), tone=LIME_INK)
    if quote.get("gst"):
        rates = quote.get("gst_rates") or []
        label = "GST" + (" (%s%%)" % "/".join(str(int(r)) for r in rates) if rates else "")
        money(label, "₹" + _rupees(quote["gst"]))
    if quote.get("shipping") is not None:
        ship_val = quote["shipping"]
        money("Shipping", ("₹" + _rupees(ship_val)) if ship_val else "Free")
    money("Total paid", "₹" + _rupees(quote.get("total") or 0), bold=True)

    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            'width="100%" style="margin:8px 0 18px;">' + "".join(rows) + "</table>")


def _order_url(order_id):
    return "%s/?order=%s" % (PUBLIC_BASE_URL, order_id)


# ── Customer: orders ─────────────────────────────────────────────
def order_confirmed(name, order_id, items, quote=None, shipping=None, placed=None):
    total = (quote or {}).get("total") or 0
    body = (
        _h1("Order confirmed") +
        _p("Thanks%s — we've got your order and we're on it." %
           (", " + e(name.split()[0]) if name else "")) +
        _kv_table([("Order", order_id)] +
                  ([("Placed", placed)] if placed else []) +
                  [("Total", "₹" + _rupees(total))]) +
        _items_table(items, (quote or {}).get("lines")) +
        _totals_table(quote) +
        _rule() +
        _address_block(shipping) +
        _p("Your digital proof lands within 2 hours. <b>Nothing goes to print "
           "until you approve it</b>, so check it over properly.") +
        _button("Track this order", _order_url(order_id)) +
        _muted("Spotted a mistake in the address or sizes? Reply to this email "
               "straight away — we can still change it before printing starts.")
    )
    return _shell("Order %s confirmed" % order_id, body,
                  "We've got your order — proof within 2 hours.")


def order_printing(name, order_id):
    body = (
        _h1("We're printing your order") +
        _p("Your proof is approved and %s is on the press now." % e(order_id)) +
        _rule() +
        _p("<b>What happens next</b>") +
        _muted("1. Printing and curing — today<br>"
               "2. Quality check — every piece, by hand<br>"
               "3. Packed and handed to the courier, with tracking emailed to you") +
        _rule() +
        _p("Because it's on the press, the design and sizes are now locked. "
           "Anything else — address, phone number — can still be changed by "
           "replying to this email.") +
        _button("Track this order", _order_url(order_id))
    )
    return _shell("Printing %s" % order_id, body,
                  "On the press now — tracking follows once it ships.")


def order_shipped(name, order_id, courier, awb):
    rows = [("Order", order_id), ("Courier", courier or "—")]
    if awb:
        rows.append(("Tracking / AWB", awb))
    body = (
        _h1("Your order is on its way") +
        _p("%s has left our workshop in Pune." % e(order_id)) +
        _kv_table(rows) +
        _muted("Tracking usually goes live on the courier's own site a few "
               "hours after dispatch, so don't worry if that number isn't "
               "recognised straight away.") +
        _button("Track this order", _order_url(order_id))
    )
    return _shell("%s shipped" % order_id, body, "Dispatched from Pune.")


def order_delivered(name, order_id):
    body = (
        _h1("Delivered") +
        _p("%s has been marked delivered. We hope it turned out exactly how "
           "you pictured it." % e(order_id)) +
        _rule() +
        _p("<b>If something's not right</b>") +
        _muted("Reply to this email within 7 days with a photo and we'll sort "
               "out a replacement. Printing faults, wrong sizes and transit "
               "damage are all on us.") +
        _rule() +
        _p("If it did turn out well, a review genuinely helps a small shop "
           "more than you'd think.") +
        _button("Leave a review", _order_url(order_id))
    )
    return _shell("%s delivered" % order_id, body, "Hope you love it.")


def order_cancelled(name, order_id, note=""):
    body = (
        _h1("Order cancelled") +
        _p("%s has been cancelled." % e(order_id)) +
        (_muted("Reason given: " + e(note)) if note else "") +
        _p("Any stock reserved for it has been released, and nothing further "
           "will be printed or shipped.") +
        _muted("If this wasn't expected, reply to this email and we'll look "
               "into it right away.")
    )
    return _shell("%s cancelled" % order_id, body, "This order was cancelled.")


# ── Customer: account ────────────────────────────────────────────
def password_reset(name, reset_url, minutes=60):
    body = (
        _h1("Reset your password") +
        _p("Someone asked to reset the password on your Print Engine "
           "account. If that was you, pick a new one:") +
        _button("Set a new password", reset_url) +
        _muted("This link works once and expires in %d minutes." % minutes) +
        _muted("If you didn't ask for this, ignore this email — nothing has "
               "changed and your current password still works.")
    )
    return _shell("Reset your Print Engine password", body,
                  "A link to set a new password.")


# ── Customer: support ────────────────────────────────────────────
def ticket_reply(name, ticket_id, subject, message):
    body = (
        _h1("We've replied to your ticket") +
        _kv_table([("Ticket", "#%s" % ticket_id), ("Subject", subject or "—")]) +
        ('<div class="em-quote" style="margin:0 0 18px;padding:14px 16px;'
         'background:%s;border-left:3px solid %s;border-radius:6px;'
         'font-size:14px;line-height:1.6;white-space:pre-wrap;color:%s;" '
         'class="em-ink">%s</div>'
         % (PAGE_BG, LIME, INK, e(message or ""))) +
        _button("Open the conversation", "%s/?ticket=%s" % (PUBLIC_BASE_URL, ticket_id)) +
        _muted("You can reply from your account, or just reply to this email — "
               "both land in the same place.")
    )
    return _shell("Re: %s" % (subject or "your ticket"), body,
                  (message or "")[:90])


# ── Staff ────────────────────────────────────────────────────────
def staff_invite(name, email_addr, password, role):
    body = (
        _h1("Your Print Engine staff account") +
        _p("An account has been created for you on the Print Engine admin "
           "panel.") +
        _kv_table([("Email", email_addr), ("Role", role),
                   ("Temporary password", password)]) +
        _button("Sign in", "%s/admin" % PUBLIC_BASE_URL) +
        _muted("You'll be asked to replace this password the first time you "
               "sign in. Don't forward this email — it contains a working "
               "password until you change it.")
    )
    return _shell("Your Print Engine staff account", body,
                  "Sign-in details for the admin panel.")


def staff_password_reset(name, email_addr, password):
    body = (
        _h1("Your password was reset") +
        _p("An owner has reset the password on your Print Engine staff "
           "account.") +
        _kv_table([("Email", email_addr), ("Temporary password", password)]) +
        _button("Sign in", "%s/admin" % PUBLIC_BASE_URL) +
        _muted("You'll be asked to choose a new password when you sign in. "
               "If you weren't expecting this, tell the owner immediately — "
               "it may mean someone else has access to the panel.")
    )
    return _shell("Your Print Engine password was reset", body,
                  "A new temporary password.")
