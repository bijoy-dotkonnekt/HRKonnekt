"""Button handlers (no AI). Everything that changes a record happens here, on a tap by the right person."""
import json
from datetime import date, datetime, timedelta

from fastapi import HTTPException

from bot import channel, hrms_client
from bot.hrms_client import HRMSError
from db import BOT_DB, audit, db, now, one, rows


def user(emp_id):
    with db(BOT_DB) as c:
        return one(c, "SELECT * FROM users WHERE emp_id=?", emp_id)


def hr_admin_ids():
    with db(BOT_DB) as c:
        return [r["emp_id"] for r in rows(c, "SELECT emp_id FROM users WHERE role='hr_admin'")]


def fmt_range(start, end):
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    return s.strftime("%a %d %b") if s == e else f"{s.strftime('%a %d %b')} → {e.strftime('%a %d %b')}"


def leave_draft(emp_id, leave_type, start_date, end_date, reason=""):
    """Validate with the HRMS (dry run) and show the employee a Confirm card. Nothing is submitted yet."""
    d = hrms_client.post("/leave/requests", dict(emp_id=emp_id, leave_type=leave_type, start_date=start_date,
                                                 end_date=end_date, reason=reason, dry_run=True))
    card = dict(kind="leave_confirm", title="Confirm your leave request",
                facts=[["Type", f"{d['leave_type_name']} ({d['leave_type']})"], ["Dates", fmt_range(d["start_date"], d["end_date"])],
                       ["Working days", str(d["days"])], ["Balance after", str(round(d["available_before"] - d["days"], 2)) if d["available_before"] is not None else "—"],
                       ["Approver", d["approver_name"] or "—"]] + ([["Reason", reason]] if reason else []),
                buttons=[dict(label="Confirm", action="leave_confirm", style="primary"), dict(label="Cancel", action="leave_cancel")],
                allowed=[emp_id], payload=dict(leave_type=d["leave_type"], start_date=d["start_date"], end_date=d["end_date"], reason=reason))
    card_id = channel.dm(emp_id, card=card, source="HR Agent")
    return {**d, "status": "draft", "card_id": card_id,
            "note": "A Confirm card is now shown to the employee. Nothing is submitted until they tap Confirm."}


def create_handover(emp_id, category, summary):
    with db(BOT_DB) as c:
        hid = c.execute("INSERT INTO handovers(emp_id,category,summary,status,created_at) VALUES (?,?,?,'open',?)",
                        (emp_id, category, summary, now())).lastrowid
    u = user(emp_id)
    channel.post("hr-private", card=dict(
        kind="handover", title=f"Handover #{hid} · {category}",
        lines=[summary], facts=[["From", f"{u['name']} ({u['department']})"], ["When", datetime.now().strftime("%d %b, %H:%M")]],
        buttons=[dict(label="Pick up", action="handover_pickup", style="primary")],
        allowed=hr_admin_ids(), payload=dict(handover_id=hid, emp_id=emp_id)),
        source="HR Agent" if category in ("unanswered", "checkin") else "Guard")
    audit(emp_id, "handover.created", hid, {"category": category})
    return hid


def submit_leave(emp_id, p, source):
    """Create the request in the HRMS and put an Approve/Reject card in the manager's DM. Raises HRMSError."""
    r = hrms_client.post("/leave/requests", dict(emp_id=emp_id, source=source, leave_type=p["leave_type"],
                                                  start_date=p["start_date"], end_date=p["end_date"], reason=p.get("reason", "")))
    audit(emp_id, "hrms.leave_request.create", r["id"], {"source": source})
    me = user(emp_id)
    if r["approver_id"]:
        channel.dm(r["approver_id"], card=dict(
            kind="leave_approval", title=f"Leave request from {me['name']}",
            facts=[["Type", f"{r['leave_type_name']} ({r['leave_type']})"], ["Dates", fmt_range(r["start_date"], r["end_date"])],
                   ["Working days", str(r["days"])], ["Balance after", str(round(r["available_before"] - r["days"], 2))]]
                  + ([["Reason", r["reason"]]] if r["reason"] else []),
            buttons=[dict(label="Approve", action="leave_approve", style="primary"), dict(label="Reject", action="leave_reject", style="danger")],
            allowed=[r["approver_id"]], payload=dict(request_id=r["id"], emp_id=emp_id)), source="HR Agent")
    if source == "hrms":
        channel.dm(emp_id, f"Your {r['leave_type_name']} request for {fmt_range(r['start_date'], r['end_date'])} went to {r['approver_name']}. I'll tell you when they decide.", source="HR Agent")
    return r


