# ── Support blueprint: tickets, both sides of the conversation ──
#
# There is no email transport, so this is not a mailbox — it's the shop's
# record of a conversation, readable by the customer inside their account.
# A ticket can be opened by the customer from an order, or by staff logging
# a call or a WhatsApp message that came in elsewhere. Both end up in the
# same inbox, which is the point: one place to look.
#
# `internal` messages are staff-only notes on the same thread. Without them
# people type "customer sounds annoyed, refund if she pushes" into the reply
# box, and it goes to the customer.
from flask import Blueprint, request, jsonify, session

from db import get_db
from auth import login_required
from permissions import require

support_bp = Blueprint("support", __name__, url_prefix="/api")

STATUSES = ("open", "pending", "closed")
PRIORITIES = ("low", "normal", "high")
MAX_BODY = 4000
MAX_SUBJECT = 140


def _row_id_from_display(order_id):
    from orders import _row_id_from_display as f
    return f(order_id)


def _ticket_public(r, messages=None, internal_ok=False):
    from orders import _display_id
    d = {
        "id": r["id"], "subject": r["subject"], "status": r["status"],
        "priority": r["priority"], "created": r["created"], "updated": r["updated"],
        "order": _display_id(r["order_id"]) if r["order_id"] else None,
        "opened_by": r["opened_by"],
    }
    for k in ("customer_name", "customer_email", "assignee_name"):
        if k in r.keys():
            d[k.replace("customer_", "customer_").replace("assignee_name", "assignee")] = r[k]
    if "assignee_id" in r.keys():
        d["assignee_id"] = r["assignee_id"]
    if messages is not None:
        d["messages"] = [{
            "id": m["id"], "body": m["body"], "from_staff": bool(m["from_staff"]),
            "internal": bool(m["internal"]), "author": m["author_name"],
            "created": m["created"],
        } for m in messages if internal_ok or not m["internal"]]
    return d


def _touch(db, ticket_id):
    db.execute("UPDATE tickets SET updated=CURRENT_TIMESTAMP WHERE id=?", (ticket_id,))


def _messages(db, ticket_id):
    return db.execute(
        """SELECT m.*, u.name AS author_name FROM ticket_messages m
           LEFT JOIN users u ON u.id=m.author_id
           WHERE m.ticket_id=? ORDER BY m.id""", (ticket_id,)).fetchall()


# ══════════════ Customer side ══════════════
@support_bp.route("/support/tickets", methods=["POST"])
@login_required
def open_ticket():
    d = request.get_json(force=True, silent=True) or {}
    subject = (d.get("subject") or "").strip()[:MAX_SUBJECT]
    body = (d.get("body") or "").strip()[:MAX_BODY]
    if len(subject) < 3:
        return jsonify(ok=False, error="Give it a short subject."), 400
    if len(body) < 5:
        return jsonify(ok=False, error="Tell us what's happened."), 400

    db = get_db()
    order_row_id = None
    if d.get("order"):
        order_row_id = _row_id_from_display(d.get("order"))
        # Only against their own order — otherwise a ticket id becomes a way
        # to point at someone else's order in the admin panel.
        own = db.execute("SELECT 1 FROM orders WHERE id=? AND user_id=?",
                         (order_row_id, session["user_id"])).fetchone()
        if not own:
            return jsonify(ok=False, error="That isn't one of your orders."), 400

    open_count = db.execute(
        """SELECT COUNT(*) c FROM tickets WHERE user_id=? AND status!='closed'""",
        (session["user_id"],)).fetchone()["c"]
    if open_count >= 10:
        return jsonify(ok=False,
                       error="You already have 10 open requests — we'll get to them."), 429

    cur = db.execute(
        """INSERT INTO tickets(user_id,order_id,subject,opened_by) VALUES(?,?,?,'customer')""",
        (session["user_id"], order_row_id, subject))
    db.execute(
        """INSERT INTO ticket_messages(ticket_id,author_id,from_staff,body)
           VALUES(?,?,0,?)""", (cur.lastrowid, session["user_id"], body))
    db.commit()
    return jsonify(ok=True, id=cur.lastrowid)


@support_bp.route("/support/tickets")
@login_required
def my_tickets():
    db = get_db()
    rows = db.execute(
        """SELECT * FROM tickets WHERE user_id=? ORDER BY updated DESC LIMIT 50""",
        (session["user_id"],)).fetchall()
    out = []
    for r in rows:
        msgs = _messages(db, r["id"])
        t = _ticket_public(r, msgs, internal_ok=False)
        t["replies"] = len([m for m in msgs if m["from_staff"] and not m["internal"]])
        out.append(t)
    return jsonify(ok=True, tickets=out)


