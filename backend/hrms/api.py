"""KonnektHRMS: the dummy HRMS standing in for Razorpay Payroll. Knows nothing about the bot.
Every endpoint needs a signed-in person (session) or the bot's service key; each one checks who may see what."""
import re
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import check_may_see, is_privileged, may_see, viewer
from db import HRMS_DB, audit, db, now, one, rows

router = APIRouter(prefix="/hrms", tags=["KonnektHRMS"])

EMP_COLS = """e.id, e.emp_code, e.first_name, e.last_name, e.first_name || ' ' || e.last_name AS name, e.work_email,
  e.phone, e.gender, e.dob, e.date_of_joining, e.designation, e.grade, e.manager_id, e.status, e.probation_end_date,
  e.exit_date, e.is_hr_admin, e.avatar_color, e.employment_type, d.name AS department, d.code AS department_code,
  l.name AS location, e.location_id, m.first_name || ' ' || m.last_name AS manager_name"""
EMP_FROM = """employees e JOIN departments d ON d.id = e.department_id JOIN locations l ON l.id = e.location_id
  LEFT JOIN employees m ON m.id = e.manager_id"""
DIRECTORY = ("id", "emp_code", "first_name", "last_name", "name", "work_email", "designation", "department", "department_code",
             "location", "manager_id", "manager_name", "status", "avatar_color")
REQ_SELECT = """SELECT r.*, t.code AS leave_type, t.name AS leave_type_name, t.short_name AS leave_type_short,
  e.first_name || ' ' || e.last_name AS employee_name, a.first_name || ' ' || a.last_name AS approver_name
  FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
  JOIN employees e ON e.id = r.emp_id LEFT JOIN employees a ON a.id = r.approver_id"""

# Attendance codes → how people read them. kind folds half days into office days.
ATTENDANCE = {
    "present": dict(kind="office", label="Office", long="In office", counts_present=True),
    "half_day": dict(kind="office", label="Office", long="Half day", counts_present=True),
    "wfh": dict(kind="wfh", label="Home", long="Working from home", counts_present=True),
    "leave": dict(kind="leave", label="Leave", long="On leave", counts_present=False),
    "holiday": dict(kind="holiday", label="Holiday", long="Holiday", counts_present=False),
    "weekend": dict(kind="weekend", label="Weekend", long="Weekend", counts_present=False),
    "absent": dict(kind="absent", label="Absent", long="Absent", counts_present=False),
}
EARNINGS = [("basic", "Basic"), ("hra", "House rent allowance"), ("special_allowance", "Special allowance")]
DEDUCTIONS = [("employee_pf", "Provident fund"), ("professional_tax", "Professional tax"), ("tds", "Income tax (TDS)")]
TDS_PCT = {"L1": 0, "L2": 0.03, "L3": 0.06, "L4": 0.14, "L5": 0.18, "L6": 0.22, "L7": 0.25}


def salary_from_ctc(ctc, grade):
    """Monthly split of an annual CTC. Shared by the seed and by onboarding."""
    monthly = ctc // 12
    basic = round(monthly * 0.4)
    hra = round(basic * 0.4)
    return dict(annual_ctc=ctc, basic=basic, hra=hra, special_allowance=monthly - basic - hra,
                employee_pf=1800, professional_tax=200, tds=round(monthly * TDS_PCT.get(grade, 0.06), -2))


def company(c):
    return one(c, "SELECT * FROM company WHERE id=1")


def holidays_set(c, location_id=None):
    return {date.fromisoformat(h["date"]) for h in rows(c, "SELECT date FROM holidays WHERE location_id IS NULL OR location_id=?", location_id)}


def working_days(c, start, end, location_id=None):
    hol = holidays_set(c, location_id)
    out, cur = [], start
    while cur <= end:
        if cur.weekday() < 5 and cur not in hol:
            out.append(cur)
        cur += timedelta(days=1)
    return out


def balances(c, emp_id, year=None):
    year = year or date.today().year
    month = date.today().month if year == date.today().year else 12
    out = []
    for t in rows(c, "SELECT * FROM leave_types WHERE code IN ('CL','SL','EL','COMP','LOP') ORDER BY id"):
        opening = (one(c, "SELECT opening FROM leave_openings WHERE emp_id=? AND leave_type_id=? AND year=?", emp_id, t["id"], year) or {}).get("opening", 0)
        accrued = round(1.25 * month, 2) if t["code"] == "EL" else t["annual_quota"]
        sums = one(c, """SELECT COALESCE(SUM(CASE WHEN status='approved' THEN days END),0) AS used,
            COALESCE(SUM(CASE WHEN status='pending' THEN days END),0) AS pending FROM leave_requests
            WHERE emp_id=? AND leave_type_id=? AND substr(start_date,1,4)=?""", emp_id, t["id"], str(year))
        avail = opening + accrued - sums["used"] - sums["pending"]
        out.append(dict(leave_type=t["code"], name=t["name"], short_name=t["short_name"], shown=bool(t["shown"]), year=year,
                        opening=opening, accrued=accrued, entitled=round(opening + accrued, 2), used=sums["used"], pending=sums["pending"],
                        available=round(avail, 2) if t["code"] != "LOP" else None,
                        carry_forward_max=t["carry_forward_max"], note=t["note"]))
    return out


