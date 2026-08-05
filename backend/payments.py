# ── Payments: Razorpay ───────────────────────────────────────────
#
# Razorpay's API is REST + HTTP basic auth + one HMAC, so it's wrapped with
# `requests` here rather than pulling in their SDK — the same call the
# project made for Resend in mailer.py, and for the same reason: a
# dependency that saves twenty lines isn't worth the supply chain.
#
# The shape of this module is dictated by one fact: **payment confirmation
# arrives twice.** Once through the customer's browser when Checkout
# succeeds, and once server-to-server as a webhook that may land seconds or
# minutes later — after the tab is closed, after the phone died, out of
# order, and retried by Razorpay if we don't answer 200. Everything below
# is built so that whichever arrives first wins and the rest are harmless.
#
# Money rules, all of them non-negotiable:
#   1. The amount comes from quote(), never from the request. The browser
#      never gets to say what something costs.
#   2. Nothing is trusted without a signature check, using compare_digest —
#      a plain `==` on an HMAC leaks its answer through timing.
#   3. Confirmation is idempotent, guarded on orders.paid_at inside the
#      same transaction that moves stock and points. A replayed webhook
#      must not decrement stock twice.
import hashlib
import hmac
import json
import os

import requests
from flask import Blueprint, request, jsonify, session

from auth import login_required
from db import get_db

payments_bp = Blueprint("payments", __name__, url_prefix="/api/payments")

# `or`, not .get()'s default — a present-but-blank env var (an empty field
# on a hosting dashboard) has to fall back too. Same convention as db.py.
RAZORPAY_KEY_ID     = os.environ.get("RAZORPAY_KEY_ID") or ""
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET") or ""
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET") or ""

API_ORDERS = "https://api.razorpay.com/v1/orders"
TIMEOUT_SECONDS = 15

# No keys ⇒ payments are off and the shop behaves exactly as it did before
# they existed: orders are placed and go straight to production. Mirrors
# EMAIL_ENABLED in mailer.py — a missing credential disables a feature, it
# never breaks the app.
PAYMENTS_ENABLED = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)

PENDING = "pending"
PAID = "paid"
FAILED = "failed"


def create_rzp_order(amount_inr, receipt, notes=None):
    """Create the Razorpay order the browser will pay against.

    `amount_inr` must come from quote(). Razorpay works in paise, so this
    is the one place rupees become integers — round once, here, rather than
    letting float drift produce a 1-paise mismatch against the invoice.

    Returns (order_dict, error_string).
    """
    if not PAYMENTS_ENABLED:
        return None, "Payments are not configured."
    paise = int(round(float(amount_inr) * 100))
    if paise < 100:
        return None, "Order value is below the minimum Razorpay accepts."
    try:
        r = requests.post(
            API_ORDERS,
            auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
            json={"amount": paise, "currency": "INR", "receipt": str(receipt),
                  "notes": notes or {}, "payment_capture": 1},
            timeout=TIMEOUT_SECONDS,
        )
        r.raise_for_status()
        return r.json(), None
    except Exception as exc:                       # noqa: BLE001
        detail = str(exc)
        resp = getattr(exc, "response", None)
        if resp is not None:
            detail = "%s — %s" % (detail, (resp.text or "")[:200])
        print("⚠️ Razorpay order create failed: %s" % detail)
        return None, "Could not reach the payment provider. Try again."