@support_bp.route("/support/tickets/<int:tid>/reply", methods=["POST"])
@login_required
def customer_reply(tid):
    body = ((request.get_json(force=True, silent=True) or {}).get("body") or "").strip()[:MAX_BODY]
    if len(body) < 2:
        return jsonify(ok=False, error="Nothing to send."), 400
    db = get_db()
    t = db.execute("SELECT * FROM tickets WHERE id=? AND user_id=?",
                   (tid, session["user_id"])).fetchone()
    if not t:
        return jsonify(ok=False, error="Request not found."), 404
    db.execute("""INSERT INTO ticket_messages(ticket_id,author_id,from_staff,body)
                  VALUES(?,?,0,?)""", (tid, session["user_id"], body))
    # A customer replying to something staff had parked reopens it — closed
    # tickets that keep receiving messages are how people get ignored.
    db.execute("UPDATE tickets SET status='open', updated=CURRENT_TIMESTAMP WHERE id=?", (tid,))
    db.commit()
    return jsonify(ok=True)


# ══════════════ Staff side ══════════════
@support_bp.route("/admin/support/tickets")
@require("support")
def admin_tickets():
    db = get_db()
    scope = (request.args.get("scope") or "open").strip()
    q = (request.args.get("q") or "").strip()
    sql = """SELECT t.*, u.name AS customer_name, u.email AS customer_email,
                    s.name AS assignee_name,
                    (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id) AS msgs,
                    (SELECT MAX(created) FROM ticket_messages m
                      WHERE m.ticket_id=t.id AND m.from_staff=0) AS last_customer
             FROM tickets t
             LEFT JOIN users u ON u.id=t.user_id
             LEFT JOIN users s ON s.id=t.assignee_id
             WHERE 1=1"""
    args = []
    if scope == "open":
        sql += " AND t.status!='closed'"
    elif scope == "mine":
        sql += " AND t.assignee_id=? AND t.status!='closed'"
        args.append(session.get("user_id"))
    elif scope == "unassigned":
        sql += " AND t.assignee_id IS NULL AND t.status!='closed'"
    elif scope == "closed":
        sql += " AND t.status='closed'"
    if q:
        sql += " AND (t.subject LIKE ? OR u.name LIKE ? OR u.email LIKE ?)"
        like = "%" + q + "%"
        args += [like, like, like]
    sql += " ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END," \
           " t.updated DESC LIMIT 200"
    rows = db.execute(sql, args).fetchall()

    counts = {}
    for key, where in (("open", "status!='closed'"),
                       ("unassigned", "assignee_id IS NULL AND status!='closed'"),
                       ("closed", "status='closed'")):
        counts[key] = db.execute("SELECT COUNT(*) c FROM tickets WHERE " + where).fetchone()["c"]
    counts["mine"] = db.execute(
        "SELECT COUNT(*) c FROM tickets WHERE assignee_id=? AND status!='closed'",
        (session.get("user_id"),)).fetchone()["c"]

    out = []
    for r in rows:
        t = _ticket_public(r)
        t["messages_count"] = r["msgs"]
        t["last_customer"] = r["last_customer"]
        out.append(t)
    return jsonify(ok=True, tickets=out, counts=counts, scope=scope)


@support_bp.route("/admin/support/tickets/<int:tid>")
@require("support")
def admin_ticket(tid):
    db = get_db()
    r = db.execute(
        """SELECT t.*, u.name AS customer_name, u.email AS customer_email,
                  u.loyalty_points, s.name AS assignee_name
           FROM tickets t LEFT JOIN users u ON u.id=t.user_id
           LEFT JOIN users s ON s.id=t.assignee_id WHERE t.id=?""", (tid,)).fetchone()
    if not r:
        return jsonify(ok=False, error="Ticket not found."), 404
    t = _ticket_public(r, _messages(db, tid), internal_ok=True)
    t["customer_id"] = r["user_id"]
    t["points"] = r["loyalty_points"]
    staff = db.execute(
        "SELECT id,name FROM users WHERE role!='customer' AND active=1 ORDER BY name").fetchall()
    return jsonify(ok=True, ticket=t,
                   staff=[{"id": s["id"], "name": s["name"]} for s in staff])


@support_bp.route("/admin/support/tickets", methods=["POST"])
@require("support")
def staff_open_ticket():
    """Logging a conversation that arrived some other way — a phone call, a
    WhatsApp message. Without this the inbox is only as complete as the
    channel we happen to own."""
    d = request.get_json(force=True, silent=True) or {}
    subject = (d.get("subject") or "").strip()[:MAX_SUBJECT]
    body = (d.get("body") or "").strip()[:MAX_BODY]
    if len(subject) < 3:
        return jsonify(ok=False, error="Give it a short subject."), 400
    db = get_db()
    uid = d.get("user_id")
    if uid is not None and not db.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
        return jsonify(ok=False, error="No such customer."), 400
    order_row_id = _row_id_from_display(d.get("order")) if d.get("order") else None
    cur = db.execute(
        """INSERT INTO tickets(user_id,order_id,subject,opened_by,assignee_id)
           VALUES(?,?,?,'staff',?)""",
        (uid, order_row_id, subject, session.get("user_id")))
    if body:
        db.execute("""INSERT INTO ticket_messages(ticket_id,author_id,from_staff,internal,body)
                      VALUES(?,?,1,1,?)""", (cur.lastrowid, session.get("user_id"), body))
    db.commit()
    return jsonify(ok=True, id=cur.lastrowid)