def emp_or_404(c, emp_id):
    e = one(c, f"SELECT {EMP_COLS} FROM {EMP_FROM} WHERE e.id=?", emp_id)
    if not e:
        raise HTTPException(404, "employee not found")
    return e


def me_id(v):
    if v["role"] == "service":
        raise HTTPException(400, "emp_id is required")
    return v["emp_id"]


@router.get("/company")
def company_info(v=Depends(viewer)):
    with db(HRMS_DB) as c:
        return company(c)


# ---------- people ----------
@router.get("/employees")
def employees(q: str = "", department: str = "", manager_id: int | None = None, include_exited: bool = False, v=Depends(viewer)):
    """Everyone may read the directory. Personal fields (phone, date of birth, joining date, grade) only for HR and the bot."""
    sql, args = f"SELECT {EMP_COLS} FROM {EMP_FROM} WHERE 1=1", []
    if not include_exited:
        sql += " AND e.status != 'exited'"
    if q:
        sql += " AND (e.first_name || ' ' || e.last_name LIKE ? OR e.work_email LIKE ? OR e.emp_code LIKE ?)"
        args += [f"%{q}%"] * 3
    if department:
        sql += " AND d.code = ?"
        args.append(department)
    if manager_id:
        sql += " AND e.manager_id = ?"
        args.append(manager_id)
    with db(HRMS_DB) as c:
        out = rows(c, sql + " ORDER BY e.id", *args)
    return out if is_privileged(v) else [{k: e[k] for k in DIRECTORY} for e in out]


@router.get("/employees/form-options")
def employee_form_options(v=Depends(viewer)):
    """Choices for HR's Add employee form."""
    if not is_privileged(v):
        raise HTTPException(403, "Only HR can add employees.")
    with db(HRMS_DB) as c:
        return dict(
            departments=rows(c, "SELECT id, name, code FROM departments ORDER BY id"),
            locations=rows(c, "SELECT id, name FROM locations ORDER BY id"),
            managers=rows(c, f"SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.designation, d.name AS department FROM {EMP_FROM} WHERE e.status!='exited' ORDER BY e.first_name"),
            grades=sorted(TDS_PCT),
            employment_types=[{"value": "full_time", "label": "Full time"}, {"value": "intern", "label": "Intern"}],
            genders=[{"value": "F", "label": "Female"}, {"value": "M", "label": "Male"}, {"value": "X", "label": "Prefer not to say"}],
            email_domain=company(c)["email_domain"],
        )


class EmployeeIn(BaseModel):
    first_name: str
    last_name: str
    department_id: int
    designation: str
    grade: str = "L2"
    manager_id: int
    location_id: int
    date_of_joining: date
    dob: date
    gender: str = "X"
    phone: str = ""
    employment_type: str = "full_time"
    is_hr_admin: bool = False
    annual_ctc: int | None = None


