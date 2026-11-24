"""/bot: chat API used by the web chat, plus admin endpoints for the HRKonnekt Console."""
import json
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from bot import actions, hrms_client, jobs, pipeline, policy_index
from bot.agent_api import TOKENS
from bot.hrms_client import HRMSError
from db import BOT_DB, db, one, rows

router = APIRouter(prefix="/bot", tags=["HRKonnekt bot"])


def visible(c, emp_id):
    u = one(c, "SELECT * FROM users WHERE emp_id=?", emp_id)
    if not u:
        raise HTTPException(404, "unknown user")
    convs = rows(c, "SELECT * FROM conversations WHERE id=? OR id='general'", f"dm-{emp_id}")
    convs += rows(c, """SELECT c.* FROM conversations c JOIN interest_groups g ON g.conversation_id=c.id
        JOIN group_members m ON m.group_id=g.id AND m.emp_id=? ORDER BY g.id""", emp_id)
    if u["role"] == "hr_admin":
        convs += rows(c, "SELECT * FROM conversations WHERE id='hr-private'")
    return convs


@router.get("/personas")
def personas():
    with db(BOT_DB) as c:
        return rows(c, "SELECT * FROM users ORDER BY demo_order, name")


@router.get("/conversations")
def conversations(emp_id: int):
    with db(BOT_DB) as c:
        return visible(c, emp_id)


@router.get("/conversations/{conv_id}/messages")
def messages(conv_id: str, emp_id: int):
    with db(BOT_DB) as c:
        if conv_id not in {v["id"] for v in visible(c, emp_id)}:
            raise HTTPException(403, "not a member of this conversation")
        ms = rows(c, "SELECT * FROM (SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 200) ORDER BY id", conv_id)
    return _clean(ms, emp_id)


def _clean(ms, emp_id):
    """Cards lose their payload and allow-list; the viewer gets can_act instead."""
    for m in ms:
        card = json.loads(m.pop("card_json")) if m.get("card_json") else None
        if card:
            card.pop("payload", None)
            card["can_act"] = not card.get("allowed") or emp_id in card["allowed"]
            card.pop("allowed", None)
        m["card"] = card
    return ms


@router.get("/ui-state")
def ui_state(emp_id: int):
    """Everything the KonnektHRMS web + chat bubble needs, in one poll. ponytail: one big read every 3s; split per page if it gets slow."""
    with db(BOT_DB) as c:
        me = one(c, "SELECT * FROM users WHERE emp_id=?", emp_id)
        if not me:
            raise HTTPException(404, "unknown user")
        convs = visible(c, emp_id)
        ids = [v["id"] for v in convs]
        ms = rows(c, f"""SELECT * FROM (SELECT * FROM messages WHERE conversation_id IN ({','.join('?' * len(ids))})
            ORDER BY id DESC LIMIT 400) ORDER BY id""", *ids)
        groups = {}
        for r in rows(c, "SELECT g.slug, m.emp_id FROM interest_groups g LEFT JOIN group_members m ON m.group_id=g.id"):
            groups.setdefault(r["slug"], []).extend([r["emp_id"]] if r["emp_id"] else [])
        prefs = one(c, "SELECT * FROM preferences WHERE emp_id=?", emp_id)
        reminders = rows(c, "SELECT kind, every_minutes, active FROM reminders WHERE emp_id=?", emp_id)
        usage = {a: one(c, "SELECT COUNT(*) n FROM audit_log WHERE actor=? AND action LIKE 'tool.%'", f"agent:{a}")["n"]
                 for a in ("hr", "bonding", "wellness")}
        usage["guard"] = one(c, "SELECT COUNT(*) n FROM handovers WHERE category IN ('posh','grievance','termination','pay_dispute','crisis')")["n"]
        users = rows(c, "SELECT emp_id, name, role, team, demo_order FROM users ORDER BY demo_order, name")
    return dict(
        me=me, users=users, conversations=convs, messages=_clean(ms, emp_id),
        employees=hrms_client.get("/employees"), balances=hrms_client.get("/leave/balances/all"),
        requests=hrms_client.get("/leave/requests"), holidays=hrms_client.get("/holidays", all_years=True),
        announcements=hrms_client.get("/announcements"), attendance_today=hrms_client.get("/attendance/day"),
        handovers=handovers(), unanswered=unanswered(), pulse=pulse(), groups=groups,
        prefs=prefs, reminders=reminders, audit=audit_log(30), usage=usage, config=config())


