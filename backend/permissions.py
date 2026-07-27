# ── Roles and module permissions ────────────────────────────────
# One source of truth for who can reach what. The panel's sidebar is built
# from the same matrix the API enforces with, so a menu can never show
# something the server would then refuse.
#
# Access is per *module*, not per action. Finer-grained read/write splits
# are easy to add later and impossible to remove once screens depend on
# them, so this starts coarse on purpose.
from functools import wraps

from flask import jsonify, session

# Every section of the admin panel. Order is the sidebar order.
MODULES = [
    "dashboard", "inventory", "orders", "production", "dispatch",
    "customers", "support", "content", "reports", "settings",
]

ROLES = {
    "owner":      set(MODULES),
    "production": {"dashboard", "inventory", "orders", "production"},
    "dispatch":   {"dashboard", "orders", "dispatch", "customers"},
    "support":    {"dashboard", "orders", "customers", "support", "content"},
}

STAFF_ROLES = tuple(ROLES)          # everything that isn't "customer"

# Staff management and settings are owner-only even though "settings" is a
# module — a support agent with the settings page could grant themselves
# owner. Enforced by owner_required, not by the matrix.
ROLE_LABELS = {
    "owner":      "Owner — full access",
    "production": "Production — print floor",
    "dispatch":   "Dispatch — packing and shipping",
    "support":    "Support — customers and tickets",
}


def is_staff(role):
    return role in ROLES


def modules_for(role):
    """Sidebar sections this role can open, in MODULES order."""
    allowed = ROLES.get(role, set())
    return [m for m in MODULES if m in allowed]


def can(role, module):
    return module in ROLES.get(role, set())


def _deny():
    if not session.get("user_id"):
        return jsonify(ok=False, error="Sign in required"), 401
    return None


def require(module):
    """Gate a route on one module. Use this for every new admin endpoint."""
    def deco(fn):
        @wraps(fn)
        def wrapped(*a, **kw):
            denied = _deny()
            if denied:
                return denied
            if not can(session.get("role"), module):
                return jsonify(ok=False, error="You don't have access to that."), 403
            return fn(*a, **kw)
        return wrapped
    return deco


def owner_required(fn):
    @wraps(fn)
    def wrapped(*a, **kw):
        denied = _deny()
        if denied:
            return denied
        if session.get("role") != "owner":
            return jsonify(ok=False, error="Owner access required."), 403
        return fn(*a, **kw)
    return wrapped