@router.post("/employees")
def create_employee(body: EmployeeIn, v=Depends(viewer)):
    """HR adds someone who just joined: employee record, probation, work email, salary structure."""
    if not is_privileged(v):
        raise HTTPException(403, "Only HR can add employees.")
    first, last = body.first_name.strip(), body.last_name.strip()
    if not first or not last or not body.designation.strip():
        raise HTTPException(400, "First name, last name and designation are required.")
    if body.grade not in TDS_PCT:
        raise HTTPException(400, f"grade must be one of {', '.join(sorted(TDS_PCT))}")
    if body.dob >= body.date_of_joining:
        raise HTTPException(400, "Date of birth must be before the joining date.")
    with db(HRMS_DB) as c:
        co = company(c)
        if not one(c, "SELECT id FROM departments WHERE id=?", body.department_id):
            raise HTTPException(400, "Unknown department.")
        if not one(c, "SELECT id FROM locations WHERE id=?", body.location_id):
            raise HTTPException(400, "Unknown location.")
        if not one(c, "SELECT id FROM employees WHERE id=? AND status!='exited'", body.manager_id):
            raise HTTPException(400, "The manager must be a current employee.")
        local = re.sub(r"[^a-z0-9.]", "", f"{first}.{last}".lower().replace(" ", ""))
        email, n = f"{local}@{co['email_domain']}", 1
        while one(c, "SELECT id FROM employees WHERE work_email=?", email):
            n += 1
            email = f"{local}{n}@{co['email_domain']}"
        new_id = one(c, "SELECT COALESCE(MAX(id),0)+1 AS n FROM employees")["n"]
        probation_end = (body.date_of_joining + timedelta(days=co["probation_days"])).isoformat()
        colors = [r["avatar_color"] for r in rows(c, "SELECT DISTINCT avatar_color FROM employees")]
        c.execute("""INSERT INTO employees(id,emp_code,first_name,last_name,work_email,phone,gender,dob,date_of_joining,department_id,
            designation,grade,manager_id,location_id,employment_type,status,probation_end_date,exit_date,is_hr_admin,avatar_color)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'probation',?,NULL,?,?)""",
                  (new_id, f"DK-{1000 + new_id}", first, last, email, body.phone.strip(), body.gender, body.dob.isoformat(),
                   body.date_of_joining.isoformat(), body.department_id, body.designation.strip(), body.grade, body.manager_id,
                   body.location_id, body.employment_type, probation_end, int(body.is_hr_admin), colors[new_id % len(colors)] if colors else None))
        if body.annual_ctc:
            s = salary_from_ctc(body.annual_ctc, body.grade)
            c.execute("INSERT INTO salary_structures VALUES (?,?,?,?,?,?,?,?,?)",
                      (new_id, body.date_of_joining.isoformat(), s["annual_ctc"], s["basic"], s["hra"], s["special_allowance"],
                       s["employee_pf"], s["professional_tax"], s["tds"]))
        e = emp_or_404(c, new_id)
    audit(v["emp_id"] or "hrms", "hrms.employee.create", new_id, {"email": email})
    return e


@router.get("/employees/by-email")
def employee_by_email(email: str, v=Depends(viewer)):
    with db(HRMS_DB) as c:
        e = one(c, f"SELECT {EMP_COLS} FROM {EMP_FROM} WHERE e.work_email=?", email)
    if not e:
        raise HTTPException(404, "employee not found")
    return e if may_see(v, e["id"]) else {k: e[k] for k in DIRECTORY}


@router.get("/employees/{emp_id}")
def employee(emp_id: int, v=Depends(viewer)):
    with db(HRMS_DB) as c:
        e = emp_or_404(c, emp_id)
    return e if may_see(v, emp_id) else {k: e[k] for k in DIRECTORY}


@router.get("/departments")
def departments(v=Depends(viewer)):
    with db(HRMS_DB) as c:
        return rows(c, """SELECT d.*, h.first_name || ' ' || h.last_name AS head_name,
            (SELECT COUNT(*) FROM employees e WHERE e.department_id=d.id AND e.status!='exited') AS headcount
            FROM departments d LEFT JOIN employees h ON h.id=d.head_emp_id ORDER BY d.id""")


@router.get("/events")
def events(days: int = 14, v=Depends(viewer)):
    """Birthdays and work anniversaries in the next `days` days (people who opted out are filtered by the bot, not here)."""
    today = date.today()
    out = []
    with db(HRMS_DB) as c:
        name = company(c)["name"]
        for e in rows(c, "SELECT id, first_name || ' ' || last_name AS name, dob, date_of_joining FROM employees WHERE status!='exited'"):
            for i in range(days + 1):
                d = today + timedelta(days=i)
                if e["dob"][5:] == d.isoformat()[5:]:
                    out.append(dict(date=d.isoformat(), emp_id=e["id"], name=e["name"], what="Birthday", today=i == 0))
                yrs = d.year - int(e["date_of_joining"][:4])
                if e["date_of_joining"][5:] == d.isoformat()[5:] and yrs > 0:
                    out.append(dict(date=d.isoformat(), emp_id=e["id"], name=e["name"], today=i == 0,
                                    what=f"{yrs} {'year' if yrs == 1 else 'years'} at {name}"))
    return sorted(out, key=lambda x: x["date"])


# ---------- attendance ----------
def _att_rows(c, emp_id, days):
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    out = rows(c, "SELECT * FROM attendance WHERE emp_id=? AND date>=? ORDER BY date", emp_id, since)
    for r in out:
        r.update({k: ATTENDANCE.get(r["status"], ATTENDANCE["absent"])[k] for k in ("kind", "label")})
    return out


@router.get("/attendance")
def attendance(emp_id: int, days: int = 30, v=Depends(viewer)):
    check_may_see(v, emp_id)
    with db(HRMS_DB) as c:
        return _att_rows(c, emp_id, days)


