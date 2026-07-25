# ── Delivery estimator ──────────────────────────────────────────
# HONEST LIMITATION: this is a static zone table, not a live courier quote.
# A real per-pincode estimate needs a Delhivery/Shiprocket account (paid,
# and outside this project's zero-extra-cost constraint). The numbers below
# are transit bands by postal zone, which is directionally right but will
# be wrong for remote pincodes inside an otherwise-fast zone.
#
# Swap-in point: if a courier account ever exists, replace estimate() with
# an API call and keep this as the fallback for when that API is down.
#
# India's first PIN digit is the postal zone. Printly ships from Pune, which
# is zone 4 — so bands radiate outward from there.
from flask import Blueprint, request, jsonify

shipping_bp = Blueprint("shipping", __name__, url_prefix="/api/shipping")

PRODUCTION_DAYS = 2  # the "printed & dispatched within 48 hours" promise

ZONES = {
    "4": ("Maharashtra, Goa, MP & Chhattisgarh", 1, 2),
    "3": ("Rajasthan, Gujarat & Daman", 2, 3),
    "5": ("Andhra Pradesh, Telangana & Karnataka", 2, 4),
    "6": ("Kerala, Tamil Nadu & Puducherry", 3, 5),
    "1": ("Delhi, Haryana, Punjab, HP & J&K", 3, 5),
    "2": ("Uttar Pradesh & Uttarakhand", 3, 5),
    "7": ("West Bengal, Odisha, Sikkim & North East", 4, 7),
    "8": ("Bihar & Jharkhand", 4, 6),
}


@shipping_bp.route("/estimate")
def estimate():
    pin = (request.args.get("pincode") or "").strip()
    if not (pin.isdigit() and len(pin) == 6):
        return jsonify(ok=False, error="Enter a valid 6-digit pincode."), 400

    first = pin[0]
    if first == "9":
        return jsonify(ok=False, error="Army Post Office pincodes need a manual quote — email hello@printly.in."), 400
    if first == "0" or first not in ZONES:
        return jsonify(ok=False, error="That doesn't look like an Indian pincode."), 400

    region, lo, hi = ZONES[first]
    return jsonify(
        ok=True,
        pincode=pin,
        region=region,
        min_days=PRODUCTION_DAYS + lo,
        max_days=PRODUCTION_DAYS + hi,
        note="Includes 48-hour production. Estimate only — not a courier-confirmed date.",
    )
