"""/bot: chat API and everything the KonnektHRMS web shows, plus the HRKonnekt Console. Every route needs a session."""
import json
import os
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import current_user, demo_password, hash_pw, profile, require
from bot import actions, channel, hrms_client, jobs, pipeline, policy_index
from bot.agent_api import TOKENS
from bot.hrms_client import HRMSError
from db import BOT_DB, audit, db, one, rows

router = APIRouter(prefix="/bot", tags=["HRKonnekt bot"])
hr_only = require("hr_admin")

AGENTS = [  # id, name, glyph
    dict(id="hr", name="HR agent", glyph="H"), dict(id="bonding", name="Bonding agent", glyph="B"),
    dict(id="wellness", name="Wellness agent", glyph="W"), dict(id="guard", name="Guard", glyph="G"),
]
SENSITIVE = ("posh", "grievance", "termination", "pay_dispute", "crisis")  # guard categories: the bot never answered these
SUGGESTIONS = {  # phrases the agents handle; picked by role
    "employee": ["How many leaves do I have left?", "Apply casual leave next Friday", "Show my payslip", "Upcoming holidays",
                 "Can I work from home on Fridays?", "Join running", "Remind me to drink water every 60 minutes",
                 "What do you know about me?", "Is there pet adoption leave?", "I'm being harassed by a colleague"],
    "newjoiner": ["How do I claim reimbursement?", "Can I carry forward casual leave?", "How many leaves do I have left?",
                  "I want to talk to someone in HR"],
    "manager": ["Who in my team is on leave this week?", "How many leaves do I have left?", "Upcoming holidays", "Join running"],
    "hr_admin": ["Upcoming holidays", "Can I carry forward casual leave?", "How many leaves do I have left?", "What do you know about me?"],
}
MINE = [dict(href="/hrms/employee/leave", label="My leave"), dict(href="/hrms/employee/payslips", label="My payslips"),
        dict(href="/hrms/employee/attendance", label="My attendance")]
NAV = {
    "employee": [dict(href="/hrms/employee", label="Home"), dict(href="/hrms/employee/leave", label="Leave"),
                 dict(href="/hrms/employee/payslips", label="Payslips"), dict(href="/hrms/employee/attendance", label="Attendance"),
                 dict(href="/hrms/employee/directory", label="Directory")],
    "manager": [dict(href="/hrms/manager", label="Approvals", badge="pending_approvals"), dict(href="/hrms/manager/team", label="Team"),
                dict(href="/hrms/manager/pulse", label="Pulse"), *MINE, dict(href="/hrms/employee/directory", label="Directory")],
    "hr_admin": [dict(href="/hrms/admin", label="HR dashboard"), dict(href="/hrms/admin/employees", label="Employees"),
                 dict(href="/hrms/admin/payroll", label="Payroll"), dict(href="/hrms/admin/holidays", label="Holidays"),
                 dict(href="/hrms/admin/policies", label="Policies"),
                 dict(href="/hrms/admin/console", label="HRKonnekt Console", badge="open_handovers"), *MINE],
}
REMINDER_LABEL = {"water": "Drink water", "walk": "Take a short walk"}
PREF_TOGGLES = [("wellness", "Wellness features"), ("nudges", "Leave nudges"), ("birthday", "Birthday post in #general")]
LEAVE_FORM = dict(start_offset_days=7, end_offset_days=8)


def agent_of(source):
    s = (source or "").lower()
    return "guard" if s.startswith("guard") else "bonding" if s.startswith("bonding") else "wellness" if s.startswith("wellness") else "hr"


def visible(c, emp_id):
    u = one(c, "SELECT * FROM users WHERE emp_id=?", emp_id)
    convs = rows(c, "SELECT * FROM conversations WHERE id=? OR id='general'", f"dm-{emp_id}")
    convs += rows(c, """SELECT c.* FROM conversations c JOIN interest_groups g ON g.conversation_id=c.id
        JOIN group_members m ON m.group_id=g.id AND m.emp_id=? ORDER BY g.id""", emp_id)
    if u["role"] == "hr_admin":
        convs += rows(c, "SELECT * FROM conversations WHERE id='hr-private'")
    return convs


