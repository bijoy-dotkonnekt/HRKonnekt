"""End-to-end demo check against a running server (offline agents). Run: python backend/test_bot.py
Resets the demo data first."""
from datetime import date, timedelta

import httpx

B = "http://localhost:8000"
SHAB, LEKHA, VAISH, ARJUN = 10, 8, 15, 16


def say(emp, text):
    httpx.post(f"{B}/bot/messages", json=dict(emp_id=emp, conversation_id=f"dm-{emp}", text=text), timeout=30).raise_for_status()
    return msgs(emp)[-1]


def msgs(emp, conv=None):
    return httpx.get(f"{B}/bot/conversations/{conv or f'dm-{emp}'}/messages", params=dict(emp_id=emp)).json()


def tap(emp, card_id, action, value=None):
    return httpx.post(f"{B}/bot/actions", json=dict(emp_id=emp, card_id=card_id, action=action, value=value), timeout=30)


def cl(emp):
    return next(b for b in httpx.get(f"{B}/hrms/leave/balances", params=dict(emp_id=emp)).json() if b["leave_type"] == "CL")


httpx.post(f"{B}/bot/reset", timeout=60).raise_for_status()

r = say(SHAB, "how many casual leaves do I have?")
assert "4 casual leave" in r["text"] and "Source: Leave Policy" in r["text"], r

r = say(SHAB, "Can I carry forward casual leave?")
assert "Leave Policy §" in r["text"], r

before = len(httpx.get(f"{B}/bot/admin/unanswered").json())
r = say(SHAB, "Do we get a gym membership?")
assert "don't know" in r["text"], r
assert len(httpx.get(f"{B}/bot/admin/unanswered").json()) == before + 1

r = say(SHAB, "when is the next holiday")
assert "next company holiday" in r["text"], r

d = date.today() + timedelta(days=7)
while d.weekday() > 2:  # Mon-Wed so d and d+1 are both workdays
    d += timedelta(days=1)
e = d + timedelta(days=1)
r = say(SHAB, f"apply casual leave from {d.day} {d:%b} to {e.day} {e:%b}")
assert "tap Confirm" in r["text"], r
card = next(m["card"] for m in reversed(msgs(SHAB)) if m["card"] and m["card"]["kind"] == "leave_confirm")
assert tap(LEKHA, card["id"], "leave_confirm").status_code == 403  # not Lekha's button
assert tap(SHAB, card["id"], "leave_confirm").status_code == 200
assert tap(SHAB, card["id"], "leave_confirm").status_code == 409  # card closed, no double submit
assert cl(SHAB)["pending"] == 2
appr = next(m["card"] for m in reversed(msgs(LEKHA)) if m["card"] and m["card"]["kind"] == "leave_approval")
assert tap(LEKHA, appr["id"], "leave_approve").status_code == 200
b = cl(SHAB)
assert b["available"] == 2 and b["used"] == 10, b
assert "approved" in msgs(SHAB)[-1]["card"]["title"]

r = say(SHAB, "I want to report harassment by a colleague")
assert "HR team" in r["text"] and r["source"].startswith("Guard"), r
assert msgs(VAISH, "hr-private")[-1]["card"]["kind"] == "handover"

r = say(ARJUN, "join badminton")
assert "joined Badminton" in r["text"], r
r = say(SHAB, "remind me to drink water every 45 minutes")
assert "45 minutes" in r["text"] and "Wellness" in r["source"], r

jobs = {j: httpx.post(f"{B}/bot/jobs/{j}/run", timeout=60).json()["sent"] for j in httpx.get(f"{B}/bot/admin/config").json()["jobs"]}
assert jobs["birthdays"] == ["Sneha Iyer"], jobs
assert jobs["anniversaries"] == ["Karthik Reddy"], jobs
assert jobs["checkins"] == ["Arjun Nair"], jobs
assert "Shabarish N P" in jobs["leave_nudges"], jobs  # last leave TAKEN was ~100 days ago
assert jobs["pulse"], jobs
print("jobs:", jobs)

# pulse answer is stored by team + week only
pc = next(m["card"] for m in reversed(msgs(SHAB)) if m["card"] and m["card"]["kind"] == "pulse")
n0 = sum(p["n"] for p in httpx.get(f"{B}/bot/admin/pulse").json())
assert tap(SHAB, pc["id"], "pulse_submit", 4).status_code == 200
assert sum(p["n"] for p in httpx.get(f"{B}/bot/admin/pulse").json()) == n0 + 1

# payslip card: amounts on the card, the agent's reply has none
r = say(SHAB, "show my payslip")
ps = next(m["card"] for m in reversed(msgs(SHAB)) if m["card"] and m["card"]["kind"] == "payslip")
assert ps["net"] > 0 and "₹" not in r["text"] and not any(ch.isdigit() for ch in r["text"]), r

# my-data card + toggle
r = say(SHAB, "What do you know about me?")
md = next(m["card"] for m in reversed(msgs(SHAB)) if m["card"] and m["card"]["kind"] == "my_data")
assert tap(SHAB, md["id"], "pref_toggle", "birthday").status_code == 200
assert httpx.get(f"{B}/bot/ui-state", params=dict(emp_id=SHAB)).json()["prefs"]["birthday_opt_out"] == 1

# apply from HRMS web -> card in Lekha's chat; decide from HRMS web -> Shabarish told, chat card closed
d2 = d + timedelta(days=14)
while d2.weekday() > 4:
    d2 += timedelta(days=1)
lr = httpx.post(f"{B}/bot/leave/apply", json=dict(emp_id=SHAB, leave_type="SL", start_date=d2.isoformat(), end_date=d2.isoformat())).json()
appr = next(m["card"] for m in reversed(msgs(LEKHA)) if m["card"] and m["card"]["kind"] == "leave_approval")
assert appr["state"] == "open"
assert httpx.post(f"{B}/bot/leave/{lr['id']}/decide", json=dict(approver_id=LEKHA, decision="approve")).status_code == 200
assert next(m["card"] for m in msgs(LEKHA) if m["id"] == appr["id"])["state"] == "closed"
assert "approved" in msgs(SHAB)[-1]["card"]["title"]

# holidays: add one, the bot sees it
hd = (date.today() + timedelta(days=2)).isoformat()
assert httpx.post(f"{B}/hrms/holidays", json=dict(day=hd, name="Hackathon Day")).status_code == 200
assert "Hackathon Day" in say(SHAB, "next holiday?")["text"]
assert httpx.delete(f"{B}/hrms/holidays/{hd}").status_code == 200

# Console resolve closes the #hr-private card and tells the employee
h = next(x for x in httpx.get(f"{B}/bot/admin/handovers").json() if x["status"] == "open" and x["emp_id"] == SHAB)
assert httpx.post(f"{B}/bot/admin/handovers/{h['id']}/resolve", json=dict(hr_id=VAISH)).status_code == 200
assert "picked up" in msgs(SHAB)[-1]["text"]
assert all(m["card"]["state"] == "closed" for m in msgs(VAISH, "hr-private") if m["card"] and m["card"]["kind"] == "handover" and str(h["id"]) in m["card"]["title"])
print("ALL DEMO CHECKS PASSED")