@router.get("/attendance/summary")
def attendance_summary(emp_id: int, days: int = 90, v=Depends(viewer)):
    """Counts by kind over `days`, this month's attendance ratio, and the legend."""
    check_may_see(v, emp_id)
    with db(HRMS_DB) as c:
        rs = _att_rows(c, emp_id, days)
        co = company(c)
    month = date.today().isoformat()[:7]
    this_month = [r for r in rs if r["date"].startswith(month) and r["kind"] not in ("weekend", "holiday")]
    counts = {k: sum(1 for r in rs if r["kind"] == k) for k in dict.fromkeys(a["kind"] for a in ATTENDANCE.values())}
    return dict(days=days, counts=counts,
                month=dict(present=sum(1 for r in this_month if ATTENDANCE.get(r["status"], {}).get("counts_present")), working=len(this_month)),
                legend=[dict(kind=k, label=lbl) for k, lbl in {a["kind"]: a["label"] for a in ATTENDANCE.values()}.items()],
                notes=dict(wfh=f"Up to {co['wfh_per_week']} a week",
                           no_leave=f"No day off in {days} days" if counts.get("leave", 0) == 0 else None))


@router.get("/attendance/day")
def attendance_day(day: str = "", v=Depends(viewer)):
    """Everyone's attendance row for one day (default today). HR and the bot only."""
    if not is_privileged(v):
        raise HTTPException(403, "Only HR can see everyone's attendance.")
    with db(HRMS_DB) as c:
        out = rows(c, "SELECT emp_id, status, check_in FROM attendance WHERE date=?", day or date.today().isoformat())
    for r in out:
        r["label"] = ATTENDANCE.get(r["status"], ATTENDANCE["absent"])["long"]
    return out


@router.get("/team/overview")
def team_overview(manager_id: int, v=Depends(viewer)):
    """A manager's direct reports today: where they are, leave left, approved leave ahead."""
    if not (is_privileged(v) or v["emp_id"] == manager_id):
        raise HTTPException(403, "You can only see your own team.")
    t = date.today().isoformat()
    with db(HRMS_DB) as c:
        team = rows(c, f"SELECT {EMP_COLS} FROM {EMP_FROM} WHERE e.manager_id=? AND e.status!='exited' ORDER BY e.first_name", manager_id)
        types = rows(c, "SELECT code, short_name FROM leave_types WHERE shown=1 ORDER BY id")
        out, ahead = [], 0
        for e in team:
            leave = one(c, REQ_SELECT + " WHERE r.emp_id=? AND r.status='approved' AND r.start_date<=? AND r.end_date>=?", e["id"], t, t)
            att = one(c, "SELECT status FROM attendance WHERE emp_id=? AND date=?", e["id"], t)
            if leave:
                end = date.fromisoformat(leave["end_date"])
                today = dict(label=f"On leave until {end:%b} {end.day}", tone="gold", on_leave=True)
            elif att:
                a = ATTENDANCE.get(att["status"], ATTENDANCE["absent"])
                today = dict(label=a["long"], tone="red" if att["status"] == "absent" else "muted" if a["kind"] in ("weekend", "holiday") else "", on_leave=False)
            else:
                today = dict(label="Not marked yet", tone="muted", on_leave=False)
            ahead += one(c, "SELECT COUNT(*) n FROM leave_requests WHERE emp_id=? AND status='approved' AND start_date>?", e["id"], t)["n"]
            bal = {b["leave_type"]: b for b in balances(c, e["id"])}
            out.append(dict(id=str(e["id"]), name=e["name"], title=e["designation"], location=e["location"], today=today,
                            leave_left=", ".join(f"{bal[x['code']]['available']:g} {x['short_name'][0]}" for x in types)))
    return dict(people=out, on_leave_today=sum(1 for p in out if p["today"]["on_leave"]), approved_ahead=ahead,
                legend="Leave left: " + ", ".join(f"{x['short_name'][0]} {x['short_name'].lower()}" for x in types) + ".")


# ---------- leave ----------
@router.get("/leave/balances/all")
def leave_balances_all(v=Depends(viewer)):
    """Balances for every current employee, keyed by emp_id. HR and the bot only."""
    if not is_privileged(v):
        raise HTTPException(403, "Only HR can see everyone's balances.")
    with db(HRMS_DB) as c:
        return {e["id"]: balances(c, e["id"]) for e in rows(c, "SELECT id FROM employees WHERE status!='exited'")}


@router.get("/leave/types")
def leave_types(v=Depends(viewer)):
    with db(HRMS_DB) as c:
        return rows(c, "SELECT * FROM leave_types ORDER BY id")


@router.get("/leave/balances")
def leave_balances(emp_id: int, v=Depends(viewer)):
    check_may_see(v, emp_id)
    with db(HRMS_DB) as c:
        emp_or_404(c, emp_id)
        return balances(c, emp_id)


