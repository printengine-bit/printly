# ═══════════════════════════════════════════════════════════════
#  PRINTLY — Production Backend (AI Image Generation + Print Prep)
#  Multi-provider:  Pollinations (free) · Gemini (free) · Replicate/Flux (paid) · ComfyUI (own GPU)
#
#  Install:  pip install flask flask-cors pillow requests
#
#  FREE setup (default — nothing to configure):
#     Pollinations works with NO key, NO signup, NO card.
#     Just run the file. Falls back to Gemini/Replicate if it's down.
#  Optional paid fallback (real client logos — no data used for training):
#     set REPLICATE_API_TOKEN=r8_xxxx   (from replicate.com)
#
#  Run:  python printly_backend.py
# ═══════════════════════════════════════════════════════════════
import os, io, sys, base64, time, requests
from datetime import timedelta
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from PIL import Image

load_dotenv()  # loads backend/.env if present — no-op if it doesn't exist

from db import get_db, close_db, init_db

# Windows consoles default to cp1252, which can't print the arrows/emoji
# in this file's log messages and crashes on startup — force UTF-8.
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

app = Flask(__name__)
app.teardown_appcontext(close_db)

# SECRET_KEY signs the session cookie — required for login sessions (Phase 2).
# Generate one with: python -c "import secrets;print(secrets.token_hex(32))"
# and set it as FLASK_SECRET_KEY in .env / the host's env vars. A random
# fallback is used if unset so local dev without a .env doesn't crash, but
# that fallback changes every restart (logs everyone out) — never rely on
# it outside local testing.
app.config.update(
    SECRET_KEY=os.environ.get("FLASK_SECRET_KEY") or os.urandom(32).hex(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("FLASK_ENV") == "production",
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
    # Request bodies were previously unbounded. Saved designs and logo
    # uploads carry base64 image data, so they need real headroom — but not
    # unlimited, or one request can exhaust a small host's memory.
    MAX_CONTENT_LENGTH=6 * 1024 * 1024,
)


@app.errorhandler(413)
def _too_large(_e):
    return jsonify(ok=False, error="That file or design is too large (6 MB max)."), 413

# Locked down in Phase 5 (see FRONTEND_ORIGIN) once there's a real deployed
# domain; wide open for now so local dev / ngrok tunnels keep working.
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN")
if FRONTEND_ORIGIN:
    CORS(app, origins=[FRONTEND_ORIGIN], supports_credentials=True)
else:
    CORS(app, supports_credentials=True)

@app.after_request
def _security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    return resp

def _asset_version():
    """Cache-busting token derived from the newest css/js mtime.

    The assets below are served with a 30-day max-age, so without this a
    deployed CSS/JS change would stay invisible to returning visitors for a
    month. index.html carries `?v=<token>` on every asset URL and is itself
    sent no-cache, so a changed file always produces a new URL.
    """
    newest = 0.0
    for sub in ("css", "js"):
        d = os.path.join(FRONTEND_DIR, sub)
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            try:
                newest = max(newest, os.path.getmtime(os.path.join(d, name)))
            except OSError:
                pass
    return str(int(newest))


_ASSET_V = _asset_version()

# Serve the frontend from the same origin as the API — lets index.html call
# the backend with a relative path (no hardcoded host), so the same build
# works unchanged on localhost, an ngrok tunnel, or a real deployed domain.
@app.route("/")
def frontend():
    # Recompute per request in dev so edits show up on reload; in production
    # the files never change between deploys, so compute it once at import.
    v = _ASSET_V if os.environ.get("FLASK_ENV") == "production" else _asset_version()
    with open(os.path.join(FRONTEND_DIR, "index.html"), encoding="utf-8") as f:
        html = f.read().replace("{{V}}", v)
    resp = app.make_response(html)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    resp.headers["Cache-Control"] = "no-cache"
    return resp

# Everything else in frontend/ — css/, js/, mockups/. Long max-age is safe
# because css/js URLs are versioned by the token above. Only paths under
# frontend/ resolve here; send_from_directory rejects traversal outside it.
@app.route("/<path:filename>")
def frontend_asset(filename):
    return send_from_directory(FRONTEND_DIR, filename, max_age=60 * 60 * 24 * 30)

@app.route("/api/health")
def health():
    try:
        get_db().execute("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return jsonify(ok=db_ok, db="ok" if db_ok else "error", provider=PROVIDER)

REPLICATE_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "")
GEMINI_KEY      = os.environ.get("GEMINI_API_KEY", "")
# Optional, still free — a token from https://auth.pollinations.ai bumps you
# from Anonymous tier (1 req/15s) to Seed tier (1 req/5s). Blank works fine,
# just queues customers more often under concurrent load.
POLLINATIONS_TOKEN = os.environ.get("POLLINATIONS_API_TOKEN", "")
# Which engine to use: "pollinations" (free, no key) | "gemini" (free tier) | "replicate" (paid, private) | "comfyui" (own GPU)
# `or`, not .get()'s default arg — a present-but-blank env var (e.g. an empty
# field on a hosting dashboard) must still fall back, not resolve to "".
PROVIDER        = os.environ.get("PRINTLY_PROVIDER") or "pollinations"
# Model IDs change often — override via env if Google renames them
GEMINI_MODEL    = os.environ.get("GEMINI_IMAGE_MODEL") or "gemini-2.5-flash-image"

init_db()

from auth import auth_bp
from orders import orders_bp
from designs import designs_bp
from reviews import reviews_bp
from shipping import shipping_bp
app.register_blueprint(auth_bp)
app.register_blueprint(orders_bp)
app.register_blueprint(designs_bp)
app.register_blueprint(reviews_bp)
app.register_blueprint(shipping_bp)

# ── Content moderation: block misuse before spending money ─────
BLOCKED = ["nude", "nsfw", "gore", "blood", "weapon", "gun", "drug",
           "hate", "nazi", "terrorist", "celebrity face", "actor face"]
def moderate(prompt: str):
    p = prompt.lower()
    for w in BLOCKED:
        if w in p:
            return False, f"'{w}' designs are not allowed on Printly."
    return True, ""

# ── Prompt enhancer: turn customer words into print-ready prompt ─
def build_prompt(user_prompt: str, style: str):
    styles = {
        "graphic":   "bold vector t-shirt graphic, flat colors, clean edges, sticker style",
        "vintage":   "vintage distressed t-shirt print, retro 70s poster style, textured",
        "minimal":   "minimal line-art t-shirt design, single color, elegant thin lines",
        "cartoon":   "cute cartoon mascot t-shirt design, thick outlines, vibrant flat colors",
        "realistic": "detailed illustration t-shirt print, rich colors, high contrast",
    }
    s = styles.get(style, styles["graphic"])
    return (f"{user_prompt}, {s}, centered composition, isolated on plain white background, "
            f"no text unless asked, print-ready, high quality")

# ── PROVIDER 0: Pollinations — FREE, no key required (Sana Sprint 1.6B) ─
#  Best default: no signup, no card, privacy-first (no data retention).
#  Caveat: no uptime SLA, and per-IP rate limits (retried with backoff below)
#  — we fall back to Gemini/Replicate if it's still down after retrying.
#  NOTE: gen.pollinations.ai/image/ now requires an API key (returns 401
#  without one) — the still-free, anonymous endpoint is image.pollinations.ai/prompt/.
POLLINATIONS_MODEL = os.environ.get("POLLINATIONS_MODEL") or "sana"
def generate_pollinations(prompt: str):
    import urllib.parse
    enc = urllib.parse.quote(prompt)
    # width/height 1024, nologo, seed random for variety
    url = (f"https://image.pollinations.ai/prompt/{enc}"
           f"?width=1024&height=1024&nologo=true&model={POLLINATIONS_MODEL}")
    headers = {"Authorization": f"Bearer {POLLINATIONS_TOKEN}"} if POLLINATIONS_TOKEN else {}
    # Anonymous/Seed tiers rate-limit per-IP (1 req/15s or 1 req/5s) — since every
    # customer's request comes from this one backend, concurrent clicks commonly
    # hit 429. Retry a few times with backoff instead of failing the customer.
    backoffs = [2, 5, 10]
    last_err = None
    for wait in [0] + backoffs:
        if wait: time.sleep(wait)
        r = requests.get(url, headers=headers, timeout=120)
        if r.status_code == 429:
            last_err = RuntimeError("Pollinations rate limit hit (429)")
            continue
        r.raise_for_status()
        ct = r.headers.get("content-type", "")
        if "image" not in ct:
            raise RuntimeError(f"Pollinations returned non-image ({ct})")
        return r.content, 0.0
    raise last_err

# ── PROVIDER A: Gemini / Nano Banana — FREE tier (₹0) ──────────
#  ⚠️  Free tier: Google may use prompts+outputs to improve their
#      models, and human review is possible. Do NOT use this for
#      paying customers' logos or confidential artwork.
#      Use it for: your own testing, templates, public-domain art.
def generate_gemini(prompt: str):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{GEMINI_MODEL}:generateContent")
    r = requests.post(
        url,
        headers={"x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json"},
        json={"contents": [{"parts": [{"text": prompt}]}]},
        timeout=120)
    if r.status_code == 429:
        raise RuntimeError("Gemini free-tier limit hit — try later or switch provider")
    r.raise_for_status()
    data = r.json()
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"]), 0.0
    raise RuntimeError("Gemini returned no image (prompt may have been blocked)")

# ── PROVIDER B: Flux Schnell via Replicate (~₹0.28/image, private) ─
def generate_replicate(prompt: str):
    r = requests.post(
        "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
        headers={"Authorization": f"Bearer {REPLICATE_TOKEN}",
                 "Content-Type": "application/json",
                 "Prefer": "wait"},
        json={"input": {"prompt": prompt, "aspect_ratio": "1:1",
                        "output_format": "png", "num_outputs": 1}},
        timeout=120)
    r.raise_for_status()
    out = r.json()
    url = out["output"][0] if isinstance(out.get("output"), list) else out.get("output")
    img = requests.get(url, timeout=60).content
    return img, 0.28  # approx cost in INR

# ── PROVIDER C (later): ComfyUI on your own GPU — ₹0, fully private ─
def generate_comfyui(prompt: str):
    # When you buy a GPU (RTX 3060 12GB+), run ComfyUI with Flux
    # Schnell FP8 and point this at http://127.0.0.1:8188
    raise NotImplementedError("Enable after GPU setup — see deployment guide")

PROVIDERS = {"pollinations": generate_pollinations,
             "gemini": generate_gemini,
             "replicate": generate_replicate,
             "comfyui": generate_comfyui}

def generate(prompt: str, want: str = None):
    """Try requested provider, fall back through the free-first chain."""
    order = [want or PROVIDER]
    for p in ("pollinations", "gemini", "replicate"):   # free-first fallback
        if p not in order: order.append(p)
    last = None
    for name in order:
        fn = PROVIDERS.get(name)
        if not fn: continue
        if name == "gemini" and not GEMINI_KEY: continue
        if name == "replicate" and not REPLICATE_TOKEN: continue
        try:
            img, cost = fn(prompt)
            return img, cost, name
        except Exception as e:
            last = e
            print(f"⚠️ {name} failed: {e}")
    raise RuntimeError(last or "No image provider configured")

# ── Print prep: white-bg removal + 300 DPI export for DTF ──────
def make_print_ready(png_bytes: bytes):
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    # knock out near-white background so DTF prints only the art
    datas = img.getdata()
    out = []
    for r, g, b, a in datas:
        if r > 242 and g > 242 and b > 242:
            out.append((r, g, b, 0))
        else:
            out.append((r, g, b, a))
    img.putdata(out)
    # upscale to A4-print size @300dpi if small (2480px wide max area)
    if img.width < 1600:
        f = 1600 / img.width
        img = img.resize((1600, int(img.height * f)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", dpi=(300, 300))
    return buf.getvalue()

# ═══ API ════════════════════════════════════════════════════════
# Pollinations caps at ~1 request/5s system-wide (every customer shares this
# one backend's IP) — MAX_INFLIGHT matches that hard ceiling. Bumping it just
# trades honest queue responses for more silent 429s from Pollinations itself.
MAX_INFLIGHT = 1
# If a worker crashes/OOMs mid-generation, its ai_inflight row would otherwise
# sit forever and permanently wedge the queue at "busy" — clear rows older
# than this before counting. Generous vs. the ~20-40s a real generation
# takes plus retry backoff, so it never races a genuinely in-flight request.
STALE_INFLIGHT_SECONDS = 90

@app.route("/api/generate-image", methods=["POST"])
def generate_image():
    d = request.get_json(force=True)
    prompt = (d.get("prompt") or "").strip()
    style  = d.get("style", "graphic")
    if len(prompt) < 3:
        return jsonify(ok=False, error="Describe your design in a few words."), 400

    ok, msg = moderate(prompt)
    if not ok:
        return jsonify(ok=False, error=msg), 400

    db = get_db()
    db.execute("DELETE FROM ai_inflight WHERE created < datetime('now', ?)",
               (f"-{STALE_INFLIGHT_SECONDS} seconds",))
    n = db.execute("SELECT COUNT(*) c FROM ai_inflight").fetchone()["c"]
    if n >= MAX_INFLIGHT:
        return jsonify(ok=False, queued=True, position=n + 1, retry_after_s=6), 429
    slot = db.execute("INSERT INTO ai_inflight DEFAULT VALUES")
    db.commit()

    try:
        full_prompt = build_prompt(prompt, style)
        want = d.get("provider")          # optional override from the UI
        try:
            raw, cost, used = generate(full_prompt, want)
        except Exception as e:
            return jsonify(ok=False, error=f"Generator busy, try again. ({e})"), 502

        print_png = make_print_ready(raw)
        b64 = base64.b64encode(print_png).decode()

        db.execute("INSERT INTO generations(prompt,model,cost_inr) VALUES(?,?,?)",
                   (prompt, used, cost))
        db.commit()
    finally:
        db.execute("DELETE FROM ai_inflight WHERE id=?", (slot.lastrowid,))
        db.commit()

    return jsonify(ok=True, image=f"data:image/png;base64,{b64}",
                   cost_inr=cost, provider=used)

@app.route("/api/stats")
def stats():
    row = get_db().execute(
        "SELECT COUNT(*) n, COALESCE(SUM(cost_inr),0) cost FROM generations").fetchone()
    return jsonify(total_images=row["n"], total_cost_inr=round(row["cost"], 2))

if __name__ == "__main__":
    print("Printly AI backend → http://127.0.0.1:5001")
    if not os.environ.get("FLASK_SECRET_KEY"):
        print("⚠️  FLASK_SECRET_KEY not set — using a random key that changes on every "
              "restart (everyone gets logged out each time). Fine for local dev, set it "
              "for real before deploying.")
    if not os.environ.get("ADMIN_EMAIL"):
        print("⚠️  ADMIN_EMAIL not set — no account will get the admin role on signup.")
    print(f"Provider: {PROVIDER}  |  Gemini key: {bool(GEMINI_KEY)}  |  Replicate token: {bool(REPLICATE_TOKEN)}")
    if PROVIDER == "pollinations":
        tier = "Seed (1 req/5s)" if POLLINATIONS_TOKEN else "Anonymous (1 req/15s) — get a free token at auth.pollinations.ai to raise this"
        print(f"✅ Using Pollinations (free). Rate-limit tier: {tier}. Falls back to Gemini/Replicate if still down after retries.")
    if PROVIDER == "gemini":
        print("⚠️  Gemini FREE tier: Google may use prompts/outputs for training.")
        print("    Switch to replicate before printing paying customers' logos.")
    # threaded=True lets multiple customers' requests be in flight at once
    # instead of the dev server queuing them one at a time behind each other.
    # debug=True (and its Werkzeug debugger — arbitrary code execution if the
    # PIN leaks) is only ever safe for local dev; this app.run() itself is
    # also never reached in production anyway (gunicorn imports `app`
    # directly and never calls this block) — the guard is defense-in-depth.
    is_prod = os.environ.get("FLASK_ENV") == "production"
    app.run(port=int(os.environ.get("PORT", 5001)), debug=not is_prod, threaded=True)
