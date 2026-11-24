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

## External agents (Kompass)

The HR, Bonding and Wellness agents run in Kompass (Sangria AI Studio). Their execute URLs and the Kompass tenant/project ids are in `.env` (`HR_AGENT_URL`, `BONDING_AGENT_URL`, `WELLNESS_AGENT_URL`, `KOMPASS_TENANT_ID`, `KOMPASS_PROJECT_ID`, `AGENT_TIMEOUT`). Leave an agent URL empty, or set `FORCE_OFFLINE=1` (also toggled from the Console), to use the offline stub for it.

Request we send:
```
POST {X_AGENT_URL}
X-Tenant-ID: $KOMPASS_TENANT_ID
project-id: $KOMPASS_PROJECT_ID
X-Authorization: Bearer <api_token>
{"task": "<employee message>", "context": {"today": "2026-11-24", "user": {"name", "role", "department", "designation"}, "history": [{"role": "user|assistant", "text": "..."}]}}
```
Reply: `data.result` when `success` and `data.success` are true. Otherwise the chat shows `data.error` (source "<Agent> · error"). A timeout, HTTP failure or non-JSON response falls back to the offline stub (`agent.fallback` in the audit log).

The `api_token` fixes WHO the employee is and WHICH agent is calling, and it expires after 5 minutes. Tools send it back as `X-Authorization: Bearer …` or `Authorization: Bearer …`.

**Tunnel.** Kompass runs in the cloud, so start a tunnel to port 8000 (e.g. `ngrok http 8000`). Tools call `<tunnel>/api/tools/...`. This also exposes `/hrms` and `/bot`, which have no login; it's dummy data only.

### The 13 Kompass tools (`/api/tools`)
| Agent | Tool | Call |
|---|---|---|
| HR | `hrk_hr_get` | `GET /hr?what=` profile, leave_balance, leave_requests, holidays, team_leave |
| HR | `hrk_policy_search` | `GET /policies/search?q=` (empty list = not covered) |
| HR | `hrk_leave_draft` | `POST /leave/requests` {leave_type, start_date, end_date, reason?} → Confirm card |
| HR | `hrk_payslip_card` | `POST /payslip-card` (amounts go to the screen, never to the agent) |
| HR | `hrk_handover` | `POST /handover` {summary, category?}; category `unanswered` logs a question no policy covers |
| Bonding | `hrk_bonding_get` | `GET /bonding?what=` profile, groups, activities |
| Bonding | `hrk_group` | `POST /groups/{slug}/{action}`, action = join or leave |
| Bonding | `hrk_birthday_pref` | `POST /birthday-pref` {show_birthday} |
| Wellness | `hrk_wellness_get` | `GET /wellness?what=` profile, leave_gap, my_data |
| Wellness | `hrk_my_data_card` | `POST /my-data-card` (card with toggles) |
| Wellness | `hrk_reminder` | `POST /reminders` {kind, every_minutes}; 15+ sets it, 0 stops it (kind water, walk or all) |
| Wellness | `hrk_wellness_opt_in` | `POST /wellness-opt-in` {opt_in} |
| Wellness | `hrk_mood` | `POST /mood` {score 1-5}, stored by team and week with no name |

Invalid values → 400 listing the valid ones. Another agent's tool → 403. A missing or expired token → 401. Specs are at http://localhost:8000/docs (tag "Kompass tools (13)").

The earlier 22 single-purpose routes under `/api/me` are kept unchanged; the offline stubs use them through `PUBLIC_API_BASE_URL`.

## Safety rules (as built)
- Identity comes from the demo sign-in, never from message text or an agent.
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