@router.get("/leave/requests")
def leave_requests(emp_id: int | None = None, approver_id: int | None = None, status: str = "", v=Depends(viewer)):
    if not is_privileged(v):
        if emp_id is None and approver_id is None:
            raise HTTPException(403, "Ask for your own requests (emp_id) or the ones you approve (approver_id).")
        if emp_id is not None:
            check_may_see(v, emp_id)
        if approver_id is not None and approver_id != v["emp_id"]:
            raise HTTPException(403, "You can only see requests you approve.")
    sql, args = REQ_SELECT + " WHERE 1=1", []
    for col, val in (("r.emp_id", emp_id), ("r.approver_id", approver_id)):
        if val:
            sql += f" AND {col}=?"
            args.append(val)
    if status:
        sql += " AND r.status=?"
        args.append(status)
    with db(HRMS_DB) as c:
        return rows(c, sql + " ORDER BY r.start_date DESC", *args)


class LeaveIn(BaseModel):
    emp_id: int | None = None  # the bot names the employee; a signed-in person always applies for themself
    leave_type: str
    start_date: date
    end_date: date
    reason: str = ""
    source: str = "hrms"
    dry_run: bool = False


def check_leave(c, emp_id, code, start, end):
    """All the rules for a leave request. Raises HTTPException with a readable message; returns the facts."""
    e = emp_or_404(c, emp_id)
    t = one(c, "SELECT * FROM leave_types WHERE code=?", code.upper())
    if not t:
        raise HTTPException(400, f"unknown leave type {code}")
    if end < start:
        raise HTTPException(400, "The end date is before the start date.")
    if start < date.today() and t["code"] != "SL":
        raise HTTPException(400, "Only sick leave can be applied for past dates.")
    days = working_days(c, start, end, e["location_id"])
    if not days:
        raise HTTPException(400, "Those dates are all weekends or holidays.")
    overlap = one(c, """SELECT id FROM leave_requests WHERE emp_id=? AND status IN ('pending','approved')
        AND start_date<=? AND end_date>=?""", emp_id, end.isoformat(), start.isoformat())
    if overlap:
        raise HTTPException(409, f"This overlaps your request #{overlap['id']}.")
    bal = next((b for b in balances(c, emp_id) if b["leave_type"] == t["code"]), None)
    if bal and bal["available"] is not None and len(days) > bal["available"]:
        raise HTTPException(400, f"You only have {bal['available']:g} {t['short_name'].lower()} days left.")
    return e, t, days, bal


@router.post("/leave/preview")
def leave_preview(body: LeaveIn, v=Depends(viewer)):
    """What the leave form shows while you pick dates: working days, balance after, and whether it can be sent."""
    emp_id = body.emp_id if is_privileged(v) and body.emp_id else me_id(v)
    with db(HRMS_DB) as c:
        t = one(c, "SELECT * FROM leave_types WHERE code=?", body.leave_type.upper())
        bal = next((b for b in balances(c, emp_id) if t and b["leave_type"] == t["code"]), None)
        loc = emp_or_404(c, emp_id)["location_id"]
        n = len(working_days(c, body.start_date, body.end_date, loc)) if body.end_date >= body.start_date else 0
        try:
            e, t, days, bal = check_leave(c, emp_id, body.leave_type, body.start_date, body.end_date)
        except HTTPException as x:
            return dict(ok=False, days=n, left=bal["available"] if bal else None, message=x.detail)
    left = bal["available"] if bal else None
    after = round(left - len(days), 2) if left is not None else None
    word = "day" if len(days) == 1 else "days"
    return dict(ok=True, days=len(days), left=left, left_after=after, approver_name=e["manager_name"],
                message=f"{len(days)} working {word}." + (f" {after:g} left after this." if after is not None else ""))


@router.post("/leave/requests")
def create_leave(body: LeaveIn, v=Depends(viewer)):
    emp_id = body.emp_id if is_privileged(v) and body.emp_id else me_id(v)
    with db(HRMS_DB) as c:
        e, t, days, bal = check_leave(c, emp_id, body.leave_type, body.start_date, body.end_date)
        result = dict(emp_id=emp_id, leave_type=t["code"], leave_type_name=t["name"], start_date=body.start_date.isoformat(),
                      end_date=body.end_date.isoformat(), days=len(days), approver_id=e["manager_id"], approver_name=e["manager_name"],
                      available_before=bal["available"] if bal else None, reason=body.reason)
        if body.dry_run:
            return result
        cur = c.execute("""INSERT INTO leave_requests(emp_id,leave_type_id,start_date,end_date,days,reason,status,approver_id,applied_at,source)
            VALUES (?,?,?,?,?,?,'pending',?,?,?)""", (emp_id, t["id"], result["start_date"], result["end_date"], len(days),
                                                     body.reason, e["manager_id"], now(), body.source))
        result["id"] = cur.lastrowid
        result["status"] = "pending"
        return result


