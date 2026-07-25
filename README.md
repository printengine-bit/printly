# Printly — Custom T-Shirt Printing Platform

A single-page e-commerce + live design studio for custom apparel
(round neck tees, polos, hoodies, sports jerseys), with a real
photo-mockup engine (recolor + print overlay on actual product
photos, not geometric shapes) and an optional AI image-generation
backend. Brand: PRINTLY. Tagline: "Your Brand. Your Story. Printed."

## Folder structure

```
printly-project/
├── frontend/
│   └── index.html          ← THE app. Single file: HTML+CSS+JS,
│                              mockup photos embedded as base64.
│                              Just open it in a browser — no build step.
├── backend/
│   ├── printly_backend.py  ← Flask AI-image-generation API (port 5001)
│   ├── requirements.txt
│   └── .env.example        ← copy to .env, pick a provider
├── assets/
│   └── mockups/            ← the 8 RAW source photos (front+back ×
│                              4 products) used to build the print
│                              engine. Reference only — index.html
│                              already has these baked in as base64.
│                              Re-embed from here if you replace a photo.
├── docs/
│   ├── Printly_Business_Plan_2026.pdf
│   └── chat_context.txt    ← full build history / decisions log
└── .gitignore
```

## Running it

**Frontend** — no install needed:
```bash
open frontend/index.html          # macOS
# or just double-click it / drag into a browser
```
This alone gives you the full design studio, product catalog, cart,
and checkout demo. AI image generation needs the backend running too
(design tool itself — text, logos, recolor — works with zero backend).

**Backend** (only needed for the AI image-generation button):
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env      # default provider (pollinations) needs no key at all
python printly_backend.py # runs on http://127.0.0.1:5001
```
The frontend's `BACKEND` constant (search `index.html` for `const BACKEND=`,
in the "AI IMAGE" section of the script) points at `http://127.0.0.1:5001`
— update this to your deployed URL when you go live.

## What's built (as of this snapshot)

- **4 products, front + back, real photo mockups**: round neck,
  polo, hoodie, sports jersey — all with working recolor (multiply-
  blend keeps fabric folds/shadows), design/text/logo overlay, drag +
  snap-to-center, resize, and an on-canvas delete (✕) on the selected
  element plus Delete/Backspace keyboard support.
- **Jersey Kit panel** — name/number/sponsor auto-layout on the jersey
  back print area, for team orders.
- **Enlarged print areas** on every product (fixed a bug where designs
  like a jersey number couldn't be sized up enough).
- **AI image generation** — multi-provider backend with free-first
  fallback (Pollinations → Gemini → Replicate), gated to 3 free tries
  for guests then sign-in required; design tool itself is unlimited/free.
- **Business plan PDF** in `docs/` — asset-light launch model
  (₹2.3–3.3L investment), competitor research (PrintMine.in, VistaPrint),
  pricing tiers per product.

## Known pending items

1. **Razorpay** — checkout is currently a demo flow, not wired to a
   real payment gateway.
2. **Live deployment** — frontend is static (Netlify/Vercel free tier
   works), backend needs a small host (Railway/Render, ~₹600/mo) plus
   a domain (~₹900/yr for printly.in). Update the `BACKEND` constant
   in `index.html` once the backend has a live URL — do this before
   wiring Razorpay, since payment testing needs a live callback URL.
3. **PWA** — installable home-screen app is a ~1-day addition on top
   of the existing HTML/JS; Capacitor can wrap it for Play/App Store
   later. (Deliberately not rebuilt in React Native — reuses this
   same codebase.)
4. Print-area fine-tuning may be needed per product once tested on
   real devices/screens.

See `docs/chat_context.txt` for the full reasoning behind these
decisions (why photo mockups over geometric shapes, why Pollinations
as the default AI provider, etc.) and everything already tried.
