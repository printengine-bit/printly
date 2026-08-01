"""
Load test for Print Engine — validates the "100 concurrent users" target from
the production-readiness plan. Deliberately excludes /api/generate-image:
that endpoint is capped to 1 concurrent request by design (Pollinations'
free-tier rate limit), so hammering it here would just spam 429s and burn
the shared free quota — its queueing behavior is verified separately with
a handful of manual requests, not a bulk load test.

Usage:
    pip install locust        # dev-only tool, not in requirements.txt
    locust -f loadtest.py --host http://127.0.0.1:5001 \
        --users 100 --spawn-rate 10 --run-time 3m --headless
Point --host at the deployed Railway URL once live, instead of localhost.
"""
import random
import string
from locust import HttpUser, task, between


def rand_email():
    return "loadtest_" + "".join(random.choices(string.ascii_lowercase, k=10)) + "@test.com"


class PrintlyUser(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        self.email = rand_email()
        self.password = "loadtestpass123"
        with self.client.post(
            "/api/auth/signup",
            json={"name": "Load Test", "email": self.email, "password": self.password},
            catch_response=True,
        ) as r:
            if r.status_code != 200 or not r.json().get("ok"):
                r.failure(f"signup failed: {r.text[:200]}")

    @task(5)
    def browse_home(self):
        self.client.get("/")

    @task(3)
    def view_my_orders(self):
        self.client.get("/api/orders/mine")

    @task(1)
    def place_order(self):
        payload = {
            "items": [{"product": "Round Neck Tee", "qty": 10, "unit": 449}],
            "total": 4939,
        }
        self.client.post("/api/orders", json=payload)

    @task(1)
    def relogin(self):
        # exercises the login-rate-limit path under load without tripping
        # it for any single account (each simulated user has their own)
        self.client.post("/api/auth/login", json={"email": self.email, "password": self.password})


class AdminUser(HttpUser):
    """A light slice of traffic hitting the admin view — set ADMIN_EMAIL to
    match this account (or adjust below) before running, or this class's
    requests will just 403, which is still useful signal (confirms the
    gate holds up under load rather than leaking through)."""
    wait_time = between(3, 6)
    weight = 1  # keep this rare relative to PrintlyUser (weight defaults to 1 there too — tune via --users mix if needed)

    def on_start(self):
        self.client.post(
            "/api/auth/login",
            json={"email": "admin@printly.test", "password": "testpass123"},
        )

    @task
    def view_admin_orders(self):
        self.client.get("/api/admin/orders")