def _clean(ms, emp_id):
    """Cards lose their payload and allow-list; the viewer gets can_act instead. Each message says which agent sent it."""
    for m in ms:
        card = json.loads(m.pop("card_json")) if m.get("card_json") else None
        if card:
            card.pop("payload", None)
            card["can_act"] = not card.get("allowed") or emp_id in card["allowed"]
            card.pop("allowed", None)
        m["card"] = card
        m["agent"] = None if m["sender_emp_id"] else agent_of(m["source"])
    return [m for m in ms if m["text"] or m["card"]]  # an empty reply slot is the bot still thinking


@router.get("/conversations")
def conversations(u=Depends(current_user)):
    with db(BOT_DB) as c:
        return visible(c, u["emp_id"])


@router.get("/conversations/{conv_id}/messages")
def messages(conv_id: str, u=Depends(current_user)):
    with db(BOT_DB) as c:
        if conv_id not in {v["id"] for v in visible(c, u["emp_id"])}:
            raise HTTPException(403, "not a member of this conversation")
        ms = rows(c, "SELECT * FROM (SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 200) ORDER BY id", conv_id)
    return _clean(ms, u["emp_id"])


# ---------- catalog ----------
@router.get("/meta")
def meta(u=Depends(current_user)):
    """Everything the UI would otherwise hardcode: labels, nav, jobs, agents, suggestions and company rules."""
    me = profile(u["emp_id"])
    co = hrms_client.get("/company")
    types = [dict(code=t["code"], label=t["short_name"], name=t["name"], letter=t["short_name"][0], note=t["note"])
             for t in hrms_client.get("/leave/types") if t["shown"]]
    role_key = "newjoiner" if me["role"] == "employee" and me["is_new_joiner"] else me["role"]
    return dict(
        company=dict(name=co["name"], email_domain=co["email_domain"], wfh_per_week=co["wfh_per_week"],
                     nudge_after_days=co["nudge_after_days"], pulse_min_answers=co["pulse_min_answers"]),
        leave_types=types, leave_form=dict(**LEAVE_FORM, default_type=types[0]["code"] if types else None),
        agents=AGENTS, jobs=jobs.info() if me["role"] == "hr_admin" else [],
        suggestions=SUGGESTIONS.get(role_key, SUGGESTIONS["employee"]),
        nav=NAV[me["role"]], home=me["home"],
        pulse=dict(min_answers=co["pulse_min_answers"], scale_max=5),
    )


# ---------- the one poll ----------
def _week(d):
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def pulse_rows(teams=None, weeks=7):
    """Weekly averages for `teams` (all when None), newest last. A team-week under the anonymity floor is left out of the average."""
    floor = hrms_client.get("/company")["pulse_min_answers"]
    with db(BOT_DB) as c:
        data = rows(c, "SELECT team, week, ROUND(AVG(score),2) AS avg, COUNT(*) AS n FROM pulse_responses GROUP BY team, week")
    if teams is not None:
        data = [d for d in data if d["team"] in teams]
    today = date.today()
    out = []
    for i in range(weeks - 1, -1, -1):
        d = today - timedelta(weeks=i)
        w, monday = _week(d), d - timedelta(days=d.weekday())
        ps = [p for p in data if p["week"] == w]
        shown = [p for p in ps if p["n"] >= floor]
        k = sum(p["n"] for p in shown)
        out.append(dict(week=w, label="This week" if i == 0 else f"{monday:%b} {monday.day}",
                        avg=round(sum(p["avg"] * p["n"] for p in shown) / k, 2) if k else None,
                        answers=sum(p["n"] for p in ps), shown=bool(k)))
    return out


def _request(r):
    return dict(id=str(r["id"]), empId=str(r["emp_id"]), employeeName=r["employee_name"], code=r["leave_type"],
                type=r["leave_type_short"], start=r["start_date"], end=r["end_date"], days=r["days"], reason=r["reason"] or "",
                status=r["status"], via="chat" if r["source"] == "chat" else "hrms",
                approverId=str(r["approver_id"]) if r["approver_id"] else None, approverName=r["approver_name"])


def _balances(list_):
    return [dict(code=b["leave_type"], type=b["short_name"], letter=b["short_name"][0], entitled=b["entitled"], taken=b["used"],
                 pending=b["pending"], left=b["available"]) for b in list_ if b["shown"]]