def _valid_payment_signature(rzp_order_id, rzp_payment_id, signature):
    """Browser-callback signature: HMAC(order_id|payment_id, key_secret)."""
    if not (rzp_order_id and rzp_payment_id and signature):
        return False
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        ("%s|%s" % (rzp_order_id, rzp_payment_id)).encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _valid_webhook_signature(raw_body, signature):
    """Webhook signature: HMAC over the EXACT bytes received.

    Must be the raw body, never a re-serialised dict — json.dumps would
    reorder keys and change whitespace, and the digest would never match.
    """
    if not (RAZORPAY_WEBHOOK_SECRET and signature and raw_body):
        return False
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(),
                        raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def confirm_payment(db, row, rzp_payment_id):
    """Turn a pending order into a real one. Returns True if it did work.

    **Idempotent.** Guarded on orders.paid_at, checked and written inside
    the same transaction as the stock and points movements — the same shape
    as dispatch._issue() guarding on invoice_no. SQLite serialises writers,
    so a webhook retry racing the browser callback cannot both pass the
    guard. Without this, a replayed webhook would decrement stock and award
    loyalty points a second time.

    Does everything create_order() used to do inline, because until money
    arrived none of it should have happened: stock off the shelf, promo code
    burned, points awarded.
    """
    if row["paid_at"]:
        return False                               # already confirmed

    from orders import _log_event, _display_id
    from catalog import apply_stock

    order_id = row["id"]
    items = json.loads(row["items_json"] or "[]")
    quote = json.loads(row["tax_json"] or "{}")

    db.execute(
        """UPDATE orders SET payment_status=?, rzp_payment_id=?,
                             paid_at=CURRENT_TIMESTAMP, updated=CURRENT_TIMESTAMP
           WHERE id=?""",
        (PAID, rzp_payment_id or "", order_id))

    if row["promo_code"]:
        from promo import redeem_promo
        redeem_promo(db, row["promo_code"], row["user_id"], order_id,
                     row["discount_inr"])

    _log_event(db, order_id, "paid", None, None,
               note="Payment %s" % (rzp_payment_id or "—"))

    # Blanks leave the shelf now rather than at checkout, because until this
    # moment the order might never have been paid for. Never blocks; see
    # apply_stock() for why.
    missing = apply_stock(db, items, order_id, -1, "order")
    if missing:
        _log_event(db, order_id, "note",
                   note="No stock record for: " + ", ".join(missing[:6]))

    # Same placeholder rule as before — 1 point per ₹100, no redemption path
    # agreed yet. Through award_points() so the ledger and the balance move
    # together.
    points = int(float(row["total_inr"]) // 100)
    if points:
        from customers import award_points
        award_points(db, row["user_id"], points, "Earned on order",
                     order_id=order_id)

    db.commit()

    # Post-commit, and non-raising by construction. The money is in; a mail
    # outage must not surface as a failed payment.
    who = db.execute("SELECT email,name FROM users WHERE id=?",
                     (row["user_id"],)).fetchone()
    if who and who["email"]:
        from mailer import send
        from mail_templates import order_confirmed
        display = _display_id(order_id)
        send(who["email"], "Order %s confirmed" % display,
             order_confirmed(who["name"], display, items, quote=quote,
                             shipping={
                                 "name": row["ship_name"], "phone": row["ship_phone"],
                                 "line1": row["ship_line1"], "line2": row["ship_line2"],
                                 "city": row["ship_city"], "state": row["ship_state"],
                                 "pincode": row["ship_pincode"]},
                             placed=row["created"]),
             sender="orders", kind="order_confirmed",
             entity_type="order", entity_id=order_id)
    return True


@payments_bp.route("/verify", methods=["POST"])
@login_required
def verify_payment():
    """Browser callback. Gives the customer an immediate answer.

    Not the authority — the webhook is, because it arrives whether or not
    the browser survives. This exists so the customer isn't left staring at
    a spinner while waiting for a server-to-server call they can't see.
    """
    d = request.get_json(force=True, silent=True) or {}
    rzp_order_id = (d.get("razorpay_order_id") or "").strip()
    rzp_payment_id = (d.get("razorpay_payment_id") or "").strip()
    signature = (d.get("razorpay_signature") or "").strip()

    if not _valid_payment_signature(rzp_order_id, rzp_payment_id, signature):
        return jsonify(ok=False, error="That payment could not be verified."), 400

    db = get_db()
    row = db.execute(
        "SELECT * FROM orders WHERE rzp_order_id=? AND user_id=?",
        (rzp_order_id, session["user_id"])).fetchone()
    if not row:
        return jsonify(ok=False, error="Order not found."), 404

    confirm_payment(db, row, rzp_payment_id)
    from orders import _display_id
    return jsonify(ok=True, order=_display_id(row["id"]))


@payments_bp.route("/webhook", methods=["POST"])
def razorpay_webhook():
    """Razorpay → us, server to server. **Deliberately unauthenticated.**

    There is no session here and there never can be: the caller is
    Razorpay, not a browser. The signature over the raw body IS the
    authentication, which is why the body is read as bytes and the digest
    compared with compare_digest.

    Always answers 200 once the signature checks out, including for events
    we ignore — a non-2xx makes Razorpay retry, and retrying something we
    deliberately skipped achieves nothing.
    """
    raw = request.get_data()
    signature = request.headers.get("X-Razorpay-Signature", "")
    if not _valid_webhook_signature(raw, signature):
        # Deliberately terse: an attacker probing this shouldn't learn
        # whether the secret is unset or the digest merely wrong.
        return jsonify(ok=False, error="Invalid signature."), 400

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:                              # noqa: BLE001
        return jsonify(ok=False, error="Malformed payload."), 400

    event = payload.get("event") or ""
    entity = (((payload.get("payload") or {}).get("payment") or {})
              .get("entity") or {})
    rzp_order_id = entity.get("order_id") or ""
    rzp_payment_id = entity.get("id") or ""

    if not rzp_order_id:
        return jsonify(ok=True, ignored="no order id")

    db = get_db()
    row = db.execute("SELECT * FROM orders WHERE rzp_order_id=?",
                     (rzp_order_id,)).fetchone()
    if not row:
        # Not ours, or created against different keys. 200 so Razorpay
        # stops retrying something we can never resolve.
        return jsonify(ok=True, ignored="unknown order")

    if event in ("payment.captured", "order.paid"):
        confirm_payment(db, row, rzp_payment_id)
    elif event == "payment.failed":
        # Left pending rather than marked failed-and-forgotten: the customer
        # can retry against the same order, and a later success is still
        # welcome.
        if not row["paid_at"]:
            db.execute("UPDATE orders SET payment_status=? WHERE id=?",
                       (FAILED, row["id"]))
            db.commit()

    return jsonify(ok=True)
