"""Timed jobs. Fixed rules pick who gets what. Demo: triggered from the Console's Run-now buttons."""
import json
from datetime import date, timedelta

from bot import actions, channel, hrms_client
from db import BOT_DB, audit, db, now, one, rows


def _today_md(d):
    return d[5:] == date.today().isoformat()[5:]


def birthdays():
    with db(BOT_DB) as c:
        out = {r["emp_id"] for r in rows(c, "SELECT emp_id FROM preferences WHERE birthday_opt_out=1")}
    sent = []
    for e in hrms_client.get("/employees"):
        if _today_md(e["dob"]) and e["id"] not in out:
            channel.post("general", f"🎂 Happy birthday, {e['name']}! Wishing you a wonderful year from everyone at DotKonnekt.", source="Bonding")
            sent.append(e["name"])
    return sent


def anniversaries():
    sent = []
    for e in hrms_client.get("/employees"):
        years = date.today().year - int(e["date_of_joining"][:4])
        if _today_md(e["date_of_joining"]) and years >= 1:
            channel.post("general", f"🎉 {e['name']} completes {years} year{'s' if years > 1 else ''} at DotKonnekt today! Thank you, {e['first_name']}.", source="Bonding")
            sent.append(e["name"])
    return sent


def checkins():
    target = (date.today() - timedelta(days=30)).isoformat()
    sent = []
    for e in hrms_client.get("/employees"):
        if e["date_of_joining"] == target:
            channel.dm(e["id"], card=dict(
                kind="checkin", title=f"One month at DotKonnekt 🎉",
                lines=[f"Hi {e['first_name']}, you joined 30 days ago. How has your first month been?", "Your answer goes to HR only."],
                buttons=[dict(label=f"{n} {f}", action="checkin_submit", value=n) for n, f in ((1, "😞"), (2, "😕"), (3, "😐"), (4, "🙂"), (5, "😄"))],
                allowed=[e["id"]]), source="HR Agent")
            sent.append(e["name"])
    return sent


def leave_nudges():
    today = date.today()
    with db(BOT_DB) as c:
        prefs = rows(c, "SELECT * FROM preferences WHERE wellness_opt_in=1 AND nudges_stopped=0")
    sent = []
    for p in prefs:
        if p["nudge_snooze_until"] and p["nudge_snooze_until"] > today.isoformat():
            continue
        past = [r["end_date"] for r in hrms_client.get("/leave/requests", emp_id=p["emp_id"], status="approved") if r["end_date"] < today.isoformat()]
        if not past:
            continue
        gap = (today - date.fromisoformat(max(past))).days
        if gap >= 90:
            u = actions.user(p["emp_id"])
            channel.dm(p["emp_id"], card=dict(
                kind="nudge", title="Time for a break? 🌿",
                lines=[f"Hi {u['name'].split()[0]}, it's been {gap} days since your last day off. Rest helps you do your best work.",
                       "Only you can see this message."],
                buttons=[dict(label="Find me a day", action="nudge_find_day", style="primary"),
                         dict(label="Not now", action="nudge_not_now"), dict(label="Stop these", action="nudge_stop")],
                allowed=[p["emp_id"]]), source="Wellness Agent")
            sent.append(u["name"])
    return sent


def badminton_poll():
    options = ["Thu 7pm", "Fri 7pm", "Sat 10am"]
    with db(BOT_DB) as c:
        g = one(c, "SELECT * FROM interest_groups WHERE slug='badminton'")
        members = [r["emp_id"] for r in rows(c, "SELECT emp_id FROM group_members WHERE group_id=?", g["id"])]
        c.execute("UPDATE polls SET status='closed' WHERE group_id=? AND status='open'", (g["id"],))
        pid = c.execute("INSERT INTO polls(group_id,question,options_json,status,created_at) VALUES (?,?,?,'open',?)",
                        (g["id"], "Badminton this week? 🏸", json.dumps(options), now())).lastrowid
    mid = channel.post("badminton", card=dict(
        kind="poll", title="Badminton this week? 🏸", lines=[f"{len(members)} members · pick a slot, votes update live"],
        options=[dict(label=o, votes=0) for o in options],
        buttons=[dict(label=o, action="poll_vote", value=o) for o in options],
        allowed=members, payload=dict(poll_id=pid)), source="Bonding")
    with db(BOT_DB) as c:
        c.execute("UPDATE polls SET message_id=? WHERE id=?", (mid, pid))
    return [f"poll #{pid} to {len(members)} members"]


def pulse():
    """Weekly anonymous 1-5 question to everyone opted in to wellness. Answers are stored by team + week only."""
    with db(BOT_DB) as c:
        people = rows(c, "SELECT u.emp_id, u.name FROM users u JOIN preferences p ON p.emp_id=u.emp_id WHERE p.wellness_opt_in=1")
    for u in people:
        channel.dm(u["emp_id"], "Weekly pulse: how was your week? It's anonymous. Your manager only sees the team average.", card=dict(
            kind="pulse", title="How was your week?",
            buttons=[dict(label=f"{n} {w}", action="pulse_submit", value=n) for n, w in ((1, "Rough"), (2, "Meh"), (3, "Okay"), (4, "Good"), (5, "Great"))],
            allowed=[u["emp_id"]]), source="Wellness Agent")
    return [f"{len(people)} people opted in to wellness"]


JOBS = {"birthdays": birthdays, "anniversaries": anniversaries, "checkins": checkins,
        "leave_nudges": leave_nudges, "pulse": pulse, "badminton_poll": badminton_poll}


def run(name):
    result = JOBS[name]()
    audit("scheduler", f"job.{name}", "", {"sent": result})
    return {"job": name, "sent": result}