class Decision(BaseModel):
    approver_id: int | None = None  # the bot names the approver; a signed-in person decides as themself
    comment: str = ""


def decide(req_id, body, status, v):
    approver = body.approver_id if is_privileged(v) and body.approver_id else me_id(v)
    with db(HRMS_DB) as c:
        r = one(c, "SELECT * FROM leave_requests WHERE id=?", req_id)
        if not r:
            raise HTTPException(404, "request not found")
        if r["status"] != "pending":
            raise HTTPException(409, f"request is already {r['status']}")
        if r["approver_id"] != approver:
            raise HTTPException(403, "only the employee's manager can decide this request")
        c.execute("UPDATE leave_requests SET status=?, decided_at=?, decision_comment=? WHERE id=?", (status, now(), body.comment, req_id))
        if status == "approved":
            loc = emp_or_404(c, r["emp_id"])["location_id"]
            for d in working_days(c, date.fromisoformat(r["start_date"]), date.fromisoformat(r["end_date"]), loc):
                c.execute("""INSERT INTO attendance(emp_id,date,status,hours,leave_request_id) VALUES (?,?,'leave',0,?)
                    ON CONFLICT(emp_id,date) DO UPDATE SET status='leave', check_in=NULL, check_out=NULL, hours=0,
                    leave_request_id=excluded.leave_request_id""", (r["emp_id"], d.isoformat(), req_id))
        return one(c, REQ_SELECT + " WHERE r.id=?", req_id)


@router.post("/leave/requests/{req_id}/approve")
def approve(req_id: int, body: Decision, v=Depends(viewer)):
    return decide(req_id, body, "approved", v)


@router.post("/leave/requests/{req_id}/reject")
def reject(req_id: int, body: Decision, v=Depends(viewer)):
    return decide(req_id, body, "rejected", v)


@router.post("/leave/requests/{req_id}/cancel")
def cancel(req_id: int, v=Depends(viewer)):
    with db(HRMS_DB) as c:
        r = one(c, "SELECT * FROM leave_requests WHERE id=?", req_id)
        if not r or not (is_privileged(v) or r["emp_id"] == v["emp_id"]):
            raise HTTPException(404, "request not found")
        if r["status"] != "pending":
            raise HTTPException(409, "only pending requests can be cancelled")
        c.execute("UPDATE leave_requests SET status='cancelled', decided_at=? WHERE id=?", (now(), req_id))
        return one(c, REQ_SELECT + " WHERE r.id=?", req_id)


# ---------- holidays ----------
@router.get("/holidays")
def holidays(upcoming: bool = False, all_years: bool = False, location_id: int | None = None, v=Depends(viewer)):
    """Company-wide holidays plus the ones for `location_id` (a signed-in person gets their own location by default)."""
    if location_id is None and not is_privileged(v):
        with db(HRMS_DB) as c:
            location_id = one(c, "SELECT location_id FROM employees WHERE id=?", v["emp_id"])["location_id"]
    with db(HRMS_DB) as c:
        sql = "SELECT h.*, l.name AS location FROM holidays h LEFT JOIN locations l ON l.id=h.location_id WHERE 1=1"
        args = []
        if location_id is not None:
            sql += " AND (h.location_id IS NULL OR h.location_id=?)"
            args.append(location_id)
        if upcoming:
            sql += " AND h.date>=?"
            args.append(date.today().isoformat())
        elif not all_years:
            sql += " AND substr(h.date,1,4)=?"
            args.append(str(date.today().year))
        return rows(c, sql + " ORDER BY h.date", *args)


class HolidayIn(BaseModel):
    day: str  # YYYY-MM-DD
    name: str


def _hr(v):
    if not is_privileged(v):
        raise HTTPException(403, "Only HR can do that.")


@router.post("/holidays")
def add_holiday(body: HolidayIn, v=Depends(viewer)):
    _hr(v)
    try:
        day = date.fromisoformat(body.day).isoformat()
    except ValueError:
        raise HTTPException(400, "day must be YYYY-MM-DD")
    if not body.name.strip():
        raise HTTPException(400, "name is required")
    with db(HRMS_DB) as c:
        c.execute("DELETE FROM holidays WHERE date=?", (day,))
        c.execute("INSERT INTO holidays(date,name,type,location_id) VALUES (?,?,'public',NULL)", (day, body.name.strip()))
    audit(v["emp_id"] or "hrms-web", "hrms.holiday.add", day, {"name": body.name.strip()})
    return {"date": day, "name": body.name.strip()}


