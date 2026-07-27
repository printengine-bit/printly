# Deploying Printly to Railway

One service, one volume. The repo root carries everything the builder needs
(`requirements.txt`, `Procfile`, `railway.json`, `runtime.txt`) — Railway
should require no build configuration in the dashboard.

## 1. Add a volume — before the first successful deploy

**This is the step that loses data if it's skipped.** Railway's container
filesystem is wiped on every redeploy. Without a volume, each deploy
destroys every account, order, saved design and print file.

- Mount path: `/data`
- Then point both stores at it with the env vars below.

The volume also means **exactly one replica, forever**. SQLite cannot be
written by two containers at once, and a Railway volume mounts to one
service anyway. `railway.json` pins `numReplicas: 1` — don't raise it.
Scaling horizontally means moving to Postgres first.

## 2. Environment variables

| Variable | Value | Why |
|---|---|---|
| `FLASK_SECRET_KEY` | a long random string | Signs session cookies. Changing it later signs everyone out. Never reuse the local one. |
| `FLASK_ENV` | `production` | Turns on `Secure` cookies, turns off the debug reloader. |
| `DB_PATH` | `/data/printly.db` | Onto the volume. |
| `ART_DIR` | `/data/artwork` | Print-ready files — the only copy production can print from. |
| `ADMIN_EMAIL` | your real email | See step 4. Set it **before** the first deploy. |
| `POLLINATIONS_MODEL` | `sana` | AI image model. |
| `POLLINATIONS_API_TOKEN` | *(optional)* | Free token; moves the queue from 1 req/15s to 1 req/5s. |

Leave `FRONTEND_ORIGIN` unset — the frontend is served from the same origin,
so CORS isn't involved.

## 3. Region

Default is US West. Printly ships from Pune to Indian customers, so every
request is crossing the Pacific twice. Switch the service to **Southeast
Asia (Singapore)** — it's the closest region Railway offers to India and
cuts roughly 200ms off every request. Do it before there's data on the
volume, since moving region means moving the volume.

## 4. First sign-in — order matters

`ADMIN_EMAIL` grants the `owner` role to the **first** signup using that
address, and is ignored once an owner exists. So:

1. Deploy with `ADMIN_EMAIL` already set.
2. Open the deployed site and sign up with that exact address.
3. Confirm `/admin` opens and shows "Owner — full access".
4. Only then share the URL.

Get this out of order and you'll have a customer account on your own email
with no way to promote it from the UI.

## 5. Generate a domain

The service starts "Unexposed". Settings → Networking → Generate Domain for
a `*.up.railway.app` URL, or add a custom domain. Nothing works from a
browser until this exists.

## 6. Verify the deploy

```bash
curl -s https://<your-domain>/api/health
```

Expect `{"ok": true, "db": "ok", ...}` and HTTP 200. A **503** means the app
booted but can't reach the database — almost always the volume isn't mounted
at `/data`, or `DB_PATH` is pointing somewhere else.

Then by hand:
- `/` loads the storefront, `/admin` loads the panel.
- Sign up with `ADMIN_EMAIL`, open `/admin`, fill in Settings → Company profile.
- Place a test order end to end and confirm it appears with its artwork.
- **Redeploy, and confirm that order is still there.** This is the real test
  that the volume is working.

## Known constraints

- **No email transport.** No password resets, no order emails, no proof
  notifications. Everything is in-app. Brevo and Resend both have free tiers
  when this becomes worth wiring up.
- **GST.** The storefront charges a 5% GST line but there is no GSTIN on
  file. Resolve before taking real money — see the admin panel's warning on
  Settings → Company profile.
- **Order totals are still client-computed.** Fixed in Phase 1, and it must
  be fixed before any payment gateway goes live.
- **Cost.** No free tier: $5/month Hobby once the trial credit runs out.
