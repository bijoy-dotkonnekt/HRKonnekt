"""Rebuild hrms.db + hrkonnekt.db with DotKonnekt dummy data. Every date is relative to today (D).
Run: python backend/seed.py   (also called by POST /bot/reset)"""
import json
import random
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db import BOT_DB, DATA, HRMS_DB, POLICIES, db  # noqa: E402

HRMS_SCHEMA = """
CREATE TABLE company(id INTEGER PRIMARY KEY, name TEXT, city TEXT, leave_year_start TEXT, work_hours TEXT, payday INTEGER);
CREATE TABLE departments(id INTEGER PRIMARY KEY, name TEXT, code TEXT, head_emp_id INTEGER);
CREATE TABLE locations(id INTEGER PRIMARY KEY, name TEXT, city TEXT, state TEXT);
CREATE TABLE employees(id INTEGER PRIMARY KEY, emp_code TEXT UNIQUE, first_name TEXT, last_name TEXT,
  work_email TEXT UNIQUE, phone TEXT, gender TEXT, dob TEXT, date_of_joining TEXT, department_id INTEGER,
  designation TEXT, grade TEXT, manager_id INTEGER, location_id INTEGER, employment_type TEXT, status TEXT,
  probation_end_date TEXT, exit_date TEXT, is_hr_admin INTEGER DEFAULT 0, avatar_color TEXT);
CREATE TABLE leave_types(id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT, annual_quota REAL,
  carry_forward_max INTEGER, paid INTEGER, note TEXT);
CREATE TABLE leave_openings(emp_id INTEGER, leave_type_id INTEGER, year INTEGER, opening REAL,
  PRIMARY KEY(emp_id, leave_type_id, year));
CREATE TABLE leave_requests(id INTEGER PRIMARY KEY, emp_id INTEGER, leave_type_id INTEGER, start_date TEXT,
  end_date TEXT, days REAL, reason TEXT, status TEXT, approver_id INTEGER, applied_at TEXT, decided_at TEXT,
  source TEXT, decision_comment TEXT);
CREATE TABLE attendance(id INTEGER PRIMARY KEY, emp_id INTEGER, date TEXT, status TEXT, check_in TEXT,
  check_out TEXT, hours REAL, leave_request_id INTEGER, UNIQUE(emp_id, date));
CREATE TABLE holidays(id INTEGER PRIMARY KEY, date TEXT, name TEXT, type TEXT, location_id INTEGER);
CREATE TABLE salary_structures(emp_id INTEGER PRIMARY KEY, effective_from TEXT, annual_ctc INTEGER, basic INTEGER,
  hra INTEGER, special_allowance INTEGER, employee_pf INTEGER, professional_tax INTEGER, tds INTEGER);
CREATE TABLE payslips(id INTEGER PRIMARY KEY, emp_id INTEGER, month TEXT, gross INTEGER, deductions INTEGER,
  lop_days REAL, lop_amount INTEGER, net_pay INTEGER);
CREATE TABLE announcements(id INTEGER PRIMARY KEY, title TEXT, body TEXT, audience TEXT, posted_by INTEGER, posted_at TEXT);
CREATE TABLE policies(slug TEXT PRIMARY KEY, title TEXT, version TEXT, updated_at TEXT, body_md TEXT);
"""