@router.delete("/holidays/{day}")
def remove_holiday(day: str, v=Depends(viewer)):
    _hr(v)
    with db(HRMS_DB) as c:
        if not c.execute("DELETE FROM holidays WHERE date=?", (day,)).rowcount:
            raise HTTPException(404, "no holiday on that date")
    audit(v["emp_id"] or "hrms-web", "hrms.holiday.remove", day)
    return {"removed": day}


# ---------- pay ----------
def _lines(src, keys):
    return [dict(label=label, amount=src[k]) for k, label in keys]


@router.get("/payslips")
def payslips(emp_id: int, v=Depends(viewer)):
    """Your own payslips (HR and the bot can read anyone's; managers can't)."""
    check_may_see(v, emp_id, managers_too=False)
    with db(HRMS_DB) as c:
        s = one(c, "SELECT * FROM salary_structures WHERE emp_id=?", emp_id)
        slips = rows(c, "SELECT * FROM payslips WHERE emp_id=? ORDER BY month DESC", emp_id)
    for p in slips:
        p["label"] = date.fromisoformat(p["month"] + "-01").strftime("%B %Y")
        p["earnings"] = _lines(s, EARNINGS) if s else []
        p["deductions"] = (_lines(s, DEDUCTIONS) if s else []) + (
            [dict(label=f"Loss of pay ({p['lop_days']:g} day{'s' if p['lop_days'] != 1 else ''})", amount=p["lop_amount"])] if p["lop_amount"] else [])
    return dict(structure=s, payslips=slips)


@router.get("/reimbursements")
def reimbursements(emp_id: int | None = None, v=Depends(viewer)):
    """Expense claims: your own, or anyone's for HR."""
    if emp_id is None:
        emp_id = None if is_privileged(v) else v["emp_id"]
    if emp_id is not None:
        check_may_see(v, emp_id, managers_too=False)
    with db(HRMS_DB) as c:
        sql = """SELECT r.*, e.first_name || ' ' || e.last_name AS employee_name FROM reimbursements r JOIN employees e ON e.id=r.emp_id"""
        return rows(c, sql + (" WHERE r.emp_id=?" if emp_id else "") + " ORDER BY r.filed_on DESC", *([emp_id] if emp_id else []))


@router.get("/payroll")
def payroll(v=Depends(viewer)):
    """This month's run (projected from salary structures), by department, and the last paid run."""
    _hr(v)
    with db(HRMS_DB) as c:
        run = one(c, "SELECT * FROM payroll_runs WHERE status!='paid' ORDER BY month LIMIT 1")
        last = one(c, "SELECT * FROM payroll_runs WHERE status='paid' ORDER BY month DESC LIMIT 1")
        by_dept = rows(c, """SELECT d.name AS department, COUNT(e.id) AS people,
            COALESCE(SUM(s.basic + s.hra + s.special_allowance),0) AS gross,
            COALESCE(SUM(s.basic + s.hra + s.special_allowance - s.employee_pf - s.professional_tax - s.tds),0) AS net
            FROM departments d JOIN employees e ON e.department_id=d.id AND e.status!='exited'
            LEFT JOIN salary_structures s ON s.emp_id=e.id GROUP BY d.id ORDER BY d.id""")
        last_total = one(c, "SELECT COALESCE(SUM(net_pay),0) AS net, COUNT(*) AS people FROM payslips WHERE month=?", last["month"]) if last else None
        locker = one(c, "SELECT first_name || ' ' || last_name AS name FROM employees WHERE id=?", run["locked_by"]) if run and run["locked_by"] else None
    label = lambda m: date.fromisoformat(m + "-01").strftime("%B %Y")
    return dict(
        run=dict(month=run["month"], label=label(run["month"]), pay_date=run["pay_date"], status=run["status"],
                 locked_by=locker["name"] if locker else None, locked_at=run["locked_at"]) if run else None,
        departments=by_dept, gross=sum(d["gross"] for d in by_dept), net=sum(d["net"] for d in by_dept),
        people=sum(d["people"] for d in by_dept),
        last=dict(month=last["month"], label=label(last["month"]), pay_date=last["pay_date"], net=last_total["net"], people=last_total["people"]) if last else None,
        note="Totals come from each person's salary structure in KonnektHRMS. HRKonnekt shows payslips through card templates and never sends amounts to the AI model.",
    )