@router.get("/ui-state")
def ui_state(u=Depends(current_user)):
    """Everything the KonnektHRMS web + chat bubble needs, in one poll, scoped to what this person may see.
    ponytail: one big read every 3s; split per page if it gets slow."""
    emp_id, role = u["emp_id"], u["role"]
    me = profile(emp_id)
    hr = role == "hr_admin"
    with db(BOT_DB) as c:
        convs = visible(c, emp_id)
        ids = [v["id"] for v in convs]
        ms = rows(c, f"""SELECT * FROM (SELECT * FROM messages WHERE conversation_id IN ({','.join('?' * len(ids))})
            ORDER BY id DESC LIMIT 400) ORDER BY id""", *ids)
        groups = {}
        for r in rows(c, "SELECT g.slug, m.emp_id FROM interest_groups g LEFT JOIN group_members m ON m.group_id=g.id"):
            groups.setdefault(r["slug"], []).extend([str(r["emp_id"])] if r["emp_id"] else [])
        p = one(c, "SELECT * FROM preferences WHERE emp_id=?", emp_id) or {}
        reminders = rows(c, "SELECT kind, every_minutes FROM reminders WHERE emp_id=? AND active=1", emp_id)
        if hr:
            usage = {a: one(c, "SELECT COUNT(*) n FROM audit_log WHERE actor=? AND action LIKE 'tool.%'", f"agent:{a}")["n"] for a in ("hr", "bonding", "wellness")}
            usage["guard"] = one(c, f"SELECT COUNT(*) n FROM handovers WHERE category IN ({','.join('?' * len(SENSITIVE))})", *SENSITIVE)["n"]
            names = {str(r["emp_id"]): r["name"] for r in rows(c, "SELECT emp_id, name FROM users")}

    conv_out = []
    for v in convs:
        if v["type"] == "dm":
            conv_out.append(dict(id=v["id"], type="dm", name=v["name"], sub=v["description"]))
        else:
            sub = v["description"] or f"{len(groups.get(v['id'], []))} members"
            conv_out.append(dict(id=v["id"], type=v["type"], name=f"#{v['name']}", sub=sub))

    people = hrms_client.get("/employees")
    keep = ("id", "name", "designation", "department", "department_code", "location", "manager_id", "status", "date_of_joining")
    people = [dict(id=str(e["id"]), name=e["name"], title=e["designation"], dept=e["department"], team=e["department_code"],
                   location=e["location"], managerId=str(e["manager_id"]) if e["manager_id"] else None, status=e["status"],
                   **({"joined": e["date_of_joining"]} if hr else {})) for e in ({k: x[k] for k in keep} for x in people)]

    reqs = hrms_client.get("/leave/requests") if hr else (
        hrms_client.get("/leave/requests", emp_id=emp_id) + hrms_client.get("/leave/requests", approver_id=emp_id))
    seen, requests = set(), []
    for r in sorted(reqs, key=lambda r: -r["id"]):
        if r["id"] not in seen:
            seen.add(r["id"])
            requests.append(_request(r))

    if hr:
        bals = {str(k): _balances(v) for k, v in hrms_client.get("/leave/balances/all").items()}
    else:
        who = [emp_id] + ([int(e["id"]) for e in people if e["managerId"] == str(emp_id)] if role == "manager" else [])
        bals = {str(w): _balances(hrms_client.get("/leave/balances", emp_id=w)) for w in who}

    out = dict(
        me=me, people=people, requests=requests, balances=bals,
        messages=_clean(ms, emp_id), conversations=conv_out, groups=groups,
        prefs=dict(wellness=bool(p.get("wellness_opt_in")), nudges=not p.get("nudges_stopped"), birthday=not p.get("birthday_opt_out"),
                   toggles=[dict(key=k, label=l, on=dict(wellness=bool(p.get("wellness_opt_in")), nudges=not p.get("nudges_stopped"),
                                                         birthday=not p.get("birthday_opt_out"))[k]) for k, l in PREF_TOGGLES],
                   reminders=[f"{REMINDER_LABEL.get(r['kind'], r['kind'])}, every {r['every_minutes']} minutes" for r in reminders]),
        holidays=[dict(date=h["date"], name=h["name"]) for h in hrms_client.get("/holidays", all_years=True, location_id=me["location_id"])],
        announcements=[dict(title=a["title"], body=a["body"], at=a["posted_at"]) for a in hrms_client.get("/announcements")],
        team=hrms_client.get("/team/overview", manager_id=emp_id) if role == "manager" else None,
        pulse=dict(team=pulse_rows([me["team"]]) if role == "manager" else [], company=pulse_rows() if hr else []),
        handovers=[], unanswered=[], attendance_today={}, audit=[], usage=[], config=None,
        badges=dict(pending_approvals=sum(1 for r in requests if r["status"] == "pending" and r["approverId"] == str(emp_id)), open_handovers=0),
    )
    if hr:
        hs = handovers(u)
        out.update(
            handovers=[dict(id=str(h["id"]), empId=str(h["emp_id"]), employeeName=h["employee_name"], topic=h["summary"], category=h["category"],
                            sensitive=h["category"] in SENSITIVE, at=h["created_at"], status="open" if h["status"] == "open" else "resolved",
                            assignedName=h["assigned_name"]) for h in hs],
            unanswered=[dict(q=x["question"], count=x["times_asked"], team=x["team"]) for x in unanswered(u) if x["status"] == "open"],
            attendance_today={str(a["emp_id"]): dict(status=a["status"], label=a["label"]) for a in hrms_client.get("/attendance/day")},
            audit=[dict(at=a["created_at"], who=names.get(a["actor"], a["actor"]), what=f"{a['action']} {a['target'] or ''}".strip()) for a in audit_log(30, u)],
            usage=[dict(agent=a["id"], name=a["name"], count=usage[a["id"]], what="messages held back" if a["id"] == "guard" else "tool calls") for a in AGENTS],
            config=config(u),
        )
        out["badges"]["open_handovers"] = sum(1 for h in hs if h["status"] == "open")
    return out