BOT_SCHEMA = """
CREATE TABLE users(emp_id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, role TEXT, department TEXT,
  team TEXT, designation TEXT, manager_id INTEGER, avatar_color TEXT, demo_order INTEGER);
CREATE TABLE conversations(id TEXT PRIMARY KEY, type TEXT, name TEXT, member_emp_id INTEGER);
CREATE TABLE messages(id INTEGER PRIMARY KEY, conversation_id TEXT, sender TEXT, sender_emp_id INTEGER,
  created_at TEXT, text TEXT, card_json TEXT, source TEXT);
CREATE TABLE preferences(emp_id INTEGER PRIMARY KEY, wellness_opt_in INTEGER DEFAULT 0, birthday_opt_out INTEGER DEFAULT 0,
  nudge_snooze_until TEXT, nudges_stopped INTEGER DEFAULT 0);
CREATE TABLE reminders(id INTEGER PRIMARY KEY, emp_id INTEGER, kind TEXT, every_minutes INTEGER, active INTEGER DEFAULT 1);
CREATE TABLE interest_groups(id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, conversation_id TEXT);
CREATE TABLE group_members(group_id INTEGER, emp_id INTEGER, joined_at TEXT, PRIMARY KEY(group_id, emp_id));
CREATE TABLE polls(id INTEGER PRIMARY KEY, group_id INTEGER, question TEXT, options_json TEXT, status TEXT,
  created_at TEXT, winner TEXT, message_id INTEGER);
CREATE TABLE votes(poll_id INTEGER, emp_id INTEGER, option TEXT, PRIMARY KEY(poll_id, emp_id));
CREATE TABLE pulse_responses(id INTEGER PRIMARY KEY, team TEXT, week TEXT, score INTEGER);
CREATE TABLE checkins(id INTEGER PRIMARY KEY, emp_id INTEGER, rating INTEGER, created_at TEXT);
CREATE TABLE handovers(id INTEGER PRIMARY KEY, emp_id INTEGER, category TEXT, summary TEXT, status TEXT,
  assigned_to INTEGER, created_at TEXT);
CREATE TABLE unanswered_questions(id INTEGER PRIMARY KEY, question TEXT, team TEXT, times_asked INTEGER, status TEXT, created_at TEXT);
CREATE TABLE audit_log(id INTEGER PRIMARY KEY, actor TEXT, action TEXT, target TEXT, details TEXT, created_at TEXT);
"""

DEPTS = [  # id, name, code, headcount
    (1, "Engineering", "ENG", 22), (2, "Product", "PRD", 6), (3, "Design", "DES", 5), (4, "Sales", "SAL", 10),
    (5, "Marketing", "MKT", 6), (6, "HR", "HR", 5), (7, "Finance", "FIN", 6),
]
FIRST = {"F": "Aisha Bhavna Chitra Deepa Fatima Gayatri Harini Ishita Jaya Kavya Lavanya Maya Nandini Pooja Rhea Sakshi Tanvi Uma Vani Zoya".split(),
         "M": "Aakash Bharat Chetan Dev Farhan Gaurav Harsh Imran Jatin Kunal Manish Naveen Omkar Pranav Rajat Sameer Tarun Varun Yash Zaid".split()}
LAST = "Agarwal Bhat Chatterjee Das Fernandes Ghosh Hegde Jain Kamath Mishra Naidu Patil Qureshi Rajan Saxena Thakur Varghese Wadhwa Yadav Shetty".split()
COLORS = ["#0C7A64", "#3056D3", "#B5476B", "#C77D1A", "#6B4FBB", "#2B8A9E", "#8A5A2B"]
LEAVE_TYPES = [  # id, code, name, quota, carry_fwd, paid, note
    (1, "CL", "Casual Leave", 12, 0, 1, "Lapses 31 Dec"), (2, "SL", "Sick Leave", 12, 0, 1, "Note needed after 2 days"),
    (3, "EL", "Earned Leave", 15, 30, 1, "Accrues 1.25 a month"), (4, "COMP", "Comp-off", 0, 0, 1, "Use within 30 days"),
    (5, "LOP", "Loss of Pay", 0, 0, 0, "Deducted in payslip"), (6, "MAT", "Maternity Leave", 182, 0, 1, "Illustrative; verify statutory rules"),
    (7, "PAT", "Paternity Leave", 5, 0, 1, "Company choice"),
]
CTC_BAND = {"L1": (300000, 500000), "L2": (600000, 900000), "L3": (1000000, 1600000), "L4": (1800000, 2800000),
            "L5": (3000000, 4500000), "L6": (5000000, 7000000), "L7": (8000000, 9000000)}
TDS_PCT = {"L1": 0, "L2": 0.03, "L3": 0.06, "L4": 0.14, "L5": 0.18, "L6": 0.22, "L7": 0.25}
DESIG = {"ENG": "Software Engineer", "PRD": "Product Manager", "DES": "Product Designer", "SAL": "Account Executive",
         "MKT": "Marketing Specialist", "HR": "HR Executive", "FIN": "Finance Analyst"}


