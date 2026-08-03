# ── Email bodies ─────────────────────────────────────────────────
#
# Hand-built HTML strings, same approach as documents.py and for the same
# reason: no template engine, no extra dependency, and full control over
# markup that has to survive email clients.
#
# Two constraints email imposes that a web page doesn't:
#   1. **Styles must be inline.** Gmail and Outlook strip <style> blocks, so
#      every rule lives on the element. That's why this file looks repetitive.
#   2. **Tables, not flexbox.** Outlook's renderer is Word's; grid and flex
#      collapse. Layout here stays deliberately primitive.
#
# Everything interpolated goes through e() — these bodies carry customer
# names, product names and ticket text, all user-supplied.
from html import escape as e

from documents import _rupees
from mailer import PUBLIC_BASE_URL

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


def _shell(title, body, preheader=""):
    """Outer chrome for every email: wordmark, white card, footer.

    `preheader` is the grey snippet a mail client shows next to the subject.
    Left unset it grabs whatever text comes first, which is usually the
    wordmark — so it's worth setting per email.
    """
    return """<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%(title)s</title></head>
<body style="margin:0;padding:0;background:%(page)s;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">%(pre)s</div>
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0"
       style="background:%(page)s;padding:24px 12px;">
 <tr><td align="center">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0"
         style="max-width:560px;">
   <tr><td style="padding:0 4px 16px;">
     <span style="font-family:Arial,Helvetica,sans-serif;font-weight:900;
                  font-size:20px;letter-spacing:-.5px;color:%(ink)s;">PRINT</span>
     <span style="font-family:Arial,Helvetica,sans-serif;font-weight:900;
                  font-size:20px;letter-spacing:-.5px;color:%(limeink)s;">&nbsp;ENGINE</span>
   </td></tr>
   <tr><td style="background:%(surface)s;border:1px solid %(border)s;
                  border-radius:12px;padding:28px 26px;
                  font-family:Arial,Helvetica,sans-serif;color:%(ink)s;
                  font-size:15px;line-height:1.55;">
%(body)s
   </td></tr>
   <tr><td style="padding:16px 4px 0;font-family:Arial,Helvetica,sans-serif;
                  font-size:12px;line-height:1.6;color:%(muted)s;">
     Print Engine — custom streetwear, printed in Pune, shipped all-India.<br>
     Questions? Just reply to this email.
   </td></tr>
  </table>
 </td></tr>
</table>
</body></html>""" % {
        "title": e(title), "pre": e(preheader), "body": body,
        "page": PAGE_BG, "surface": SURFACE, "border": BORDER,
        "ink": INK, "muted": MUTED, "limeink": LIME_INK,
    }


def _h1(text):
    return ('<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;'
            'font-weight:800;color:%s;">%s</h1>' % (INK, e(text)))


def _p(html):
    """Body paragraph. Takes HTML — callers escape their own values."""
    return ('<p style="margin:0 0 14px;font-size:15px;line-height:1.55;'
            'color:%s;">%s</p>' % (INK, html))


def _muted(html):
    return ('<p style="margin:0 0 12px;font-size:13px;line-height:1.5;'
            'color:%s;">%s</p>' % (MUTED, html))


def _button(label, url):
    """Bulletproof-ish CTA. A padded <a>, not a styled <table> — simpler, and
    it degrades to a plain link everywhere that strips the background."""
    return ('<p style="margin:0 0 18px;"><a href="%s" '
            'style="display:inline-block;background:%s;color:%s;'
            'text-decoration:none;font-weight:800;font-size:15px;'
            'padding:12px 22px;border-radius:999px;">%s</a></p>'
            % (e(url), LIME, INK, e(label)))


def _kv_table(rows):
    """Label/value rows — order id, courier, AWB and friends."""
    out = ['<table role="presentation" cellpadding="0" cellspacing="0" '
           'width="100%" style="margin:0 0 18px;font-size:14px;">']
    for k, v in rows:
        out.append(
            '<tr><td style="padding:6px 0;color:%s;width:44%%;">%s</td>'
            '<td style="padding:6px 0;color:%s;font-weight:700;">%s</td></tr>'
            % (MUTED, e(k), INK, e(str(v))))
    out.append("</table>")
    return "".join(out)