# ---------- leave from the HRMS web ----------
class LeaveApplyIn(BaseModel):
    leave_type: str
    start_date: str
    end_date: str
    reason: str = ""


def _hrms_error(e):
    detail = e.detail if isinstance(e.detail, str) else "; ".join(x.get("msg", str(x)) for x in e.detail) if isinstance(e.detail, list) else str(e.detail)
    return HTTPException(e.status, detail)


@router.post("/leave/apply")
def leave_apply(body: LeaveApplyIn, u=Depends(current_user)):
    """Apply from KonnektHRMS web: same request + manager card as a chat Confirm."""
    try:
        return actions.submit_leave(u["emp_id"], body.model_dump(), "hrms")
    except HRMSError as e:
        raise _hrms_error(e)


class DecideIn(BaseModel):
    decision: str  # approve | reject


@router.post("/leave/{req_id}/decide")
def leave_decide(req_id: int, body: DecideIn, u=Depends(current_user)):
    if body.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be approve or reject")
    try:
        return actions.decide_leave(u["emp_id"], req_id, body.decision)
    except HRMSError as e:
        raise _hrms_error(e)


# ---------- chat ----------
class MessageIn(BaseModel):
    conversation_id: str
    text: str


@router.post("/messages")
def post_message(body: MessageIn, u=Depends(current_user)):
    if not body.text.strip():
        raise HTTPException(400, "empty message")
    pipeline.handle(u["emp_id"], body.conversation_id, body.text.strip())
    return {"ok": True}


class ActionIn(BaseModel):
    card_id: int
    action: str
    value: str | int | None = None


@router.post("/actions")
def post_action(body: ActionIn, u=Depends(current_user)):
    actions.handle(u["emp_id"], body.card_id, body.action, body.value)
    return {"ok": True}


# ---------- Console (HR admins) ----------
@router.post("/jobs/{name}/run")
def run_job(name: str, u=Depends(hr_only)):
    if name not in jobs.JOBS:
        raise HTTPException(404, f"unknown job; try one of {list(jobs.JOBS)}")
    return jobs.run(name)


@router.post("/reset")
def reset(u=Depends(hr_only)):
    """Re-seed everything. Sign-ins survive: sessions are copied over (employee ids are stable across seeds)."""
    import seed
    with db(BOT_DB) as c:
        sessions = rows(c, "SELECT * FROM sessions")
    seed.main()
    with db(BOT_DB) as c:
        c.executemany("INSERT INTO sessions VALUES (?,?,?)", [(s["token"], s["emp_id"], s["expires_at"]) for s in sessions])
    TOKENS.clear()
    policy_index.clear()
    return {"ok": True}


