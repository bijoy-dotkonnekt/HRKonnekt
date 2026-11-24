"""Typed message → identity → guard → router → one external agent (offline stub as fallback)."""
import logging
import os
import re
from datetime import date

import httpx

from bot import actions, channel, offline_agent
from bot.agent_api import issue_token
from db import BOT_DB, audit, db, one, rows

log = logging.getLogger("hrkonnekt")

# Guard: sensitive topics never reach an agent. ponytail: word list only; add a small-model yes/no check later.
SENSITIVE = {
    "posh": r"harass|sexual|inappropriate(ly)? touch|stalk|posh",
    "grievance": r"grievance|complain(t)? (about|against)|bull(y|ied|ying)|discriminat|retaliat|toxic manager|abus(e|ive)",
    "termination": r"terminat|fired|firing me|layoff|laid off|let go|pip\b|performance improvement plan",
    "pay_dispute": r"underpaid|pay dispute|salary dispute|not paid|wrong salary|salary (is )?(wrong|short|less)",
    "crisis": r"suicid|kill myself|self[- ]harm|end my life|want to die|can'?t go on|panic attack|breakdown",
    "human": r"talk to (a |an )?(human|person|someone in hr|hr)|speak to (a |an )?(human|person|hr)|real person",
}
GUARD_REPLY = ("This sounds important, so I've passed it privately to our HR team. A person from HR will reach out to you "
               "directly. I haven't sent your message to any AI.")
CRISIS_EXTRA = " If you're in immediate danger, please contact local emergency services or someone you trust right now."

# Router: keywords pick one agent; everything else goes to HR. ponytail: keyword-only; add a small model for unclear cases.
ROUTES = [
    ("wellness", r"remind|water|walk|stretch|mood|feeling|wellness|opt[ -]?(in|out)|my data|about me|last (took |taken |take )?(a )?(leave|day off|break)|leave gap|burn ?out"),
    ("bonding", r"badminton|cricket|book club|reading|running|board game|group|club|birthday|poll|activit|events?\b|hobb"),
]
LABEL = {"hr": "HR Agent", "bonding": "Bonding Agent", "wellness": "Wellness Agent"}


def guard(text):
    t = text.lower()
    return next((cat for cat, rx in SENSITIVE.items() if re.search(rx, t)), None)


def route(text):
    t = text.lower()
    return next((agent for agent, rx in ROUTES if re.search(rx, t)), "hr")


def call_agent(agent, payload):
    url = os.getenv(f"{agent.upper()}_AGENT_URL", "").strip()
    if url and os.getenv("FORCE_OFFLINE", "0") != "1":
        try:
            r = httpx.post(url, json={**payload, "agent": agent}, timeout=float(os.getenv("AGENT_TIMEOUT", "20")))
            r.raise_for_status()
            try:
                data = r.json()
                if isinstance(data, dict):
                    reply = data.get("reply") or data.get("output") or data.get("text") or data.get("response")
                else:
                    reply = str(data)
            except ValueError:
                reply = r.text
            if reply:
                return str(reply), LABEL[agent]
        except Exception as e:  # any failure → offline answer for this message
            log.warning("agent %s failed, using offline: %s", agent, e)
            audit("system", "agent.fallback", agent, {"error": str(e)[:200]})
    return offline_agent.run(agent, payload), f"{LABEL[agent]} · offline"


def history(conversation_id, limit=6):
    with db(BOT_DB) as c:
        msgs = rows(c, """SELECT sender, sender_emp_id, text FROM messages WHERE conversation_id=? AND text!=''
            ORDER BY id DESC LIMIT ?""", conversation_id, limit + 1)[1:]
    return [{"role": "user" if m["sender_emp_id"] else "assistant", "text": m["text"]} for m in reversed(msgs)]


def handle(emp_id, conversation_id, text):
    me = actions.user(emp_id)  # identity comes from the persona/session, never from message text
    if not me:
        raise ValueError("unknown user")
    channel.post(conversation_id, text, sender=me["name"], sender_emp_id=emp_id)
    with db(BOT_DB) as c:
        conv = one(c, "SELECT * FROM conversations WHERE id=?", conversation_id)
    if not conv or conv["type"] != "dm" or conv["member_emp_id"] != emp_id:
        return  # channels are people talking; the bot only answers in a person's own DM

    cat = guard(text)
    if cat:
        audit(emp_id, "guard.sensitive", conversation_id, {"category": cat})
        actions.create_handover(emp_id, cat, text)
        channel.dm(emp_id, GUARD_REPLY + (CRISIS_EXTRA if cat == "crisis" else ""), source="Guard → HR")
        return

    agent = route(text)
    payload = dict(
        message=text, history=history(conversation_id), today=date.today().isoformat(),
        user=dict(name=me["name"], role=me["role"], department=me["department"], designation=me["designation"]),
        api_base_url=os.getenv("PUBLIC_API_BASE_URL", "http://localhost:8000/api/me"),
        api_token=issue_token(emp_id, agent),
    )
    audit(emp_id, "router.route", agent)
    try:
        reply, source = call_agent(agent, payload)
    except Exception as e:
        log.exception("offline agent failed")
        reply, source = f"Sorry, something went wrong on my side ({e.__class__.__name__}). Please try again.", "System"
    channel.dm(emp_id, reply, source=source)