def _items_table(items):
    """Order lines. `sizes` is the per-size breakdown dict the cart sends."""
    out = ['<table role="presentation" cellpadding="0" cellspacing="0" '
           'width="100%" style="margin:0 0 18px;font-size:14px;'
           'border-top:1px solid ' + BORDER + ';">']
    for it in (items or []):
        if not isinstance(it, dict):
            continue
        sizes = it.get("sizes") or {}
        breakdown = " · ".join(
            "%s×%s" % (n, k) for k, n in sizes.items() if isinstance(n, int) and n > 0)
        qty = sum(n for n in sizes.values() if isinstance(n, int) and n > 0) \
            or (it.get("qty") or 0)
        out.append(
            '<tr><td style="padding:10px 0;border-bottom:1px solid %s;">'
            '<b>%s</b><br><span style="color:%s;font-size:13px;">%s</span></td>'
            '<td style="padding:10px 0;border-bottom:1px solid %s;'
            'text-align:right;white-space:nowrap;">%s pc</td></tr>'
            % (BORDER, e(str(it.get("name") or "Item")), MUTED,
               e(breakdown or "—"), BORDER, e(str(qty))))
    out.append("</table>")
    return "".join(out)


def _order_url(order_id):
    return "%s/?order=%s" % (PUBLIC_BASE_URL, order_id)


# ── Customer: orders ─────────────────────────────────────────────
def order_confirmed(name, order_id, items, total):
    body = (
        _h1("Order confirmed") +
        _p("Thanks%s — we've got your order and we're on it." %
           (", " + e(name.split()[0]) if name else "")) +
        _kv_table([("Order", order_id), ("Total", "₹" + _rupees(total))]) +
        _items_table(items) +
        _p("Your digital proof lands within 2 hours. Nothing goes to print "
           "until you approve it.") +
        _button("Track this order", _order_url(order_id))
    )
    return _shell("Order %s confirmed" % order_id, body,
                  "We've got your order — proof within 2 hours.")


def order_printing(name, order_id):
    body = (
        _h1("We're printing your order") +
        _p("Your proof is approved and %s is on the press now." % e(order_id)) +
        _p("Next stop is quality check, then dispatch. We'll email you the "
           "tracking details as soon as it leaves us.") +
        _button("Track this order", _order_url(order_id))
    )
    return _shell("Printing %s" % order_id, body, "On the press now.")


def order_shipped(name, order_id, courier, awb):
    rows = [("Order", order_id), ("Courier", courier or "—")]
    if awb:
        rows.append(("Tracking / AWB", awb))
    body = (
        _h1("Your order is on its way") +
        _p("%s has left our workshop in Pune." % e(order_id)) +
        _kv_table(rows) +
        _muted("Tracking can take a few hours to go live on the courier's "
               "site after dispatch.") +
        _button("Track this order", _order_url(order_id))
    )
    return _shell("%s shipped" % order_id, body, "Dispatched from Pune.")


def order_delivered(name, order_id):
    body = (
        _h1("Delivered") +
        _p("%s has been marked delivered. We hope it turned out exactly how "
           "you pictured it." % e(order_id)) +
        _p("If anything's not right, reply to this email within 7 days and "
           "we'll sort out a replacement.") +
        _button("Leave a review", _order_url(order_id))
    )
    return _shell("%s delivered" % order_id, body, "Hope you love it.")


def order_cancelled(name, order_id, note=""):
    body = (
        _h1("Order cancelled") +
        _p("%s has been cancelled." % e(order_id)) +
        (_muted("Reason: " + e(note)) if note else "") +
        _p("Any stock reserved for it has been released. If this wasn't "
           "expected, reply to this email and we'll look into it.")
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
        ('<div style="margin:0 0 18px;padding:14px 16px;background:%s;'
         'border-left:3px solid %s;border-radius:6px;font-size:14px;'
         'line-height:1.6;white-space:pre-wrap;">%s</div>'
         % (PAGE_BG, LIME, e(message or ""))) +
        _button("Open the conversation", "%s/?ticket=%s" % (PUBLIC_BASE_URL, ticket_id)) +
        _muted("You can reply from your account, or just reply to this email.")
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
               "sign in. Don't forward this email.")
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
               "If you weren't expecting this, tell the owner immediately.")
    )
    return _shell("Your Print Engine password was reset", body,
                  "A new temporary password.")