@support_bp.route("/admin/support/tickets/<int:tid>/reply", methods=["POST"])
@require("support")
def staff_reply(tid):
    d = request.get_json(force=True, silent=True) or {}
    body = (d.get("body") or "").strip()[:MAX_BODY]
    internal = 1 if d.get("internal") else 0
    if len(body) < 2:
        return jsonify(ok=False, error="Nothing to send."), 400
    db = get_db()
    t = db.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()
    if not t:
        return jsonify(ok=False, error="Ticket not found."), 404
    db.execute("""INSERT INTO ticket_messages(ticket_id,author_id,from_staff,internal,body)
                  VALUES(?,?,1,?,?)""", (tid, session.get("user_id"), internal, body))
    # A public reply is waiting on the customer; a private note changes
    # nothing about whose turn it is.
    if not internal and t["status"] == "open":
        db.execute("UPDATE tickets SET status='pending' WHERE id=?", (tid,))
    # Answering an unassigned ticket claims it — otherwise "unassigned" fills
    # with tickets somebody is already working on.
    if t["assignee_id"] is None:
        db.execute("UPDATE tickets SET assignee_id=? WHERE id=?", (session.get("user_id"), tid))
    _touch(db, tid)
    db.commit()
    return jsonify(ok=True)


@support_bp.route("/admin/support/tickets/<int:tid>", methods=["POST"])
@require("support")
def update_ticket(tid):
    from admin_api import log
    d = request.get_json(force=True, silent=True) or {}
    db = get_db()
    t = db.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()
    if not t:
        return jsonify(ok=False, error="Ticket not found."), 404

    if "status" in d:
        if d["status"] not in STATUSES:
            return jsonify(ok=False, error="Unknown status."), 400
        db.execute("UPDATE tickets SET status=? WHERE id=?", (d["status"], tid))
        log(db, "ticket", tid, "status", t["status"], d["status"])
    if "priority" in d:
        if d["priority"] not in PRIORITIES:
            return jsonify(ok=False, error="Unknown priority."), 400
        db.execute("UPDATE tickets SET priority=? WHERE id=?", (d["priority"], tid))
        log(db, "ticket", tid, "priority", t["priority"], d["priority"])
    if "assignee_id" in d:
        aid = d["assignee_id"]
        if aid in (None, "", 0):
            db.execute("UPDATE tickets SET assignee_id=NULL WHERE id=?", (tid,))
            log(db, "ticket", tid, "unassigned")
        else:
            ok = db.execute("SELECT 1 FROM users WHERE id=? AND role!='customer' AND active=1",
                            (aid,)).fetchone()
            if not ok:
                return jsonify(ok=False, error="That isn't an active staff account."), 400
            db.execute("UPDATE tickets SET assignee_id=? WHERE id=?", (aid, tid))
            log(db, "ticket", tid, "assigned", None, aid)
    _touch(db, tid)
    db.commit()
    return jsonify(ok=True)


# ── Canned replies ───────────────────────────────────────────────
@support_bp.route("/admin/support/canned")
@require("support")
def list_canned():
    rows = get_db().execute(
        "SELECT * FROM canned_replies ORDER BY sort,id").fetchall()
    return jsonify(ok=True, replies=[{"id": r["id"], "title": r["title"],
                                      "body": r["body"]} for r in rows])


@support_bp.route("/admin/support/canned", methods=["POST"])
@require("support")
def save_canned():
    d = request.get_json(force=True, silent=True) or {}
    title = (d.get("title") or "").strip()[:120]
    body = (d.get("body") or "").strip()[:MAX_BODY]
    if len(title) < 2 or len(body) < 5:
        return jsonify(ok=False, error="A canned reply needs a title and a body."), 400
    db = get_db()
    if d.get("id"):
        db.execute("UPDATE canned_replies SET title=?,body=? WHERE id=?",
                   (title, body, d["id"]))
    else:
        db.execute("INSERT INTO canned_replies(title,body,sort) VALUES(?,?,?)",
                   (title, body, 99))
    db.commit()
    return jsonify(ok=True)


@support_bp.route("/admin/support/canned/<int:cid>", methods=["DELETE"])
@require("support")
def delete_canned(cid):
    db = get_db()
    db.execute("DELETE FROM canned_replies WHERE id=?", (cid,))
    db.commit()
    return jsonify(ok=True)
