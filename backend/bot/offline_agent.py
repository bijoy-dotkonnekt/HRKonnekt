"""Offline stand-ins for the three external agents. Same contract (payload in, reply out), and they call the
same /api/me tools over HTTP with the api_token, exactly like the real agents. Keyword rules, no AI."""
import re
from datetime import date, timedelta

import httpx

MONTHS = {m: i for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split(), start=1)}
DAYS = {d: i for i, d in enumerate("monday tuesday wednesday thursday friday saturday sunday".split())}
MON = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"


class Tools:
    def __init__(self, p):
        self.base, self.h = p["api_base_url"].rstrip("/"), {"Authorization": f"Bearer {p['api_token']}"}

    def get(self, path, **params):
        return httpx.get(self.base + path, params=params, headers=self.h, timeout=10)

    def post(self, path, json=None):
        return httpx.post(self.base + path, json=json or {}, headers=self.h, timeout=10)


def _future(d, today):
    return d if d >= today - timedelta(days=7) else d.replace(year=d.year + 1)


def parse_dates(text, today):
    """Return (start, end) or None. Handles today/tomorrow, weekdays, '26 nov', 'nov 26', '26-27 nov', ISO, 'for N days'."""
    t = text.lower()
    found = []
    for m in re.finditer(r"(\d{4})-(\d{2})-(\d{2})", t):
        found.append((m.start(), date(int(m[1]), int(m[2]), int(m[3]))))
    for m in re.finditer(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s*(?:-|–|to|and)\s*(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?{MON}", t):
        mo = MONTHS[m[3][:3]]
        found += [(m.start(), _future(date(today.year, mo, int(m[1])), today)), (m.start() + 1, _future(date(today.year, mo, int(m[2])), today))]
    for m in re.finditer(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?{MON}\b", t):
        if not any(abs(p - m.start()) < 8 for p, _ in found):
            found.append((m.start(), _future(date(today.year, MONTHS[m[2][:3]], int(m[1])), today)))
    for m in re.finditer(rf"\b{MON}\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", t):
        found.append((m.start(), _future(date(today.year, MONTHS[m[1][:3]], int(m[2])), today)))
    for m in re.finditer(r"\b(day after tomorrow|tomorrow|today)\b", t):
        found.append((m.start(), today + timedelta(days={"today": 0, "tomorrow": 1, "day after tomorrow": 2}[m[1]])))
    for m in re.finditer(r"\b(next\s+|this\s+|on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", t):
        ahead = (DAYS[m[2]] - today.weekday()) % 7 or 7
        found.append((m.start(), today + timedelta(days=ahead)))
    if not found:
        return None
    found.sort()
    start, end = found[0][1], found[-1][1]
    n = re.search(r"for\s+(\d+|a|one|two|three|four|five)\s+(?:working\s+)?days?", t)
    if n and start == end:
        k = {"a": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5}.get(n[1]) or int(n[1])
        while k > 1:
            end += timedelta(days=1)
            if end.weekday() < 5:
                k -= 1
    return (start, end) if end >= start else (end, start)


def fmt(d):
    return date.fromisoformat(d).strftime("%a %d %b") if isinstance(d, str) else d.strftime("%a %d %b")


# ---------------- HR ----------------
LEAVE_WORDS = {"CL": "casual", "SL": "sick", "EL": "earned", "COMP": "comp-off"}


def leave_type_of(t):
    if re.search(r"sick|unwell|fever|doctor|ill\b|medical", t):
        return "SL"
    if re.search(r"earned|privilege|vacation|\bel\b|\bpl\b", t):
        return "EL"
    if re.search(r"comp[- ]?off", t):
        return "COMP"
    return "CL"


def hr(p, tools):
    msg, t, today = p["message"], p["message"].lower(), date.fromisoformat(p["today"])
    wants_leave = re.search(r"\b(apply|take|book|request|need|want|plan)\b.*\b(leave|off|day off|holiday)\b|\bleave (on|from|for)\b|\bday off\b", t)
    if wants_leave and not re.search(r"balance|how many|left|remaining", t):
        dates = parse_dates(msg, today)
        if not dates:
            return "Sure, which dates? For example: \"apply casual leave on 26 Nov\" or \"sick leave tomorrow\"."
        reason = (re.search(r"\b(?:because|reason[: ]|due to)\s+(.+)$", msg, re.I) or [None, ""])[1].strip(" .")
        r = tools.post("/leave/requests", dict(leave_type=leave_type_of(t), start_date=dates[0].isoformat(),
                                                end_date=dates[1].isoformat(), reason=reason))
        if r.is_error:
            return f"I can't set that up: {r.json().get('detail')}."
        d = r.json()
        return (f"I've prepared {d['days']} day(s) of {d['leave_type_name'].lower()} for {fmt(d['start_date'])}"
                + (f" to {fmt(d['end_date'])}" if d["end_date"] != d["start_date"] else "")
                + f". Please check the card and tap Confirm, then I'll send it to {d['approver_name']}.")

    if re.search(r"payslip|pay slip|salary|\bctc\b|net pay", t):
        tools.post("/payslip-card")
        return "Here's your latest payslip. The figures come straight from KonnektHRMS and are never sent to the AI model."

    if re.search(r"balance|how many.*(leave|days|cl|sl|el)|(leave|leaves|days)\s+(do i have|left|remaining)|remaining leave", t):
        bals = {b["leave_type"]: b for b in tools.get("/leave/balance").json()}
        asked = [code for code, word in LEAVE_WORDS.items() if word in t]
        if asked:
            b = bals[asked[0]]
            out = (f"You have {b['available']:g} {b['name'].lower()} days available "
                   f"({b['opening'] + b['accrued']:g} for the year, {b['used']:g} used, {b['pending']:g} pending).")
            hit = tools.get("/policies/search", q=f"{b['name']} carry forward").json()
            if hit:
                out += f"\n{b['note']}. Source: {hit[0]['citation']}"
            return out
        lines = [f"• {b['name']}: {b['available']:g} available ({b['used']:g} used, {b['pending']:g} pending)" for c, b in bals.items() if c in ("CL", "SL", "EL")]
        return "Here are your leave balances for this year:\n" + "\n".join(lines)

    if "holiday" in t:
        hs = tools.get("/holidays").json()
        if not hs:
            return "There are no more company holidays listed this year."
        h = hs[0]
        nxt = ", ".join(f"{x['name']} ({fmt(x['date'])})" for x in hs[1:3])
        return f"The next company holiday is {h['name']} on {fmt(h['date'])}." + (f" After that: {nxt}." if nxt else "")

    if re.search(r"(team|who).*(on leave|off|away|out)\b", t):
        rs = tools.get("/team/leave").json()
        if not rs:
            return "Nobody in your team is on approved leave in the next 7 days."
        return "Approved leave in your team, next 7 days:\n" + "\n".join(
            f"• {r['employee_name']}: {r['leave_type']} {fmt(r['start_date'])}" + (f"–{fmt(r['end_date'])}" if r["end_date"] != r["start_date"] else "") for r in rs)

    if re.search(r"(my|status).*(request|application)s?|status of my leave|pending leave", t):
        rs = tools.get("/leave/requests").json()[:4]
        if not rs:
            return "You have no leave requests yet."
        return "Your recent leave requests:\n" + "\n".join(
            f"• #{r['id']} {r['leave_type']} {fmt(r['start_date'])}" + (f"–{fmt(r['end_date'])}" if r["end_date"] != r["start_date"] else "")
            + f" · {r['status']}" for r in rs)

    if re.fullmatch(r"\s*(hi|hello|hey|thanks|thank you|ok|okay)[!. ]*", t):
        return "Hi! I can check your leave balance, apply for leave, find the next holiday, or answer policy questions."

    hits = tools.get("/policies/search", q=msg).json()
    if hits:
        h = hits[0]
        sentences = re.split(r"(?<=[.!?])\s+", h["text"])
        return " ".join(sentences[:3]) + f"\nSource: {h['citation']}"
    tools.post("/unanswered", dict(question=msg))
    return ("I don't know the answer to that, and I'd rather not guess. I've passed your question to the HR team, "
            "and they'll get back to you.")


# ---------------- Bonding ----------------
GROUPS = {"badminton": "badminton", "cricket": "cricket", "book": "book-club", "reading": "book-club", "run": "running", "board game": "board-games"}


def bonding(p, tools):
    t = p["message"].lower()
    slug = next((s for k, s in GROUPS.items() if k in t), None)
    if "birthday" in t:
        show = not re.search(r"don'?t|do not|stop|hide|no |private|skip|opt out", t)
        tools.post("/birthday-pref", dict(show_birthday=show))
        return "Done, your birthday will be celebrated in #general 🎂" if show else "Done, I won't post about your birthday."
    if slug and re.search(r"\b(leave|quit|exit|remove)\b", t):
        r = tools.post(f"/groups/{slug}/leave").json()
        return f"You've left {r['left']}."
    if slug and re.search(r"\b(join|add me|sign me up|count me in|interested)\b", t):
        r = tools.post(f"/groups/{slug}/join").json()
        return f"You're in! You've joined {r['joined']}. Polls and plans show up in {r['channel']}."
    if re.search(r"upcoming|activit|events?|plans?|what'?s on", t):
        acts = tools.get("/activities").json()
        if not acts:
            return "Nothing planned in your groups right now. Want to join one? Try \"join badminton\"."
        return "In your groups:\n" + "\n".join(
            f"• {a['group_name']}: {a['question']} ({'won by ' + a['winner'] if a['winner'] else a['status']})" for a in acts)
    gs = tools.get("/groups").json()
    return "Interest groups at DotKonnekt:\n" + "\n".join(
        f"• {g['name']} ({g['members']} members){' ✓ joined' if g['joined'] else ''}" for g in gs) + "\nSay \"join <group>\" to sign up."


# ---------------- Wellness ----------------
MOOD_WORDS = {"great": 5, "awesome": 5, "good": 4, "fine": 3, "okay": 3, "ok": 3, "meh": 3, "tired": 2, "low": 2, "stressed": 2, "bad": 1, "terrible": 1}


def wellness(p, tools):
    t = p["message"].lower()
    if re.search(r"\b(stop|pause|no more|turn off)\b.*remind", t):
        kind = "water" if "water" in t else "walk" if "walk" in t else "all"
        tools.post("/reminders/pause", dict(kind=kind))
        return f"Paused your {'' if kind == 'all' else kind + ' '}reminders."
    if "remind" in t or "reminder" in t:
        kind = "walk" if re.search(r"walk|stretch|move", t) else "water"
        m = re.search(r"(\d+)\s*(minutes?|mins?|hours?|hrs?|h)\b", t)
        every = (int(m[1]) * (60 if m[2].startswith("h") else 1)) if m else (60 if kind == "water" else 120)
        r = tools.post("/reminders", dict(kind=kind, every_minutes=every)).json()
        return f"Done 💧 I'll remind you to {'drink water' if kind == 'water' else 'take a short walk'} every {r['every_minutes']} minutes during work hours. Say \"stop reminders\" any time."
    if re.search(r"opt[ -]?out|unsubscribe", t):
        tools.post("/wellness-opt-in", dict(opt_in=False))
        return "You're opted out of wellness features. I've cleared your reminders and won't send nudges."
    if re.search(r"opt[ -]?in", t):
        tools.post("/wellness-opt-in", dict(opt_in=True))
        return "You're opted in. I'll send gentle, private nudges, like reminding you to take a break when you haven't had leave in a while."
    if re.search(r"my data|about me|what do you (know|store)", t):
        tools.post("/my-data-card")
        return "Here's everything I keep about you. Change any of it on the card."
    if re.search(r"last (took |taken |take )?(a )?(leave|day off|break)|leave gap|when did i .*(leave|off)", t):
        g = tools.get("/leave-gap").json()
        if not g["days_since"]:
            return "I can't find any leave you've taken this year."
        return f"Your last day off ended on {fmt(g['last_leave_end'])}, {g['days_since']} days ago. A day of rest helps. Want me to set up a casual leave day? Just say \"apply leave next Friday\"."
    n = re.search(r"\b([1-5])\s*(/\s*5|out of 5)?\b", t)
    word = next((v for k, v in MOOD_WORDS.items() if re.search(rf"\b{k}\b", t)), None)
    if re.search(r"mood|feeling|feel", t) and (n or word):
        tools.post("/mood", dict(score=int(n[1]) if n else word))
        return "Thanks for sharing. It's saved anonymously (team and week only, no name)."
    return "I can set water or walk reminders, record an anonymous mood (\"feeling 4/5\"), show the data I hold about you, or tell you when you last took leave."


AGENTS = {"hr": hr, "bonding": bonding, "wellness": wellness}


def run(agent, payload):
    return AGENTS[agent](payload, Tools(payload))
