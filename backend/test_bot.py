"""End-to-end demo check against a running server (offline agents). Run: python backend/test_bot.py
Signs in as the demo cast, resets the demo data first. Needs data seeded with sign-in accounts (python backend/seed.py)."""
import os
from datetime import date, timedelta

import httpx

B = os.getenv("HRK_TEST_BASE", "http://localhost:8000")
PW = os.getenv("DEMO_PASSWORD", "demo")
SHAB, LEKHA, VAISH, ARJUN = 10, 8, 15, 16
EMAIL = {SHAB: "shabarish", LEKHA: "lekha", VAISH: "vaishali", ARJUN: "arjun"}


def login(email, pw=PW):
    return httpx.post(f"{B}/auth/login", json=dict(email=email, password=pw))


def session(emp):
    r = login(f"{EMAIL[emp]}@dotkonnekt.example")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---- sign-in ----
assert login("shabarish@dotkonnekt.example", "wrong").status_code == 401
assert login("nobody@dotkonnekt.example").status_code == 401
assert httpx.get(f"{B}/bot/ui-state").status_code == 401  # no session
assert httpx.get(f"{B}/hrms/payslips", params=dict(emp_id=SHAB)).status_code == 401
H = {e: session(e) for e in EMAIL}
assert httpx.post(f"{B}/bot/reset", headers=H[SHAB], timeout=60).status_code == 403  # employees can't reset
assert httpx.post(f"{B}/bot/reset", headers=H[VAISH], timeout=60).status_code == 200  # sessions survive the reset
me = httpx.get(f"{B}/auth/me", headers=H[SHAB]).json()
assert me["role"] == "employee" and me["home"] == "/hrms/employee", me
assert httpx.get(f"{B}/auth/me", headers=H[ARJUN]).json()["is_new_joiner"] is True


def get(emp, path, **params):
    return httpx.get(f"{B}{path}", params=params, headers=H[emp], timeout=30)


def post(emp, path, body=None, **kw):
    return httpx.post(f"{B}{path}", json=body or {}, headers=H[emp], timeout=60, **kw)


def say(emp, text):
    post(emp, "/bot/messages", dict(conversation_id=f"dm-{emp}", text=text)).raise_for_status()
    ms = msgs(emp)
    asked = next(m for m in reversed(ms) if m["sender_emp_id"] == emp and m["text"] == text)
    after = [m for m in ms if m["id"] > asked["id"]]
    reply = next(m for m in after if m["text"])
    assert all(m["id"] > reply["id"] for m in after if m["card"]), "a card came before the agent's text"
    return reply


def msgs(emp, conv=None):
    return get(emp, f"/bot/conversations/{conv or f'dm-{emp}'}/messages").json()


def tap(emp, card_id, action, value=None):
    return post(emp, "/bot/actions", dict(card_id=card_id, action=action, value=value))


def cl(emp):
    return next(b for b in get(emp, "/hrms/leave/balances", emp_id=emp).json() if b["leave_type"] == "CL")


# ---- who may see what ----
assert get(SHAB, "/hrms/payslips", emp_id=LEKHA).status_code == 403  # not your payslip
assert get(LEKHA, "/hrms/payslips", emp_id=SHAB).status_code == 403  # managers can't see pay either
assert get(LEKHA, "/hrms/leave/balances", emp_id=SHAB).status_code == 200  # but can see their report's leave
assert get(SHAB, "/hrms/leave/balances", emp_id=LEKHA).status_code == 403
assert post(SHAB, f"/bot/jobs/pulse/run").status_code == 403
assert "phone" not in get(SHAB, "/hrms/employees").json()[0]  # directory only
st = get(SHAB, "/bot/ui-state").json()
assert st["handovers"] == [] and st["audit"] == [] and set(st["balances"]) == {str(SHAB)}, "employee sees only their own data"
meta = get(SHAB, "/bot/meta").json()
assert [t["code"] for t in meta["leave_types"]] == ["CL", "SL", "EL"] and meta["nav"][0]["href"] == "/hrms/employee", meta
assert get(VAISH, "/bot/meta").json()["jobs"], "HR gets the job list"

# ---- the chat demo ----
r = say(SHAB, "how many casual leaves do I have?")
assert "4 casual leave" in r["text"] and "Source: Leave Policy" in r["text"], r

r = say(SHAB, "Can I carry forward casual leave?")
assert "Leave Policy §" in r["text"], r

