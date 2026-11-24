"""/api/me/* — what the agents' tools call. The bearer token decides WHO (emp_id) and WHICH agent; inputs never do."""
import secrets
import time
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from bot import actions, hrms_client, policy_index
from bot.hrms_client import HRMSError
from db import BOT_DB, audit, db, now, one, rows

router = APIRouter(prefix="/api/me", tags=["Agent tools API"])
TOKENS = {}  # token -> (emp_id, agent, expires_at). ponytail: in-memory; move to a store if we run >1 process
TTL = 300
ALLOW = {
    "hr": {"profile", "leave_balance", "leave_requests", "holidays", "policy_search", "leave_request_create", "handover", "unanswered", "payslip_card", "team_leave"},
    "bonding": {"profile", "groups", "group_join", "group_leave", "birthday_pref", "activities"},
    "wellness": {"profile", "leave_gap", "my_data", "reminders", "reminders_pause", "wellness_opt_in", "mood", "my_data_card"},
}


def issue_token(emp_id, agent):
    t = secrets.token_urlsafe(24)
    TOKENS[t] = (emp_id, agent, time.time() + TTL)
    return t


def caller(tool):
    def dep(authorization: str = Header("", description="Bearer <api_token from the agent request>")):
        v = TOKENS.get(authorization.removeprefix("Bearer ").strip())
        if not v or v[2] < time.time():
            raise HTTPException(401, "missing or expired api_token")
        emp_id, agent, _ = v
        if tool not in ALLOW[agent]:
            audit(f"agent:{agent}", f"tool.refused.{tool}", emp_id)
            raise HTTPException(403, f"the {agent} agent may not call {tool}")
        audit(f"agent:{agent}", f"tool.{tool}", emp_id)
        return emp_id
    return Depends(dep)