@router.post("/payroll/{month}/lock")
def lock_payroll(month: str, v=Depends(viewer)):
    _hr(v)
    with db(HRMS_DB) as c:
        r = one(c, "SELECT * FROM payroll_runs WHERE month=?", month)
        if not r:
            raise HTTPException(404, "no payroll run for that month")
        if r["status"] != "open":
            raise HTTPException(409, f"this run is already {r['status']}")
        c.execute("UPDATE payroll_runs SET status='locked', locked_by=?, locked_at=? WHERE month=?", (v["emp_id"], now(), month))
    audit(v["emp_id"] or "hrms", "hrms.payroll.lock", month)
    return payroll(v)


# ---------- policies ----------
def sections(md):
    return [dict(no=m.group(1), heading=m.group(2).strip(), text=" ".join(m.group(3).split()))
            for m in re.finditer(r"^## (\d+)\. (.+?)\n(.*?)(?=^## |\Z)", md, re.M | re.S)]


@router.get("/policies")
def policies(v=Depends(viewer)):
    with db(HRMS_DB) as c:
        return rows(c, "SELECT slug, title, version, updated_at FROM policies ORDER BY title")


@router.get("/policies/{slug}")
def policy(slug: str, v=Depends(viewer)):
    with db(HRMS_DB) as c:
        p = one(c, "SELECT * FROM policies WHERE slug=?", slug)
    if not p:
        raise HTTPException(404, "policy not found")
    p["sections"] = sections(p["body_md"])
    return p


class PolicyIn(BaseModel):
    filename: str
    content: str


@router.post("/policies")
def upload_policy(body: PolicyIn, v=Depends(viewer)):
    """HR adds or replaces a policy from a Markdown file: '# Title' then '## 1. Section' headings."""
    _hr(v)
    if not body.filename.lower().endswith(".md"):
        raise HTTPException(400, "Upload a Markdown (.md) file.")
    md = body.content.strip()
    title = re.search(r"^# (.+)$", md, re.M)
    if not title or not sections(md):
        raise HTTPException(400, "The file needs a '# Title' line and numbered sections like '## 1. Leave year'.")
    slug = re.sub(r"[^a-z0-9]+", "-", body.filename.rsplit(".", 1)[0].lower()).strip("-")
    with db(HRMS_DB) as c:
        old = one(c, "SELECT version FROM policies WHERE slug=?", slug)
        version = f"v{float(old['version'][1:]) + 0.1:.1f}" if old else "v1.0"
        c.execute("INSERT OR REPLACE INTO policies VALUES (?,?,?,?,?)", (slug, title.group(1).strip(), version, date.today().isoformat(), md))
    audit(v["emp_id"] or "hrms", "hrms.policy.upload", slug, {"version": version})
    return dict(slug=slug, title=title.group(1).strip(), version=version, sections=len(sections(md)))


@router.get("/announcements")
def announcements(v=Depends(viewer)):
    with db(HRMS_DB) as c:
        return rows(c, """SELECT a.*, e.first_name || ' ' || e.last_name AS posted_by_name FROM announcements a
            LEFT JOIN employees e ON e.id=a.posted_by ORDER BY a.posted_at DESC""")


@router.get("/dashboard/summary")
def dashboard(v=Depends(viewer)):
    _hr(v)
    today = date.today().isoformat()
    with db(HRMS_DB) as c:
        by_dept = rows(c, """SELECT d.code, d.name, COUNT(e.id) AS headcount FROM departments d
                LEFT JOIN employees e ON e.department_id=d.id AND e.status!='exited' GROUP BY d.id ORDER BY d.id""")
        return dict(
            company=company(c)["name"],
            headcount=one(c, "SELECT COUNT(*) n FROM employees WHERE status!='exited'")["n"],
            departments=len(by_dept),
            on_leave_today=rows(c, f"""SELECT {EMP_COLS} FROM {EMP_FROM} JOIN leave_requests r ON r.emp_id=e.id
                WHERE r.status='approved' AND r.start_date<=? AND r.end_date>=?""", today, today),
            pending_requests=one(c, "SELECT COUNT(*) n FROM leave_requests WHERE status='pending'")["n"],
            probation=one(c, "SELECT COUNT(*) n FROM employees WHERE status='probation'")["n"],
            new_joiners=rows(c, f"SELECT {EMP_COLS} FROM {EMP_FROM} WHERE e.date_of_joining>=? ORDER BY e.date_of_joining DESC",
                             (date.today() - timedelta(days=company(c)["new_joiner_days"])).isoformat()),
            by_department=by_dept,
            leave_by_type=rows(c, """SELECT t.code, COALESCE(SUM(r.days),0) AS days FROM leave_types t LEFT JOIN leave_requests r
                ON r.leave_type_id=t.id AND r.status='approved' AND substr(r.start_date,1,4)=? GROUP BY t.id
                HAVING days>0""", str(date.today().year)),
            recent_requests=rows(c, REQ_SELECT + " ORDER BY r.applied_at DESC LIMIT 8"),
        )