def _open_cards(conversation_id, key, value):
    """Open cards in a conversation whose payload[key] == value."""
    with db(BOT_DB) as c:
        ms = rows(c, "SELECT card_json FROM messages WHERE conversation_id LIKE ? AND card_json IS NOT NULL", conversation_id)
    cards = [json.loads(m["card_json"]) for m in ms]
    return [k for k in cards if k.get("state") == "open" and k.get("payload", {}).get(key) == value]


def decide_leave(approver_id, request_id, verb):
    """Approve or reject in the HRMS, tell the employee, close the manager's chat card. Same path for chat and HRMS web."""
    r = hrms_client.post(f"/leave/requests/{request_id}/{verb}", dict(approver_id=approver_id))
    audit(approver_id, f"hrms.leave_request.{verb}", r["id"])
    bal = next(b for b in hrms_client.get("/leave/balances", emp_id=r["emp_id"]) if b["leave_type"] == r["leave_type"])
    icon = "✅" if r["status"] == "approved" else "❌"
    channel.dm(r["emp_id"], card=dict(
        kind="status", title=f"{icon} Leave {r['status']}", state="closed",
        lines=[f"{r['approver_name']} {r['status']} your {r['leave_type_name']} for {fmt_range(r['start_date'], r['end_date'])}."],
        facts=[[f"{r['leave_type']} available now", str(bal["available"])]]), source="HR Agent")
    for k in _open_cards(f"dm-{approver_id}", "request_id", r["id"]):
        channel.close_card(k, f"{r['status'].capitalize()} ✓ {r['employee_name']} has been told.")
    return r


def resolve_handover(hr_id, handover_id):
    """HR picks up a handover (chat card or Console). The employee is told; the #hr-private card closes."""
    with db(BOT_DB) as c:
        h = one(c, "SELECT * FROM handovers WHERE id=?", handover_id)
        if not h:
            raise HTTPException(404, "handover not found")
        c.execute("UPDATE handovers SET status='resolved', assigned_to=? WHERE id=?", (hr_id, handover_id))
    hr = user(hr_id)
    if h["status"] == "open":
        channel.dm(h["emp_id"], f"{hr['name']} from HR has picked up your message and will reach out to you directly.", source="Guard")
    for k in _open_cards("hr-private", "handover_id", handover_id):
        channel.close_card(k, f"Resolved by {hr['name']}")
    audit(hr_id, "handover.resolved", handover_id)


def payslip_card(emp_id):
    """Payslip card rendered from the HRMS. Amounts go to the employee's screen only, never back to an agent."""
    d = hrms_client.get("/payslips", emp_id=emp_id)
    s, slip = d["structure"], d["payslips"][0]
    month = date.fromisoformat(slip["month"] + "-01").strftime("%B %Y")
    channel.dm(emp_id, card=dict(
        kind="payslip", title=month, state="closed",
        earnings=[["Basic", s["basic"]], ["House rent allowance", s["hra"]], ["Special allowance", s["special_allowance"]]],
        deductions=[["Provident fund", s["employee_pf"]], ["Professional tax", s["professional_tax"]], ["Income tax (TDS)", s["tds"]]]
                   + ([["Loss of pay", slip["lop_amount"]]] if slip["lop_amount"] else []),
        gross=slip["gross"], net=slip["net_pay"]), source="HR Agent")
    return month


def my_data_card(emp_id):
    channel.dm(emp_id, card=dict(kind="my_data", title="What HRKonnekt keeps about you",
                                 buttons=[dict(label=k, action="pref_toggle", value=k) for k in ("wellness", "nudges", "birthday")],
                                 allowed=[emp_id]), source="Wellness Agent")


def _tally(card, poll_id):
    with db(BOT_DB) as c:
        counts = {r["option"]: r["n"] for r in rows(c, "SELECT option, COUNT(*) n FROM votes WHERE poll_id=? GROUP BY option", poll_id)}
    card["options"] = [dict(label=o["label"], votes=counts.get(o["label"], 0)) for o in card["options"]]