def hrms(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except HRMSError as e:
        raise HTTPException(e.status, e.detail)


# ---------- common ----------
@router.get("/profile", summary="Caller's own profile (no salary)")
def profile(emp_id=caller("profile")):
    e = hrms(hrms_client.get, f"/employees/{emp_id}")
    keep = ("name", "emp_code", "work_email", "designation", "department", "location", "manager_name", "date_of_joining", "status", "probation_end_date")
    return {k: e[k] for k in keep}


# ---------- HR ----------
@router.get("/leave/balance", summary="Caller's leave balances this year")
def leave_balance(emp_id=caller("leave_balance")):
    return hrms(hrms_client.get, "/leave/balances", emp_id=emp_id)


@router.get("/leave/requests", summary="Caller's leave requests")
def my_requests(emp_id=caller("leave_requests")):
    keep = ("id", "leave_type", "start_date", "end_date", "days", "status", "approver_name", "reason")
    return [{k: r[k] for k in keep} for r in hrms(hrms_client.get, "/leave/requests", emp_id=emp_id)][:10]


@router.get("/team/leave", summary="For managers: approved leave of the caller's direct reports in the next 7 days (names, dates and type only)")
def team_leave(emp_id=caller("team_leave")):
    today, week = date.today().isoformat(), (date.today() + timedelta(days=7)).isoformat()
    rs = hrms(hrms_client.get, "/leave/requests", approver_id=emp_id, status="approved")
    return [{k: r[k] for k in ("employee_name", "leave_type", "start_date", "end_date")} for r in rs if r["end_date"] >= today and r["start_date"] <= week]


@router.get("/holidays", summary="Upcoming company holidays")
def holidays(emp_id=caller("holidays")):
    return [{k: h[k] for k in ("date", "name", "type", "location")} for h in hrms(hrms_client.get, "/holidays", upcoming=True)]


@router.get("/policies/search", summary="Search policy sections; empty list = not covered")
def policy_search(q: str, emp_id=caller("policy_search")):
    return policy_index.search(q)


class LeaveDraft(BaseModel):
    leave_type: str = "CL"
    start_date: date
    end_date: date
    reason: str = ""


@router.post("/leave/requests", summary="Draft a leave request; shows the employee a Confirm card. Dates YYYY-MM-DD; types CL, SL, EL, COMP")
def leave_request_create(body: LeaveDraft, emp_id=caller("leave_request_create")):
    return hrms(actions.leave_draft, emp_id, body.leave_type.upper(), body.start_date.isoformat(), body.end_date.isoformat(), body.reason)


class Handover(BaseModel):
    summary: str
    category: str = "general"


@router.post("/handover", summary="Pass the conversation to a human in HR")
def handover(body: Handover, emp_id=caller("handover")):
    return {"handover_id": actions.create_handover(emp_id, body.category, body.summary)}


@router.post("/payslip-card", summary="Show the caller their latest payslip as a card. Amounts go to the employee's screen only; you get none back")
def payslip_card(emp_id=caller("payslip_card")):
    return {"shown": True, "month": hrms(actions.payslip_card, emp_id),
            "note": "The payslip card is on the employee's screen. Don't repeat or guess any amounts."}


class Question(BaseModel):
    question: str


@router.post("/unanswered", summary="Record a question no policy answers and hand it to HR")
def unanswered(body: Question, emp_id=caller("unanswered")):
    team = actions.user(emp_id)["team"]
    with db(BOT_DB) as c:
        ex = one(c, "SELECT id FROM unanswered_questions WHERE lower(question)=lower(?)", body.question)
        if ex:
            c.execute("UPDATE unanswered_questions SET times_asked=times_asked+1 WHERE id=?", (ex["id"],))
        else:
            c.execute("INSERT INTO unanswered_questions(question,team,times_asked,status,created_at) VALUES (?,?,1,'open',?)",
                      (body.question, team, now()))
    return {"handover_id": actions.create_handover(emp_id, "unanswered", body.question)}


# ---------- Bonding ----------
def _group(slug):
    with db(BOT_DB) as c:
        g = one(c, "SELECT * FROM interest_groups WHERE slug=? OR lower(name)=lower(?)", slug, slug)
    if not g:
        raise HTTPException(404, f"no group called {slug}")
    return g


@router.get("/groups", summary="Interest groups with member counts")
def groups(emp_id=caller("groups")):
    with db(BOT_DB) as c:
        return rows(c, """SELECT g.slug, g.name, COUNT(m.emp_id) AS members, MAX(m.emp_id=?) AS joined
            FROM interest_groups g LEFT JOIN group_members m ON m.group_id=g.id GROUP BY g.id ORDER BY g.id""", emp_id)


@router.post("/groups/{slug}/join", summary="Join an interest group")
def group_join(slug: str, emp_id=caller("group_join")):
    g = _group(slug)
    with db(BOT_DB) as c:
        c.execute("INSERT OR IGNORE INTO group_members VALUES (?,?,?)", (g["id"], emp_id, now()))
    return {"joined": g["name"], "channel": f"#{g['slug']}"}


@router.post("/groups/{slug}/leave", summary="Leave an interest group")
def group_leave(slug: str, emp_id=caller("group_leave")):
    g = _group(slug)
    with db(BOT_DB) as c:
        c.execute("DELETE FROM group_members WHERE group_id=? AND emp_id=?", (g["id"], emp_id))
    return {"left": g["name"]}


class BirthdayPref(BaseModel):
    show_birthday: bool


@router.post("/birthday-pref", summary="Opt in or out of birthday posts in #general")
def birthday_pref(body: BirthdayPref, emp_id=caller("birthday_pref")):
    with db(BOT_DB) as c:
        c.execute("UPDATE preferences SET birthday_opt_out=? WHERE emp_id=?", (0 if body.show_birthday else 1, emp_id))
    return {"show_birthday": body.show_birthday}


@router.get("/activities", summary="Open polls and plans in the caller's groups")
def activities(emp_id=caller("activities")):
    with db(BOT_DB) as c:
        return rows(c, """SELECT g.name AS group_name, p.question, p.status, p.winner, p.created_at FROM polls p
            JOIN interest_groups g ON g.id=p.group_id JOIN group_members m ON m.group_id=g.id AND m.emp_id=?
            ORDER BY p.created_at DESC LIMIT 5""", emp_id)


# ---------- Wellness ----------
@router.get("/leave-gap", summary="Days since the caller's last approved leave")
def leave_gap(emp_id=caller("leave_gap")):
    today = date.today().isoformat()
    past = [r for r in hrms(hrms_client.get, "/leave/requests", emp_id=emp_id, status="approved") if r["end_date"] < today]
    if not past:
        return {"last_leave_end": None, "days_since": None}
    last = max(r["end_date"] for r in past)
    return {"last_leave_end": last, "days_since": (date.today() - date.fromisoformat(last)).days}


@router.get("/my-data", summary="Everything HRKonnekt stores about the caller")
def my_data(emp_id=caller("my_data")):
    with db(BOT_DB) as c:
        return dict(
            preferences=one(c, "SELECT wellness_opt_in, birthday_opt_out, nudge_snooze_until, nudges_stopped FROM preferences WHERE emp_id=?", emp_id),
            groups=[r["name"] for r in rows(c, "SELECT g.name FROM group_members m JOIN interest_groups g ON g.id=m.group_id WHERE m.emp_id=?", emp_id)],
            reminders=rows(c, "SELECT kind, every_minutes, active FROM reminders WHERE emp_id=?", emp_id),
            pulse_note="Pulse answers are stored by team and week only, without your name, so they can't be shown back to you.",
        )


@router.post("/my-data-card", summary="Show the caller a card of what HRKonnekt stores, with toggles for wellness, nudges and birthday posts")
def my_data_card(emp_id=caller("my_data_card")):
    actions.my_data_card(emp_id)
    return {"shown": True}


class Reminder(BaseModel):
    kind: str = "water"
    every_minutes: int = 60


@router.post("/reminders", summary="Set a water or walk reminder (also opts in to wellness)")
def reminders(body: Reminder, emp_id=caller("reminders")):
    if body.kind not in ("water", "walk"):
        raise HTTPException(400, "kind must be water or walk")
    with db(BOT_DB) as c:
        c.execute("DELETE FROM reminders WHERE emp_id=? AND kind=?", (emp_id, body.kind))
        c.execute("INSERT INTO reminders(emp_id,kind,every_minutes) VALUES (?,?,?)", (emp_id, body.kind, max(15, body.every_minutes)))
        c.execute("UPDATE preferences SET wellness_opt_in=1 WHERE emp_id=?", (emp_id,))
    return {"kind": body.kind, "every_minutes": max(15, body.every_minutes)}


class Pause(BaseModel):
    kind: str = "all"


@router.post("/reminders/pause", summary="Stop water/walk reminders (kind=all for both)")
def reminders_pause(body: Pause, emp_id=caller("reminders_pause")):
    with db(BOT_DB) as c:
        c.execute("UPDATE reminders SET active=0 WHERE emp_id=? AND (?='all' OR kind=?)", (emp_id, body.kind, body.kind))
    return {"paused": body.kind}


class OptIn(BaseModel):
    opt_in: bool


@router.post("/wellness-opt-in", summary="Opt in/out of wellness features; opting out clears reminders and nudges")
def wellness_opt_in(body: OptIn, emp_id=caller("wellness_opt_in")):
    with db(BOT_DB) as c:
        c.execute("UPDATE preferences SET wellness_opt_in=? WHERE emp_id=?", (int(body.opt_in), emp_id))
        if not body.opt_in:
            c.execute("DELETE FROM reminders WHERE emp_id=?", (emp_id,))
    return {"wellness_opt_in": body.opt_in}


class Mood(BaseModel):
    score: int


@router.post("/mood", summary="Anonymous mood score 1-5 (stored by team + week, no name)")
def mood(body: Mood, emp_id=caller("mood")):
    if not 1 <= body.score <= 5:
        raise HTTPException(400, "score must be 1 to 5")
    iso = date.today().isocalendar()
    with db(BOT_DB) as c:
        c.execute("INSERT INTO pulse_responses(team,week,score) VALUES (?,?,?)",
                  (actions.user(emp_id)["team"], f"{iso[0]}-W{iso[1]:02d}", body.score))
    return {"saved": True}