before = len(get(VAISH, "/bot/admin/unanswered").json())
r = say(SHAB, "Do we get a gym membership?")
assert "don't know" in r["text"], r
assert len(get(VAISH, "/bot/admin/unanswered").json()) == before + 1

r = say(SHAB, "when is the next holiday")
assert "next company holiday" in r["text"], r

d = date.today() + timedelta(days=7)
while d.weekday() > 2:  # Mon-Wed so d and d+1 are both workdays
    d += timedelta(days=1)
e = d + timedelta(days=1)
r = say(SHAB, f"apply casual leave from {d.day} {d:%b} to {e.day} {e:%b}")
assert "tap Confirm" in r["text"], r
card = next(m["card"] for m in reversed(msgs(SHAB)) if m["card"] and m["card"]["kind"] == "leave_confirm")
assert [b["action"] for b in card["buttons"]] == ["leave_confirm", "leave_cancel"], card  # cards carry their own buttons
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
assert "HR team" in r["text"] and r["source"].startswith("Guard") and r["agent"] == "guard", r
assert msgs(VAISH, "hr-private")[-1]["card"]["kind"] == "handover"
assert any(h["sensitive"] for h in get(VAISH, "/bot/ui-state").json()["handovers"])

r = say(ARJUN, "join badminton")
assert "joined Badminton" in r["text"], r
r = say(SHAB, "remind me to drink water every 45 minutes")
assert "45 minutes" in r["text"] and "Wellness" in r["source"], r
assert get(SHAB, "/bot/ui-state").json()["prefs"]["reminders"] == ["Drink water, every 45 minutes"]

jobs = {j: post(VAISH, f"/bot/jobs/{j}/run").json()["sent"] for j in get(VAISH, "/bot/admin/config").json()["jobs"]}
assert jobs["birthdays"] == ["Sneha Iyer"], jobs
assert jobs["anniversaries"] == ["Karthik Reddy"], jobs
assert jobs["checkins"] == ["Arjun Nair"], jobs
assert "Shabarish N P" in jobs["leave_nudges"], jobs  # last leave TAKEN was ~100 days ago
assert jobs["pulse"], jobs
print("jobs:", jobs)

# pulse answer is stored by team + week only
pc = next(m["card"] for m in reversed(msgs(SHAB)) if m["card"] and m["card"]["kind"] == "pulse")
n0 = sum(p["n"] for p in get(VAISH, "/bot/admin/pulse").json())
assert tap(SHAB, pc["id"], "pulse_submit", 4).status_code == 200
assert sum(p["n"] for p in get(VAISH, "/bot/admin/pulse").json()) == n0 + 1

# payslip card: amounts on the card, the agent's reply has none
r = say(SHAB, "show my payslip")
ps = next(m["card"] for m in reversed(msgs(SHAB)) if m["card"] and m["card"]["kind"] == "payslip")
assert ps["net"] > 0 and ps["earnings"][0][0] == "Basic" and "₹" not in r["text"] and not any(ch.isdigit() for ch in r["text"]), r

# my-data card + toggle
r = say(SHAB, "What do you know about me?")
md = next(m["card"] for m in reversed(msgs(SHAB)) if m["card"] and m["card"]["kind"] == "my_data")
assert tap(SHAB, md["id"], "pref_toggle", "birthday").status_code == 200
assert get(SHAB, "/bot/ui-state").json()["prefs"]["birthday"] is False

# leave preview: weekend inside the range isn't counted; too many days is refused
fri = date.today() + timedelta(days=21)
while fri.weekday() != 4:
    fri += timedelta(days=1)
pv = post(SHAB, "/hrms/leave/preview", dict(leave_type="SL", start_date=fri.isoformat(), end_date=(fri + timedelta(days=3)).isoformat())).json()
assert pv["ok"] and pv["days"] == 2, pv  # Fri + Mon
pv = post(SHAB, "/hrms/leave/preview", dict(leave_type="CL", start_date=fri.isoformat(), end_date=(fri + timedelta(days=14)).isoformat())).json()
assert not pv["ok"] and "only have" in pv["message"], pv

# apply from HRMS web -> card in Lekha's chat; decide from HRMS web -> Shabarish told, chat card closed
d2 = d + timedelta(days=14)
while d2.weekday() > 4:
    d2 += timedelta(days=1)