class LeaveApplyIn(BaseModel):
    emp_id: int
    leave_type: str
    start_date: str
    end_date: str
    reason: str = ""


@router.post("/leave/apply")
def leave_apply(body: LeaveApplyIn):
    """Apply from KonnektHRMS web: same request + manager card as a chat Confirm."""
    try:
        return actions.submit_leave(body.emp_id, body.model_dump(), "hrms")
    except HRMSError as e:
        raise HTTPException(e.status, e.detail)


class DecideIn(BaseModel):
    approver_id: int
    decision: str  # approve | reject


@router.post("/leave/{req_id}/decide")
def leave_decide(req_id: int, body: DecideIn):
    if body.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be approve or reject")
    try:
        return actions.decide_leave(body.approver_id, req_id, body.decision)
    except HRMSError as e:
        raise HTTPException(e.status, e.detail)


class MessageIn(BaseModel):
    emp_id: int
    conversation_id: str
    text: str


@router.post("/messages")
def post_message(body: MessageIn):
    if not body.text.strip():
        raise HTTPException(400, "empty message")
    pipeline.handle(body.emp_id, body.conversation_id, body.text.strip())
    return {"ok": True}


class ActionIn(BaseModel):
    emp_id: int
    card_id: int
    action: str
    value: str | int | None = None


@router.post("/actions")
def post_action(body: ActionIn):
    actions.handle(body.emp_id, body.card_id, body.action, body.value)
    return {"ok": True}


@router.post("/jobs/{name}/run")
def run_job(name: str):
    if name not in jobs.JOBS:
        raise HTTPException(404, f"unknown job; try one of {list(jobs.JOBS)}")
    return jobs.run(name)


@router.post("/reset")
def reset():
    import seed
    seed.main()
    TOKENS.clear()
    policy_index.clear()
    return {"ok": True}


# ---------- admin (Console) ----------
@router.get("/admin/handovers")
def handovers():
    with db(BOT_DB) as c:
        return rows(c, """SELECT h.*, u.name AS employee_name, u.department, a.name AS assigned_name FROM handovers h
            LEFT JOIN users u ON u.emp_id=h.emp_id LEFT JOIN users a ON a.emp_id=h.assigned_to ORDER BY h.id DESC""")


class ResolveIn(BaseModel):
    hr_id: int


@router.post("/admin/handovers/{hid}/resolve")
def resolve(hid: int, body: ResolveIn):
    actions.resolve_handover(body.hr_id, hid)
    return {"ok": True}


@router.get("/admin/unanswered")
def unanswered():
    with db(BOT_DB) as c:
        return rows(c, "SELECT * FROM unanswered_questions ORDER BY status='open' DESC, times_asked DESC, id DESC")


@router.get("/admin/pulse")
def pulse():
    """Team averages per week; hidden when fewer than 5 answers (anonymity floor)."""
    with db(BOT_DB) as c:
        data = rows(c, "SELECT team, week, ROUND(AVG(score),2) AS avg, COUNT(*) AS n FROM pulse_responses GROUP BY team, week ORDER BY week, team")
    for d in data:
        if d["n"] < 5:
            d["avg"] = None
    return data


@router.get("/admin/audit")
def audit_log(limit: int = 50):
    with db(BOT_DB) as c:
        return rows(c, "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", limit)


@router.get("/admin/config")
def config():
    return dict(force_offline=os.getenv("FORCE_OFFLINE", "0") == "1",
                agents={a: bool(os.getenv(f"{a.upper()}_AGENT_URL", "").strip()) for a in ("hr", "bonding", "wellness")},
                jobs=list(jobs.JOBS))


class OfflineIn(BaseModel):
    force_offline: bool


@router.post("/admin/offline")
def set_offline(body: OfflineIn):
    os.environ["FORCE_OFFLINE"] = "1" if body.force_offline else "0"
    return config()