def holidays_for(y):
    return [(date(y, 1, 1), "New Year's Day", "optional", None), (date(y, 1, 26), "Republic Day", "national", None),
            (date(y, 5, 1), "Maharashtra Day", "festival", 2), (date(y, 8, 15), "Independence Day", "national", None),
            (date(y, 10, 2), "Gandhi Jayanti", "national", None), (date(y, 11, 1), "Kannada Rajyotsava", "festival", 1),
            (date(y, 12, 25), "Christmas", "national", None)]


def years_ago(d, n, day_shift=0):
    try:
        x = d.replace(year=d.year - n)
    except ValueError:
        x = d.replace(year=d.year - n, day=28)
    return x + timedelta(days=day_shift)


def main():
    rnd = random.Random(42)
    D = date.today()
    DATA.mkdir(exist_ok=True)
    for p in (HRMS_DB, BOT_DB):
        for suffix in ("", "-wal", "-shm"):
            Path(str(p) + suffix).unlink(missing_ok=True)

    hol = [h for y in (D.year, D.year + 1) for h in holidays_for(y)]
    hol_dates = {h[0] for h in hol if h[3] is None}

    def is_workday(x):
        return x.weekday() < 5 and x not in hol_dates

    def span(start, n):
        """n working days starting at the first workday >= start."""
        while not is_workday(start):
            start += timedelta(days=1)
        days, cur, end = 0, start, start
        while days < n:
            if is_workday(cur):
                days, end = days + 1, cur
            cur += timedelta(days=1)
        return start, end

    # ---------- employees ----------
    DEMO_KEYS = demo_order = {"shabarish": 1, "lekha": 2, "vaishali": 3, "arjun": 4, "sneha": 5, "vikram": 6, "karthik": 7}
    emps = []  # dicts

    def add(first, last, dept, desig, grade, gender, dob, doj, **kw):
        e = dict(first_name=first, last_name=last, department_id=dept, designation=desig, grade=grade, gender=gender,
                 dob=dob.isoformat(), date_of_joining=doj.isoformat(), manager=kw.pop("manager", None),
                 location_id=kw.pop("location_id", 1), employment_type=kw.pop("employment_type", "full_time"),
                 status=kw.pop("status", "active"), is_hr_admin=kw.pop("is_hr_admin", 0), key=kw.pop("key", None), exit_date=None)
        emps.append(e)
        return e

    ceo = add("Aditya", "Menon", 2, "CEO & Co-founder", "L7", "M", date(1982, 2, 11), date(2016, 6, 1), key="ceo")
    heads = {
        1: add("Varun", "Rao", 1, "VP Engineering", "L6", "M", date(1984, 7, 19), date(2016, 9, 12), manager=ceo),
        3: add("Farah", "Khan", 3, "Design Lead", "L6", "F", date(1989, 1, 8), date(2018, 3, 5), manager=ceo),
        4: add("Rohan", "Malhotra", 4, "Head of Sales", "L6", "M", date(1985, 10, 2), date(2017, 8, 21), manager=ceo),
        5: add("Isha", "Banerjee", 5, "Head of Marketing", "L6", "F", date(1987, 5, 27), date(2018, 1, 15), manager=ceo),
        6: add("Lakshmi", "Srinivasan", 6, "Head of People", "L6", "F", date(1983, 12, 14), date(2017, 2, 6), manager=ceo, is_hr_admin=1),
        7: add("Suresh", "Kulkarni", 7, "Finance Controller", "L6", "M", date(1980, 4, 3), date(2017, 5, 2), manager=ceo),
    }
    heads[2] = ceo
    lekha = add("Lekha", "George", 1, "Engineering Manager", "L5", "F", date(1988, 2, 3), date(2021, 7, 1), manager=heads[1], key="lekha")
    sanjay = add("Sanjay", "Gupta", 1, "Engineering Manager", "L5", "M", date(1987, 3, 16), date(2019, 11, 4), manager=heads[1])
    shabarish = add("Shabarish", "N P", 1, "Software Engineer", "L4", "M", date(1996, 6, 14), date(2024, 3, 11), manager=lekha, key="shabarish")
    kiran = add("Kiran", "Joshi", 1, "Software Engineer", "L3", "F", date(1996, 8, 2), date(2022, 6, 13), manager=lekha, key="kiran")
    nikhil = add("Nikhil", "Bose", 1, "Software Engineer", "L3", "M", date(1997, 1, 25), date(2023, 2, 20), manager=lekha, key="nikhil")
    divya = add("Divya", "Rao", 1, "Senior Software Engineer", "L4", "F", date(1993, 11, 9), date(2020, 10, 12), manager=lekha, key="divya")
    vikram = add("Vikram", "Das", 4, "Account Executive", "L3", "M", date(1993, 8, 30), date(2022, 5, 9), manager=heads[4], location_id=2, key="vikram")
    vaishali = add("Vaishali", "Umredkar", 6, "HR Manager", "L5", "F", date(1989, 4, 19), date(2019, 4, 2), manager=heads[6], is_hr_admin=1, key="vaishali")
    arjun = add("Arjun", "Nair", 1, "Backend Engineer", "L2", "M", date(1999, 9, 21), D - timedelta(days=30), manager=lekha, location_id=2, status="probation", key="arjun")
    sneha_dob = years_ago(D, 29)
    sneha = add("Sneha", "Iyer", 3, "Product Designer", "L3", "F", sneha_dob, date(2023, 11, 20), manager=heads[3], key="sneha")
    karthik = add("Karthik", "Reddy", 4, "Account Executive", "L3", "M", date(1992, 6, 30), years_ago(D, 5), manager=heads[4], key="karthik")

    taken_names = {(e["first_name"], e["last_name"]) for e in emps}
    protected_md = {(D.month, D.day)}
    gen_count = {d[0]: 0 for d in DEPTS}
    for e in emps:
        gen_count[e["department_id"]] += 1
    probation_left, notice_left, exited_left = 2, 1, 1
    for dept_id, _, code, target in DEPTS:
        while gen_count[dept_id] < target:
            g = rnd.choice("FM")
            fn, ln = rnd.choice(FIRST[g]), rnd.choice(LAST)
            if (fn, ln) in taken_names:
                continue
            taken_names.add((fn, ln))
            dob = date(rnd.randint(1985, 2002), rnd.randint(1, 12), rnd.randint(1, 28))
            doj = D - timedelta(days=rnd.randint(400, 2800))
            status = "active"
            if probation_left and dept_id in (1, 4):
                doj, status, probation_left = D - timedelta(days=rnd.randint(60, 160)), "probation", probation_left - 1
            elif notice_left and dept_id == 4:
                status, notice_left = "notice", 0
            elif exited_left and dept_id == 5:
                status, exited_left = "exited", 0
            if (dob.month, dob.day) in protected_md or (doj.month, doj.day) in protected_md or doj == D - timedelta(days=30):
                doj -= timedelta(days=3)
                dob -= timedelta(days=3)
            grade = rnd.choice(["L2", "L3", "L3", "L4"]) if dept_id != 1 or rnd.random() > 0.1 else "L1"
            if dept_id == 1:
                mgr = lekha if sum(1 for e in emps if e["manager"] is lekha) < 8 else sanjay
            else:
                mgr = heads[dept_id]
            desig = ("Intern" if grade == "L1" else ("Senior " if grade == "L4" else "") + DESIG[code])
            e = add(fn, ln, dept_id, desig, grade, g, dob, doj, manager=mgr, status=status,
                    location_id=rnd.choices([1, 2, 3], [70, 20, 10])[0],
                    employment_type="intern" if grade == "L1" else "full_time", is_hr_admin=1 if dept_id == 6 else 0)
            gen_count[dept_id] += 1
            if status == "notice":
                e["exit_date"] = (D + timedelta(days=25)).isoformat()
            if status == "exited":
                e["exit_date"] = (D - timedelta(days=40)).isoformat()

    for i, e in enumerate(emps, start=1):
        e["id"] = i
        e["emp_code"] = f"DK-{1000 + i}"
        e["work_email"] = (f"{e['key']}@dotkonnekt.example" if e["key"] in DEMO_KEYS  # sign-in emails for the demo accounts
                           else f"{e['first_name'].lower()}.{e['last_name'].lower().replace(' ', '')}@dotkonnekt.example")
        e["phone"] = f"+91 90000 {10000 + i}"
        e["avatar_color"] = COLORS[i % len(COLORS)]
        doj = date.fromisoformat(e["date_of_joining"])
        e["probation_end_date"] = (doj + timedelta(days=182)).isoformat() if e["status"] == "probation" else None
    for e in emps:
        e["manager_id"] = e["manager"]["id"] if e["manager"] else None
    by_key = {e["key"]: e for e in emps if e["key"]}

    # ---------- leave requests ----------
    reqs = []

    def req(e, lt, start, n, status, reason, source="hrms", applied_days_before=7):
        s, en = span(start, n)
        applied = s - timedelta(days=applied_days_before)
        decided = None if status == "pending" else (applied + timedelta(days=1)).isoformat() + "T11:20:00"
        reqs.append(dict(emp_id=e["id"], leave_type_id=lt, start_date=s.isoformat(), end_date=en.isoformat(), days=n,
                         reason=reason, status=status, approver_id=e["manager_id"],
                         applied_at=min(applied, D).isoformat() + "T10:04:00", decided_at=decided, source=source))

    year_start = date(D.year, 1, 5)

    def past(days_ago):
        return max(D - timedelta(days=days_ago), year_start)

    # Shabarish: CL used 8 -> available 4; last leave ~100 days ago
    req(shabarish, 1, past(300), 3, "approved", "Family function")
    req(shabarish, 1, past(200), 3, "approved", "Personal work")
    req(shabarish, 1, past(103), 2, "approved", "Trip home")
    req(shabarish, 2, past(150), 2, "approved", "Fever")
    req(shabarish, 3, past(250), 5, "approved", "Vacation")
    req(shabarish, 1, past(60), 1, "rejected", "Personal work")
    # Lekha approves exactly these 3 pending
    req(kiran, 1, D + timedelta(days=8), 2, "pending", "Wedding in family")
    req(nikhil, 2, D + timedelta(days=1), 1, "pending", "Doctor appointment")
    req(divya, 3, D + timedelta(days=28), 4, "pending", "Year-end vacation")
    req(kiran, 1, past(120), 3, "approved", "Personal work")
    req(sneha, 2, past(80), 1, "rejected", "Not well")
    fixed_ids = {e["id"] for e in by_key.values()} | {sanjay["id"]}
    reasons = ["Personal work", "Family function", "Travel", "Not well", "Festival at home", "Moving house", "Vacation"]
    for e in emps:
        if e["id"] in fixed_ids or e["status"] == "exited":
            continue
        doj = date.fromisoformat(e["date_of_joining"])
        used = {1: 0, 2: 0, 3: 0}
        for _ in range(rnd.randint(1, 4)):
            lt = rnd.choice([1, 1, 2, 3])
            n = rnd.choice([1, 1, 2, 3])
            if used[lt] + n > 9:
                continue
            roll = rnd.random()
            if roll < 0.12 and e["manager"] is not lekha:
                start, status = D + timedelta(days=rnd.randint(3, 40)), "pending"
            else:
                start = past(rnd.randint(10, 320))
                status = "approved" if roll < 0.82 else ("rejected" if roll < 0.92 else "cancelled")
            if start < doj:
                continue
            req(e, lt, start, n, status, rnd.choice(reasons))
            if status in ("approved", "pending"):
                used[lt] += n
    # drop overlapping requests per employee (keep first)
    clean, seen = [], {}
    for r in reqs:
        s, en = date.fromisoformat(r["start_date"]), date.fromisoformat(r["end_date"])
        spans = seen.setdefault(r["emp_id"], [])
        if any(s <= b and a <= en for a, b in spans):
            continue
        spans.append((s, en))
        clean.append(r)
    reqs = clean
    for i, r in enumerate(reqs, start=1):
        r["id"] = i

    # ---------- attendance (D-89..D) ----------
    leave_day = {}
    for r in reqs:
        if r["status"] == "approved":
            cur = date.fromisoformat(r["start_date"])
            while cur <= date.fromisoformat(r["end_date"]):
                if is_workday(cur):
                    leave_day[(r["emp_id"], cur)] = r["id"]
                cur += timedelta(days=1)
    att = []
    for e in emps:
        doj = date.fromisoformat(e["date_of_joining"])
        exit_d = date.fromisoformat(e["exit_date"]) if e["status"] == "exited" else None
        for k in range(89, -1, -1):
            x = D - timedelta(days=k)
            if x < doj or (exit_d and x > exit_d):
                continue
            row = [e["id"], x.isoformat(), None, None, None, 0, None]
            if x.weekday() >= 5:
                row[2] = "weekend"
            elif x in hol_dates:
                row[2] = "holiday"
            elif (e["id"], x) in leave_day:
                row[2], row[6] = "leave", leave_day[(e["id"], x)]
            else:
                p = rnd.random()
                row[2] = "present" if p < 0.85 else "wfh" if p < 0.95 else "half_day" if p < 0.98 else "absent"
                if row[2] != "absent":
                    cin = 9 * 60 + rnd.randint(0, 75)
                    late = e is shabarish and k <= 14
                    cout = (21 * 60 + rnd.randint(30, 70)) if late else (cin + (270 if row[2] == "half_day" else rnd.randint(510, 570)))
                    row[3], row[4] = f"{cin // 60:02d}:{cin % 60:02d}", f"{cout // 60:02d}:{cout % 60:02d}"
                    row[5] = round((cout - cin) / 60, 1)
            att.append(row)

    # ---------- salary + payslips ----------
    sal, slips = [], []
    for e in emps:
        lo, hi = CTC_BAND[e["grade"]]
        ctc = 2400000 if e is shabarish else round(rnd.randint(lo, hi), -4)
        monthly = ctc // 12
        basic = round(monthly * 0.4)
        hra = round(basic * 0.4)
        special = monthly - basic - hra
        pf, pt, tds = 1800, 200, round(monthly * TDS_PCT[e["grade"]], -2)
        sal.append((e["id"], date(D.year if D.month >= 4 else D.year - 1, 4, 1).isoformat(), ctc, basic, hra, special, pf, pt, tds))
        doj = date.fromisoformat(e["date_of_joining"])
        m = date(D.year, D.month, 1)
        for _ in range(6):
            m = (m - timedelta(days=1)).replace(day=1)
            if m < doj.replace(day=1) or (e["exit_date"] and e["status"] == "exited" and m > date.fromisoformat(e["exit_date"])):
                continue
            lop = 1 if rnd.random() < 0.04 else 0
            lop_amt = round(monthly / 30 * lop)
            ded = pf + pt + tds
            slips.append((e["id"], m.strftime("%Y-%m"), monthly, ded, lop, lop_amt, monthly - ded - lop_amt))

    # ---------- policies ----------
    pols = []
    for f in sorted(POLICIES.glob("*.md")):
        body = f.read_text()
        title = re.search(r"^# (.+)$", body, re.M).group(1).strip()
        pols.append((f.stem, title, "v1.2", (D - timedelta(days=60)).isoformat(), body))

    with db(HRMS_DB) as c:
        c.executescript(HRMS_SCHEMA)
        c.execute("INSERT INTO company VALUES (1,'DotKonnekt','Bengaluru','01-01','09:30-18:30',30)")
        c.executemany("INSERT INTO departments VALUES (?,?,?,?)", [(d, n, code, heads[d]["id"]) for d, n, code, _ in DEPTS])
        c.executemany("INSERT INTO locations VALUES (?,?,?,?)", [(1, "Bengaluru HQ", "Bengaluru", "Karnataka"), (2, "Pune", "Pune", "Maharashtra"), (3, "Remote", None, None)])
        cols = ["id", "emp_code", "first_name", "last_name", "work_email", "phone", "gender", "dob", "date_of_joining", "department_id",
                "designation", "grade", "manager_id", "location_id", "employment_type", "status", "probation_end_date", "exit_date", "is_hr_admin", "avatar_color"]
        c.executemany(f"INSERT INTO employees({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", [[e[k] for k in cols] for e in emps])
        c.executemany("INSERT INTO leave_types VALUES (?,?,?,?,?,?,?)", LEAVE_TYPES)
        c.executemany("INSERT INTO leave_openings VALUES (?,?,?,?)",
                      [(e["id"], 3, D.year, 9 if e is shabarish else rnd.choice([0, 3, 6, 9, 12])) for e in emps])
        rc = ["id", "emp_id", "leave_type_id", "start_date", "end_date", "days", "reason", "status", "approver_id", "applied_at", "decided_at", "source"]
        c.executemany(f"INSERT INTO leave_requests({','.join(rc)}) VALUES ({','.join('?' * len(rc))})", [[r[k] for k in rc] for r in reqs])
        c.executemany("INSERT INTO attendance(emp_id,date,status,check_in,check_out,hours,leave_request_id) VALUES (?,?,?,?,?,?,?)", att)
        c.executemany("INSERT INTO holidays(date,name,type,location_id) VALUES (?,?,?,?)", [(h[0].isoformat(), h[1], h[2], h[3]) for h in hol])
        c.executemany("INSERT INTO salary_structures VALUES (?,?,?,?,?,?,?,?,?)", sal)
        c.executemany("INSERT INTO payslips(emp_id,month,gross,deductions,lop_days,lop_amount,net_pay) VALUES (?,?,?,?,?,?,?)", slips)
        c.executemany("INSERT INTO announcements(title,body,audience,posted_by,posted_at) VALUES (?,?,?,?,?)", [
            ("Year-end leave reminder", "Casual leave lapses on 31 Dec. Plan your days off with your manager.", "all", vaishali["id"], (D - timedelta(days=3)).isoformat()),
            ("Open enrolment: health insurance", "Add or update dependents before the 30th of this month.", "all", heads[6]["id"], (D - timedelta(days=8)).isoformat()),
            ("Welcome Arjun!", "Arjun Nair joined Engineering as a Backend Engineer in Pune. Say hi!", "all", heads[3]["id"], (D - timedelta(days=30)).isoformat()),
            ("Q4 town hall", "Town hall this Friday at 4pm in the Bengaluru HQ cafeteria and on video.", "all", ceo["id"], (D - timedelta(days=1)).isoformat()),
        ])
        c.executemany("INSERT INTO policies VALUES (?,?,?,?,?)", pols)

    # ---------- bot store ----------
    has_reports = {e["manager_id"] for e in emps if e["manager_id"]}
    dept_name = {d[0]: (d[1], d[2]) for d in DEPTS}
    active = [e for e in emps if e["status"] != "exited"]
    users = []
    for e in active:
        role = "hr_admin" if e["is_hr_admin"] else "manager" if e["id"] in has_reports else "employee"
        users.append((e["id"], e["work_email"], f"{e['first_name']} {e['last_name']}", role, dept_name[e["department_id"]][0],
                      dept_name[e["department_id"]][1], e["designation"], e["manager_id"], e["avatar_color"], demo_order.get(e["key"], 99)))
    groups = [(1, "badminton", "Badminton"), (2, "cricket", "Cricket"), (3, "book-club", "Book Club"), (4, "running", "Running"), (5, "board-games", "Board Games")]
    convs = [(f"dm-{e['id']}", "dm", "HRKonnekt", e["id"]) for e in active]
    convs += [("general", "channel", "general", None), ("hr-private", "channel", "hr-private", None)]
    convs += [(slug, "channel", slug, None) for _, slug, _ in groups]
    members = []
    badminton = [shabarish, lekha, kiran, nikhil, divya, karthik, vikram]
    for e in badminton:
        members.append((1, e["id"]))
    pool = [e for e in active if e not in badminton]
    for gid in (2, 3, 4, 5):
        for e in rnd.sample(pool, 6):
            members.append((gid, e["id"]))
    week = lambda d_: f"{d_.isocalendar()[0]}-W{d_.isocalendar()[1]:02d}"
    pulse = []
    for w in range(1, 7):
        wk = week(D - timedelta(weeks=w))
        for code, n in (("ENG", 8), ("SAL", 5), ("PRD", 3), ("MKT", 4), ("HR", 3)):
            base = {"ENG": 3.4 + w * 0.1, "SAL": 3.6}.get(code, 3.8)
            for _ in range(n):
                pulse.append((code, wk, max(1, min(5, round(rnd.gauss(base, 0.8))))))
    ts = lambda days, hm="10:00": f"{(D - timedelta(days=days)).isoformat()}T{hm}:00"
    msgs = []
    for e in active:
        if e["key"] in demo_order:
            msgs.append((f"dm-{e['id']}", "HRKonnekt", None, ts(2, "09:00"),
                         f"Hi {e['first_name']} 👋 I'm HRKonnekt, DotKonnekt's HR assistant. Ask me about leave, policies, holidays, groups or wellness reminders.", None, None))
    msgs += [
        ("general", "HRKonnekt", None, ts(30, "09:00"), "🎉 Please welcome Arjun Nair to the Engineering team!", None, "Bonding"),
        ("general", "Isha Banerjee", heads[5]["id"], ts(1, "16:10"), "Town hall on Friday, 4pm. Snacks on Marketing 🍕", None, None),
        ("badminton", "HRKonnekt", None, ts(6, "17:00"), "Last week's poll closed: Thursday 7pm won with 5 votes. Court booked by Kiran.", None, "Bonding"),
        ("hr-private", "HRKonnekt", None, ts(9, "11:30"), "Handover #1 (payroll query) was picked up by Vaishali Umredkar.", None, "Guard"),
    ]
    with db(BOT_DB) as c:
        c.executescript(BOT_SCHEMA)
        c.executemany("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)", users)
        c.executemany("INSERT INTO conversations VALUES (?,?,?,?)", convs)
        c.executemany("INSERT INTO messages(conversation_id,sender,sender_emp_id,created_at,text,card_json,source) VALUES (?,?,?,?,?,?,?)", msgs)
        c.executemany("INSERT INTO preferences(emp_id,wellness_opt_in,birthday_opt_out) VALUES (?,?,?)",
                      [(e["id"], 1 if e is shabarish or rnd.random() < 0.4 else 0, 0) for e in active])
        c.executemany("INSERT INTO interest_groups VALUES (?,?,?,?)", [(g, s, n, s) for g, s, n in groups])
        c.executemany("INSERT INTO group_members VALUES (?,?,?)", [(g, e, ts(60)) for g, e in members])
        c.execute("INSERT INTO polls VALUES (1,1,'Badminton this week?',?,'closed',?,'Thu 7pm',NULL)",
                  (json.dumps(["Thu 7pm", "Fri 7pm", "Sat 10am"]), ts(8)))
        c.executemany("INSERT INTO votes VALUES (1,?,?)", [(e["id"], o) for e, o in zip(badminton, ["Thu 7pm"] * 5 + ["Sat 10am"] * 2)])
        c.executemany("INSERT INTO pulse_responses(team,week,score) VALUES (?,?,?)", pulse)
        c.executemany("INSERT INTO handovers(emp_id,category,summary,status,assigned_to,created_at) VALUES (?,?,?,?,?,?)", [
            (kiran["id"], "payroll", "Asked why October payslip shows a different HRA amount.", "resolved", vaishali["id"], ts(9)),
            (karthik["id"], "unanswered", "Is there a policy on client entertainment expenses above ₹5,000?", "open", None, ts(4)),
        ])
        c.executemany("INSERT INTO unanswered_questions(question,team,times_asked,status,created_at) VALUES (?,?,?,?,?)", [
            ("Is there a policy on client entertainment expenses above ₹5,000?", "SAL", 2, "open", ts(4)),
            ("Can I work from another city for a month?", "ENG", 3, "open", ts(12)),
            ("Do we get a learning budget for courses?", "ENG", 4, "open", ts(20)),
            ("Is there a pet-friendly office day?", "MKT", 1, "open", ts(25)),
        ])
        c.execute("INSERT INTO audit_log(actor,action,target,details,created_at) VALUES ('seed','seed.run','',?,?)",
                  (json.dumps({"employees": len(emps), "leave_requests": len(reqs)}), ts(0, "08:00")))

    print(f"Seeded D={D}: {len(emps)} employees, {len(reqs)} leave requests, {len(att)} attendance rows, {len(pols)} policies")


if __name__ == "__main__":
    main()
