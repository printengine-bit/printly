# ── Outbound transactional email (Resend) ───────────────────────
# Deliberately NOT named email.py: a module by that name in this directory
# would shadow Python's stdlib `email` package and break requests, which
# imports it. The bug is silent and horrible to trace.
#
# The one rule everything here is built around: **email is never
# load-bearing**. Every caller sends after its own db.commit(), and send()
# cannot raise. An order, a shipment or a ticket reply that succeeded must
# not be undone — or even reported as failed — because a mail API had a bad
# minute. Failures land in email_log instead, where the admin panel can
# show them.
import os

import requests

from db import get_db

# `or`, not .get()'s default arg — a present-but-blank env var (an empty
# field on a hosting dashboard still submits as "") has to fall back too.
# Same convention as DB_PATH in db.py and PROVIDER in printly_backend.py.
RESEND_API_KEY = os.environ.get("RESEND_API_KEY") or ""
MAIL_DOMAIN    = os.environ.get("MAIL_DOMAIN") or "printengine.in"
# Replies go somewhere a human reads. hello@printengine.in is printed on the
# site but has no mailbox behind it yet, so point replies at the Gmail until
# it does — a Reply-To that bounces is worse than an unbranded one.
MAIL_REPLY_TO  = os.environ.get("MAIL_REPLY_TO") or "printengine.in@gmail.com"
# Emails need absolute URLs; the frontend only ever builds relative ones.
PUBLIC_BASE_URL = (os.environ.get("PUBLIC_BASE_URL") or "https://printengine.in").rstrip("/")

API_URL = "https://api.resend.com/emails"

# One verified domain covers every address on it, so these cost no extra DNS.
SENDERS = {
    "hello":   "Print Engine <hello@%s>"   % MAIL_DOMAIN,
    "orders":  "Print Engine <orders@%s>"  % MAIL_DOMAIN,
    "support": "Print Engine <support@%s>" % MAIL_DOMAIN,
}

# Sends are synchronous and hold a gunicorn worker while they run — there is
# no queue or background worker in this project. Bound the damage: because
# the send is always post-commit, the worst case is a slow response, never a
# lost order.
TIMEOUT_SECONDS = 8

# No key configured ⇒ skip, don't attempt. Mirrors how generate() skips an
# image provider with no credential, and keeps local dev working untouched.
EMAIL_ENABLED = bool(RESEND_API_KEY)


def _log(db, to_email, sender, subject, kind, entity_type, entity_id,
         status, provider_id="", error=""):
    """Record the attempt. Commits on its own: the caller already committed
    its real work, and this row must not ride on a transaction that might
    still be rolled back for unrelated reasons."""
    try:
        db.execute(
            """INSERT INTO email_log(to_email,sender,subject,kind,entity_type,
                                     entity_id,status,provider_id,error)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (to_email or "", sender, (subject or "")[:200], kind,
             entity_type, entity_id, status, provider_id, (error or "")[:500]))
        db.commit()
    except Exception as e:                       # noqa: BLE001 — see module docstring
        print("⚠️ email_log write failed: %s" % e)


def send(to, subject, html, sender="orders", kind="",
         entity_type="", entity_id=None):
    """Send one email. Returns True if the provider accepted it.

    Never raises — a caller that lets this bubble up would make email
    load-bearing, which is exactly what this module exists to prevent.
    """
    from_addr = SENDERS.get(sender) or SENDERS["orders"]
    db = get_db()

    if not to:
        _log(db, to, sender, subject, kind, entity_type, entity_id,
             "failed", error="No recipient address")
        return False

    if not EMAIL_ENABLED:
        _log(db, to, sender, subject, kind, entity_type, entity_id, "skipped",
             error="RESEND_API_KEY not set")
        return False

    try:
        r = requests.post(
            API_URL,
            headers={"Authorization": "Bearer %s" % RESEND_API_KEY,
                     "Content-Type": "application/json"},
            json={"from": from_addr, "to": [to], "subject": subject,
                  "html": html, "reply_to": MAIL_REPLY_TO},
            timeout=TIMEOUT_SECONDS,
        )
        r.raise_for_status()
        provider_id = ""
        try:
            provider_id = (r.json() or {}).get("id") or ""
        except ValueError:
            pass                                  # accepted but not JSON — still sent
        _log(db, to, sender, subject, kind, entity_type, entity_id,
             "sent", provider_id=provider_id)
        return True
    except Exception as e:                        # noqa: BLE001 — never propagate
        # Resend puts the useful part in the body, not the status line.
        detail = str(e)
        resp = getattr(e, "response", None)
        if resp is not None:
            detail = "%s — %s" % (detail, (resp.text or "")[:200])
        print("⚠️ email send failed (%s → %s): %s" % (kind or "?", to, detail))
        _log(db, to, sender, subject, kind, entity_type, entity_id,
             "failed", error=detail)
        return False
