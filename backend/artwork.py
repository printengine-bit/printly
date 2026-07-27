# ── Artwork blueprint: print-ready files for the production floor ──
# The cart only ever carried a small JPEG mockup thumbnail, which is a picture
# of a t-shirt — not something anyone can print from. This stores the real
# artwork (transparent PNG, print resolution, no garment behind it) as a file
# on disk and hands the order a URL to it.
#
# Files, not DB rows, because these are megabytes each: a base64 column would
# bloat every orders query, and Railway's volume is already the durable place
# the SQLite file lives.
import base64
import os
import re
import secrets

from flask import Blueprint, request, jsonify, send_from_directory

from auth import login_required
from permissions import require
from db import DB_PATH

artwork_bp = Blueprint("artwork", __name__, url_prefix="/api/artwork")

# Same `or` pattern as DB_PATH — a present-but-blank env var must fall back.
ART_DIR = os.environ.get("ART_DIR") or os.path.join(os.path.dirname(DB_PATH), "artwork")

# PNG for line art and text (lossless, and small at that kind of content) and
# WebP for photographic generations, where a lossless print file runs to
# ~9MB. Both carry alpha, which is non-negotiable: the background has been
# removed and must stay removed. See encodePrintArt() for which one wins.
PREFIXES = {
    "data:image/png;base64,": ("png", "image/png"),
    "data:image/webp;base64,": ("webp", "image/webp"),
}
MAX_ART_BYTES = 5 * 1024 * 1024
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}\.(png|webp)$")
MIME = {"png": "image/png", "webp": "image/webp"}


def _sniff(raw):
    """Real format from the magic number — never from the claimed prefix."""
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


@artwork_bp.route("", methods=["POST"])
@login_required
def upload_artwork():
    d = request.get_json(force=True, silent=True) or {}
    data = d.get("data")
    prefix = next((p for p in PREFIXES if isinstance(data, str) and data.startswith(p)), None)
    if not prefix:
        return jsonify(ok=False, error="Artwork must be a PNG or WebP."), 400
    try:
        raw = base64.b64decode(data[len(prefix):], validate=True)
    except Exception:
        return jsonify(ok=False, error="Artwork could not be read."), 400
    if not raw:
        return jsonify(ok=False, error="Artwork could not be read."), 400
    if len(raw) > MAX_ART_BYTES:
        return jsonify(
            ok=False,
            error="That design is too detailed to send as a print file. "
                  "Try a slightly smaller graphic.",
        ), 400
    ext = _sniff(raw)
    if ext is None:
        return jsonify(ok=False, error="Artwork must be a PNG or WebP."), 400

    os.makedirs(ART_DIR, exist_ok=True)
    name = secrets.token_urlsafe(16).replace("-", "_") + "." + ext
    with open(os.path.join(ART_DIR, name), "wb") as f:
        f.write(raw)
    return jsonify(ok=True, url="/api/artwork/" + name)


@artwork_bp.route("/<name>")
@require("production")
def get_artwork(name):
    """Admin-only: this is the production file, and the customer already has
    their design under My Designs. The filename is unguessable regardless."""
    if not NAME_RE.match(name):
        return jsonify(ok=False, error="Not found."), 404
    if not os.path.exists(os.path.join(ART_DIR, name)):
        return jsonify(ok=False, error="Not found."), 404
    return send_from_directory(ART_DIR, name, mimetype=MIME[name.rsplit(".", 1)[1]])
