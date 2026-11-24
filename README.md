# HRKonnekt · hackathon edition

DotKonnekt's HR assistant. It answers from policy with citations, applies for leave with one tap, runs team bonding and wellness nudges, and hands sensitive issues to a human.
All data is fictional (DotKonnekt, 60 employees, `@dotkonnekt.example` emails).

```
web_revamp (Next.js :3000)                 backend (FastAPI :8000)
  KonnektHRMS pages ── GET /bot/ui-state (one 3s poll) + /hrms/*
  chat bubble ── POST /bot/messages ─▶ identity → guard → router ─▶ HR / Bonding / Wellness agent (external URL, offline stub fallback)
  Console ── /bot/admin/*, /bot/jobs/*                                │ agent tools call /api/me/* (Bearer api_token)
                                   button taps → /bot/actions (no AI) ▼ → HRMS adapter → /hrms (KonnektHRMS, hrms.db)
                                   channel adapter → hrkonnekt.db (WebChat now, Teams later)
```
`web/` is the older frontend (separate /chat app). It still works against the same backend but `web_revamp/` replaces it.

## Run

```bash
uv venv .venv && uv pip install -p .venv -r backend/requirements.txt
cp .env.example .env
cd backend && ../.venv/bin/uvicorn main:app --port 8000 --reload --reload-exclude 'data/*'   # seeds on first start
cd web_revamp && npm ci && npx next dev -p 3000
```

Open http://localhost:3000 in two tabs and sign in as different people (each tab keeps its own login; any password works):
`shabarish@dotkonnekt.example` (employee), `lekha@dotkonnekt.example` (manager), `vaishali@dotkonnekt.example` (HR).
Other demo people: Arjun Nair (joined 30 days ago), Sneha Iyer (birthday today), Vikram Das (badminton), Karthik Reddy (5-year anniversary).
Re-seed (dates are relative to today) with `python backend/seed.py` or the **Reset demo** button in the Console.
Check the demo flow with `.venv/bin/python backend/test_bot.py` (resets the data, needs the server running).

## External agents

Set `HR_AGENT_URL`, `BONDING_AGENT_URL` and `WELLNESS_AGENT_URL` in `.env`. Leave any of them empty, or set `FORCE_OFFLINE=1` (also toggled from the Console), to use the offline stub for that agent.

Request we send (proposed contract):
```json
POST {X_AGENT_URL}
{ "agent": "hr", "message": "...", "history": [{"role": "user|assistant", "text": "..."}], "today": "2026-11-23",
  "user": {"name": "...", "role": "employee|manager|hr_admin", "department": "...", "designation": "..."},
  "api_base_url": "http://localhost:8000/api/me", "api_token": "..." }
→ { "reply": "text shown to the employee" }
```
Agent tools call `api_base_url` + path with `Authorization: Bearer <api_token>`. The token fixes WHO the employee is and WHICH agent is calling, and it expires after 5 minutes. Tool specs: http://localhost:8000/docs (tag "Agent tools API") or `/openapi.json`.

| Agent | Tools (`/api/me/...`) |
|---|---|
| all | `GET profile` |
| HR | `GET leave/balance`, `GET leave/requests`, `GET holidays`, `GET policies/search?q=`, `GET team/leave` (managers), `POST leave/requests` (draft → Confirm card), `POST payslip-card` (amounts go to the screen, never to the agent), `POST handover`, `POST unanswered` |
| Bonding | `GET groups`, `POST groups/{slug}/join`, `POST groups/{slug}/leave`, `POST birthday-pref`, `GET activities` |
| Wellness | `GET leave-gap`, `GET my-data`, `POST my-data-card` (toggles card), `POST reminders`, `POST reminders/pause`, `POST wellness-opt-in`, `POST mood` |

If the agents run on another machine, `PUBLIC_API_BASE_URL` must be reachable from there (for example, through a tunnel).

## Safety rules (as built)
- Identity comes from the persona switcher (a demo stand-in for sign-in), never from message text or an agent.
- The guard word list catches harassment/POSH, grievances, termination, pay disputes, crisis and "talk to a human" before any agent sees the message. A handover card goes to `#hr-private`.
- Records change only on a button tap by the right person: Confirm (the employee), then Approve/Reject (their manager). Cards close after one tap.
- The agent API never returns salary figures. Pulse data has no names and is shown only for 5+ answers.
- Every tool call, button tap and HRMS write is in `audit_log`.

## Demo script (~5 min)
1. Tab A: sign in as Shabarish. Home shows 4 casual leaves. Open **Ask HRKonnekt**: "How many leaves do I have left?" → "Apply casual leave next Friday" → Confirm.
2. Tab B: sign in as Lekha. The bubble shows a badge; Approve in chat (or on Approvals). Tab A: Home drops to 3 and chat says approved.
3. Shabarish: "Show my payslip" (card; amounts never reach the agent), "What do you know about me?" (toggles), "Is there pet adoption leave?" (I don't know → Console).
4. Shabarish: "I'm being harassed by a colleague" → guard. Tab B: sign out, sign in as Vaishali → Console → Mark resolved; Shabarish is told.
5. Console → run the 6 jobs (birthdays: Sneha, anniversaries: Karthik, check-in: Arjun, leave nudge, weekly pulse, badminton poll). Answer the pulse and vote in #badminton as Shabarish.
6. Vaishali → Holidays → add one → Shabarish asks "Upcoming holidays".
7. Close on the swap story: HRMS adapter (`bot/hrms_client.py`) → Razorpay; channel adapter (`bot/channel.py`) → Teams.

## Shortcuts taken (honest list)
3-second polling of one `/bot/ui-state` read instead of SSE · jobs triggered by button, not a scheduler · keyword guard/router (no small model) · keyword policy search · fake data and illustrative salary/leave figures · no real login (demo sign-in, any password) · payroll department totals and reimbursements are static sample data · policy upload is a mock.