@router.get("/admin/handovers")
def handovers(u=Depends(hr_only)):
    with db(BOT_DB) as c:
        return rows(c, """SELECT h.*, u.name AS employee_name, u.department, a.name AS assigned_name FROM handovers h
            LEFT JOIN users u ON u.emp_id=h.emp_id LEFT JOIN users a ON a.emp_id=h.assigned_to ORDER BY h.id DESC""")


@router.post("/admin/handovers/{hid}/resolve")
def resolve(hid: int, u=Depends(hr_only)):
    actions.resolve_handover(u["emp_id"], hid)
    return {"ok": True}


@router.get("/admin/unanswered")
def unanswered(u=Depends(hr_only)):
    with db(BOT_DB) as c:
        return rows(c, "SELECT * FROM unanswered_questions ORDER BY status='open' DESC, times_asked DESC, id DESC")


@router.get("/admin/pulse")
def pulse(u=Depends(hr_only)):
    """Team averages per week; hidden when below the anonymity floor."""
    floor = hrms_client.get("/company")["pulse_min_answers"]
    with db(BOT_DB) as c:
        data = rows(c, "SELECT team, week, ROUND(AVG(score),2) AS avg, COUNT(*) AS n FROM pulse_responses GROUP BY team, week ORDER BY week, team")
    for d in data:
        if d["n"] < floor:
            d["avg"] = None
    return data


@router.get("/admin/audit")
def audit_log(limit: int = 50, u=Depends(hr_only)):
    with db(BOT_DB) as c:
        return rows(c, "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", limit)


@router.get("/admin/config")
def config(u=Depends(hr_only)):
    return dict(force_offline=os.getenv("FORCE_OFFLINE", "0") == "1",
                agents={a: bool(os.getenv(f"{a.upper()}_AGENT_URL", "").strip()) for a in ("hr", "bonding", "wellness")},
                jobs=list(jobs.JOBS))


class OfflineIn(BaseModel):
    force_offline: bool


@router.post("/admin/offline")
def set_offline(body: OfflineIn, u=Depends(hr_only)):
    os.environ["FORCE_OFFLINE"] = "1" if body.force_offline else "0"
    return config(u)


@router.get("/admin/employees/form-options")
def employee_form_options(u=Depends(hr_only)):
    return hrms_client.get("/employees/form-options")


@router.post("/admin/employees")
def add_employee(body: dict, u=Depends(hr_only)):
    """A new joiner: HRMS record, sign-in account (demo password), HRKonnekt DM and preferences, manager role if it's their first report."""
    try:
        e = hrms_client.post("/employees", body)
    except HRMSError as x:
        raise _hrms_error(x)
    role = "hr_admin" if e["is_hr_admin"] else "employee"
    with db(BOT_DB) as c:
        c.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,99,?)",
                  (e["id"], e["work_email"], e["name"], role, e["department"], e["department_code"], e["designation"],
                   e["manager_id"], e["avatar_color"], hash_pw(demo_password())))
        c.execute("UPDATE users SET role='manager' WHERE emp_id=? AND role='employee'", (e["manager_id"],))
        c.execute("INSERT INTO conversations VALUES (?,?,?,?,?)", (f"dm-{e['id']}", "dm", "HRKonnekt", e["id"], "Private. Your manager can't see this."))
        c.execute("INSERT INTO preferences(emp_id) VALUES (?)", (e["id"],))
    company = hrms_client.get("/company")["name"]
    channel.dm(e["id"], f"Hi {e['first_name']} 👋 Welcome to {company}! I'm HRKonnekt, your HR assistant. Ask me about leave, policies, "
                        "holidays, groups or wellness reminders.", source="HR Agent")
    audit(u["emp_id"], "user.create", e["id"], {"email": e["work_email"]})
    return dict(emp_id=str(e["id"]), emp_code=e["emp_code"], name=e["name"], work_email=e["work_email"],
                message=f"Account created for {e['name']}: {e['work_email']}. They can sign in now with the demo password.")


class PolicyIn(BaseModel):
    filename: str
    content: str


@router.post("/admin/policies")
def upload_policy(body: PolicyIn, u=Depends(hr_only)):
    """Add or replace a policy in KonnektHRMS; HRKonnekt re-reads the policies on the next question."""
    try:
        p = hrms_client.post("/policies", body.model_dump())
    except HRMSError as x:
        raise _hrms_error(x)
    policy_index.clear()
    return p
