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
import os, io, sys, base64, time, sqlite3, requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from PIL import Image

# Windows consoles default to cp1252, which can't print the arrows/emoji
# in this file's log messages and crashes on startup — force UTF-8.
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

app = Flask(__name__)
CORS(app)  # allow the design-tool HTML to call this from browser

# Serve the frontend from the same origin as the API — lets index.html call
# the backend with a relative path (no hardcoded host), so the same build
# works unchanged on localhost, an ngrok tunnel, or a real deployed domain.
@app.route("/")
def frontend():
    return send_from_directory(FRONTEND_DIR, "index.html")

REPLICATE_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "")
GEMINI_KEY      = os.environ.get("GEMINI_API_KEY", "")
# Optional, still free — a token from https://auth.pollinations.ai bumps you
# from Anonymous tier (1 req/15s) to Seed tier (1 req/5s). Blank works fine,
# just queues customers more often under concurrent load.
POLLINATIONS_TOKEN = os.environ.get("POLLINATIONS_API_TOKEN", "")
# Which engine to use: "pollinations" (free, no key) | "gemini" (free tier) | "replicate" (paid, private) | "comfyui" (own GPU)
PROVIDER        = os.environ.get("PRINTLY_PROVIDER", "pollinations")
# Model IDs change often — override via env if Google renames them
GEMINI_MODEL    = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
DB = "printly.db"

# ── DB: log every generation (cost tracking + reprint) ──────────
def init_db():
    c = sqlite3.connect(DB)
    c.execute("""CREATE TABLE IF NOT EXISTS generations(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT, model TEXT, cost_inr REAL,
        created TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.commit(); c.close()
init_db()

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
POLLINATIONS_MODEL = os.environ.get("POLLINATIONS_MODEL", "sana")
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

    full_prompt = build_prompt(prompt, style)
    want = d.get("provider")          # optional override from the UI
    try:
        raw, cost, used = generate(full_prompt, want)
    except Exception as e:
        return jsonify(ok=False, error=f"Generator busy, try again. ({e})"), 502

    print_png = make_print_ready(raw)
    b64 = base64.b64encode(print_png).decode()

    c = sqlite3.connect(DB)
    c.execute("INSERT INTO generations(prompt,model,cost_inr) VALUES(?,?,?)",
              (prompt, used, cost))
    c.commit(); c.close()

    return jsonify(ok=True, image=f"data:image/png;base64,{b64}",
                   cost_inr=cost, provider=used)

@app.route("/api/stats")
def stats():
    c = sqlite3.connect(DB)
    n, cost = c.execute("SELECT COUNT(*), COALESCE(SUM(cost_inr),0) FROM generations").fetchone()
    c.close()
    return jsonify(total_images=n, total_cost_inr=round(cost, 2))

if __name__ == "__main__":
    print("Printly AI backend → http://127.0.0.1:5001")
    print(f"Provider: {PROVIDER}  |  Gemini key: {bool(GEMINI_KEY)}  |  Replicate token: {bool(REPLICATE_TOKEN)}")
    if PROVIDER == "pollinations":
        tier = "Seed (1 req/5s)" if POLLINATIONS_TOKEN else "Anonymous (1 req/15s) — get a free token at auth.pollinations.ai to raise this"
        print(f"✅ Using Pollinations (free). Rate-limit tier: {tier}. Falls back to Gemini/Replicate if still down after retries.")
    if PROVIDER == "gemini":
        print("⚠️  Gemini FREE tier: Google may use prompts/outputs for training.")
        print("    Switch to replicate before printing paying customers' logos.")
    # threaded=True lets multiple customers' requests be in flight at once
    # instead of the dev server queuing them one at a time behind each other.
    app.run(port=5001, debug=True, threaded=True)