def handle(emp_id, card_id, action, value=None):
    card = channel.get_card(card_id)
    if not card:
        raise HTTPException(404, "card not found")
    if card.get("state") == "closed":
        raise HTTPException(409, "this card was already handled")
    if card.get("allowed") and emp_id not in card["allowed"]:
        raise HTTPException(403, "this button isn't for you")
    p = card.get("payload", {})
    audit(emp_id, f"button.{action}", card_id, {"value": value})

    if action == "leave_confirm":
        try:
            r = submit_leave(emp_id, p, "chat")
        except HRMSError as e:
            return channel.close_card(card, f"Couldn't submit: {e.detail}")
        return channel.close_card(card, f"Submitted ✓ Request #{r['id']} sent to {r['approver_name']} for approval.")

    if action == "leave_cancel":
        return channel.close_card(card, "Cancelled. Nothing was submitted.")

    if action in ("leave_approve", "leave_reject"):
        try:
            decide_leave(emp_id, p["request_id"], "approve" if action == "leave_approve" else "reject")
        except HRMSError as e:
            return channel.close_card(card, f"Not done: {e.detail}")
        return channel.get_card(card_id)  # decide_leave closed it

    if action == "handover_pickup":
        resolve_handover(emp_id, p["handover_id"])
        return channel.get_card(card_id)

    if action == "pulse_submit":
        score = int(value)
        if not 1 <= score <= 5:
            raise HTTPException(400, "score must be 1 to 5")
        iso = date.today().isocalendar()
        with db(BOT_DB) as c:  # team + week only: no emp_id is stored with the score
            c.execute("INSERT INTO pulse_responses(team,week,score) VALUES (?,?,?)", (user(emp_id)["team"], f"{iso[0]}-W{iso[1]:02d}", score))
        return channel.close_card(card, "Saved with your team and the week only. No name.")

    if action == "pref_toggle":
        col = {"wellness": "wellness_opt_in", "nudges": "nudges_stopped", "birthday": "birthday_opt_out"}.get(value)
        if not col:
            raise HTTPException(400, "value must be wellness, nudges or birthday")
        with db(BOT_DB) as c:
            c.execute(f"UPDATE preferences SET {col}=1-{col} WHERE emp_id=?", (emp_id,))
            if col == "wellness_opt_in" and not one(c, "SELECT wellness_opt_in FROM preferences WHERE emp_id=?", emp_id)["wellness_opt_in"]:
                c.execute("DELETE FROM reminders WHERE emp_id=?", (emp_id,))
        return card  # stays open; the UI reads the toggles from ui-state

    if action == "poll_vote":
        with db(BOT_DB) as c:
            c.execute("INSERT INTO votes VALUES (?,?,?) ON CONFLICT(poll_id, emp_id) DO UPDATE SET option=excluded.option",
                      (p["poll_id"], emp_id, value))
        _tally(card, p["poll_id"])
        return channel.update_card(card)

    if action == "nudge_find_day":
        d = date.today() + timedelta(days=3)
        while d.weekday() != 4:
            d += timedelta(days=1)
        channel.close_card(card, "Let's find you a day off ↓")
        for _ in range(4):  # first free Friday in the next 4 weeks
            try:
                leave_draft(emp_id, "CL", d.isoformat(), d.isoformat(), "Rest day (wellness nudge)")
                return card
            except HRMSError as e:
                err = e.detail
                d += timedelta(days=7)
        channel.dm(emp_id, f"I couldn't prepare that: {err}", source="Wellness Agent")
        return card

    if action in ("nudge_not_now", "nudge_stop"):
        with db(BOT_DB) as c:
            if action == "nudge_stop":
                c.execute("UPDATE preferences SET nudges_stopped=1 WHERE emp_id=?", (emp_id,))
            else:
                c.execute("UPDATE preferences SET nudge_snooze_until=? WHERE emp_id=?", ((date.today() + timedelta(days=28)).isoformat(), emp_id))
        return channel.close_card(card, "OK, I won't send these again." if action == "nudge_stop" else "Snoozed for 4 weeks.")

    if action == "checkin_submit":
        rating = int(value)
        with db(BOT_DB) as c:
            c.execute("INSERT INTO checkins(emp_id,rating,created_at) VALUES (?,?,?)", (emp_id, rating, now()))
        if rating <= 2:
            create_handover(emp_id, "checkin", f"One-month check-in rated {rating}/5. Worth a friendly conversation.")
            return channel.close_card(card, "Thanks for being honest. Someone from HR will reach out for a chat.")
        return channel.close_card(card, f"Thanks! You rated your first month {rating}/5.")

    raise HTTPException(400, f"unknown action {action}")