lr = post(SHAB, "/bot/leave/apply", dict(leave_type="SL", start_date=d2.isoformat(), end_date=d2.isoformat())).json()
appr = next(m["card"] for m in reversed(msgs(LEKHA)) if m["card"] and m["card"]["kind"] == "leave_approval")
assert appr["state"] == "open"
assert post(SHAB, f"/bot/leave/{lr['id']}/decide", dict(decision="approve")).status_code == 403  # not the approver
assert post(LEKHA, f"/bot/leave/{lr['id']}/decide", dict(decision="approve")).status_code == 200
assert next(m["card"] for m in msgs(LEKHA) if m["id"] == appr["id"])["state"] == "closed"
assert "approved" in msgs(SHAB)[-1]["card"]["title"]

# holidays: only HR can add; the bot sees it
hd = (date.today() + timedelta(days=2)).isoformat()
assert post(SHAB, "/hrms/holidays", dict(day=hd, name="Hackathon Day")).status_code == 403
assert post(VAISH, "/hrms/holidays", dict(day=hd, name="Hackathon Day")).status_code == 200
assert "Hackathon Day" in say(SHAB, "next holiday?")["text"]
assert httpx.delete(f"{B}/hrms/holidays/{hd}", headers=H[VAISH]).status_code == 200

# payroll lock persists
pr = get(VAISH, "/hrms/payroll").json()
assert pr["gross"] > 0 and pr["run"]["status"] == "open" and pr["last"]["net"] > 0, pr
assert get(SHAB, "/hrms/payroll").status_code == 403
assert post(VAISH, f"/hrms/payroll/{pr['run']['month']}/lock").json()["run"]["status"] == "locked"
assert get(VAISH, "/hrms/payroll").json()["run"]["locked_by"] == "Vaishali Umredkar"

# reimbursements: own only
assert all(x["emp_id"] == SHAB for x in get(SHAB, "/hrms/reimbursements").json())
assert get(SHAB, "/hrms/reimbursements", emp_id=LEKHA).status_code == 403

# Console resolve closes the #hr-private card and tells the employee
h = next(x for x in get(VAISH, "/bot/admin/handovers").json() if x["status"] == "open" and x["emp_id"] == SHAB)
assert post(LEKHA, f"/bot/admin/handovers/{h['id']}/resolve").status_code == 403
assert post(VAISH, f"/bot/admin/handovers/{h['id']}/resolve").status_code == 200
assert "picked up" in msgs(SHAB)[-1]["text"]
assert all(m["card"]["state"] == "closed" for m in msgs(VAISH, "hr-private") if m["card"] and m["card"]["kind"] == "handover" and str(h["id"]) in m["card"]["title"])

# HR adds a new joiner: they can sign in at once, their manager sees them, an employee can't add people
opts = get(VAISH, "/bot/admin/employees/form-options").json()
new = dict(first_name="Meera", last_name="Pillai", department_id=opts["departments"][0]["id"], designation="Software Engineer", grade="L3",
           manager_id=LEKHA, location_id=opts["locations"][0]["id"], date_of_joining=date.today().isoformat(), dob="1998-05-04", annual_ctc=1200000)
assert post(SHAB, "/bot/admin/employees", new).status_code == 403
nj = post(VAISH, "/bot/admin/employees", new).json()
assert nj["work_email"] == "meera.pillai@dotkonnekt.example", nj
tok = login(nj["work_email"]).json()
assert tok["me"]["is_new_joiner"] and tok["me"]["role"] == "employee", tok
assert any(p["name"] == "Meera Pillai" for p in get(LEKHA, "/bot/ui-state").json()["team"]["people"])
assert httpx.get(f"{B}/hrms/leave/balances", params=dict(emp_id=nj["emp_id"]), headers={"Authorization": f"Bearer {tok['token']}"}).json()[0]["available"] > 0
# HR uploads a policy; the bot answers from it straight away
md = "# Pet Policy\n\n## 1. Pet adoption leave\nEmployees get 2 days of paid pet adoption leave per year.\n"
assert post(SHAB, "/bot/admin/policies", dict(filename="pets.md", content=md)).status_code == 403
assert post(VAISH, "/bot/admin/policies", dict(filename="pets.txt", content=md)).status_code == 400
assert post(VAISH, "/bot/admin/policies", dict(filename="pets.md", content=md)).json()["sections"] == 1
assert get(SHAB, "/hrms/policies/pets").json()["sections"][0]["heading"] == "Pet adoption leave"
assert "Pet Policy" in say(SHAB, "Is there pet adoption leave?")["text"]
print("ALL DEMO CHECKS PASSED")
