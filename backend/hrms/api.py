"""KonnektHRMS: the dummy HRMS standing in for Razorpay Payroll. Knows nothing about the bot."""
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import HRMS_DB, audit, db, now, one, rows

router = APIRouter(prefix="/hrms", tags=["KonnektHRMS"])

EMP_COLS = """e.id, e.emp_code, e.first_name, e.last_name, e.first_name || ' ' || e.last_name AS name, e.work_email,
  e.phone, e.gender, e.dob, e.date_of_joining, e.designation, e.grade, e.manager_id, e.status, e.probation_end_date,
  e.exit_date, e.is_hr_admin, e.avatar_color, e.employment_type, d.name AS department, d.code AS department_code,
  l.name AS location, m.first_name || ' ' || m.last_name AS manager_name"""
EMP_FROM = """employees e JOIN departments d ON d.id = e.department_id JOIN locations l ON l.id = e.location_id
  LEFT JOIN employees m ON m.id = e.manager_id"""
REQ_SELECT = """SELECT r.*, t.code AS leave_type, t.name AS leave_type_name, e.first_name || ' ' || e.last_name AS employee_name,
  a.first_name || ' ' || a.last_name AS approver_name FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
  JOIN employees e ON e.id = r.emp_id LEFT JOIN employees a ON a.id = r.approver_id"""


def holidays_set(c):
    return {date.fromisoformat(h["date"]) for h in rows(c, "SELECT date FROM holidays WHERE location_id IS NULL")}


def working_days(c, start, end):
    hol = holidays_set(c)
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
        out.append(dict(leave_type=t["code"], name=t["name"], year=year, opening=opening, accrued=accrued,
                        used=sums["used"], pending=sums["pending"], available=round(avail, 2) if t["code"] != "LOP" else None,
                        carry_forward_max=t["carry_forward_max"], note=t["note"]))
    return out


def emp_or_404(c, emp_id):
    e = one(c, f"SELECT {EMP_COLS} FROM {EMP_FROM} WHERE e.id=?", emp_id)
    if not e:
        raise HTTPException(404, "employee not found")
    return e


@router.get("/employees")
def employees(q: str = "", department: str = "", manager_id: int | None = None, include_exited: bool = False):
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
        return rows(c, sql + " ORDER BY e.id", *args)


@router.get("/employees/by-email")
def employee_by_email(email: str):
    with db(HRMS_DB) as c:
        e = one(c, f"SELECT {EMP_COLS} FROM {EMP_FROM} WHERE e.work_email=?", email)
    if not e:
        raise HTTPException(404, "employee not found")
    return e


@router.get("/employees/{emp_id}")
def employee(emp_id: int):
    with db(HRMS_DB) as c:
        return emp_or_404(c, emp_id)


@router.get("/departments")
def departments():
    with db(HRMS_DB) as c:
        return rows(c, """SELECT d.*, h.first_name || ' ' || h.last_name AS head_name,
            (SELECT COUNT(*) FROM employees e WHERE e.department_id=d.id AND e.status!='exited') AS headcount
            FROM departments d LEFT JOIN employees h ON h.id=d.head_emp_id ORDER BY d.id""")


@router.get("/attendance")
def attendance(emp_id: int, days: int = 30):
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    with db(HRMS_DB) as c:
        return rows(c, "SELECT * FROM attendance WHERE emp_id=? AND date>=? ORDER BY date", emp_id, since)


@router.get("/attendance/day")
def attendance_day(day: str = ""):
    """Everyone's attendance row for one day (default today)."""
    with db(HRMS_DB) as c:
        return rows(c, "SELECT emp_id, status, check_in FROM attendance WHERE date=?", day or date.today().isoformat())


@router.get("/leave/balances/all")
def leave_balances_all():
    """Balances for every current employee, keyed by emp_id (for team and HR views)."""
    with db(HRMS_DB) as c:
        return {e["id"]: balances(c, e["id"]) for e in rows(c, "SELECT id FROM employees WHERE status!='exited'")}


@router.get("/leave/types")
def leave_types():
    with db(HRMS_DB) as c:
        return rows(c, "SELECT * FROM leave_types ORDER BY id")


@router.get("/leave/balances")
def leave_balances(emp_id: int):
    with db(HRMS_DB) as c:
        emp_or_404(c, emp_id)
        return balances(c, emp_id)


@router.get("/leave/requests")
def leave_requests(emp_id: int | None = None, approver_id: int | None = None, status: str = ""):
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
    emp_id: int
    leave_type: str
    start_date: date
    end_date: date
    reason: str = ""
    source: str = "hrms"
    dry_run: bool = False


@router.post("/leave/requests")
def create_leave(body: LeaveIn):
    with db(HRMS_DB) as c:
        e = emp_or_404(c, body.emp_id)
        t = one(c, "SELECT * FROM leave_types WHERE code=?", body.leave_type.upper())
        if not t:
            raise HTTPException(400, f"unknown leave type {body.leave_type}")
        if body.end_date < body.start_date:
            raise HTTPException(400, "end date is before start date")
        if body.start_date < date.today() and t["code"] != "SL":
            raise HTTPException(400, "only sick leave can be applied for past dates")
        days = working_days(c, body.start_date, body.end_date)
        if not days:
            raise HTTPException(400, "those dates are all weekends or holidays")
        overlap = one(c, """SELECT id FROM leave_requests WHERE emp_id=? AND status IN ('pending','approved')
            AND start_date<=? AND end_date>=?""", body.emp_id, body.end_date.isoformat(), body.start_date.isoformat())
        if overlap:
            raise HTTPException(409, f"overlaps existing request #{overlap['id']}")
        bal = next((b for b in balances(c, body.emp_id) if b["leave_type"] == t["code"]), None)
        if bal and bal["available"] is not None and len(days) > bal["available"]:
            raise HTTPException(400, f"only {bal['available']} {t['code']} days available")
        result = dict(emp_id=body.emp_id, leave_type=t["code"], leave_type_name=t["name"], start_date=body.start_date.isoformat(),
                      end_date=body.end_date.isoformat(), days=len(days), approver_id=e["manager_id"], approver_name=e["manager_name"],
                      available_before=bal["available"] if bal else None, reason=body.reason)
        if body.dry_run:
            return result
        cur = c.execute("""INSERT INTO leave_requests(emp_id,leave_type_id,start_date,end_date,days,reason,status,approver_id,applied_at,source)
            VALUES (?,?,?,?,?,?,'pending',?,?,?)""", (body.emp_id, t["id"], result["start_date"], result["end_date"], len(days),
                                                     body.reason, e["manager_id"], now(), body.source))
        result["id"] = cur.lastrowid
        result["status"] = "pending"
        return result


class Decision(BaseModel):
    approver_id: int
    comment: str = ""


def decide(req_id, body, status):
    with db(HRMS_DB) as c:
        r = one(c, "SELECT * FROM leave_requests WHERE id=?", req_id)
        if not r:
            raise HTTPException(404, "request not found")
        if r["status"] != "pending":
            raise HTTPException(409, f"request is already {r['status']}")
        if r["approver_id"] != body.approver_id:
            raise HTTPException(403, "only the employee's manager can decide this request")
        c.execute("UPDATE leave_requests SET status=?, decided_at=?, decision_comment=? WHERE id=?", (status, now(), body.comment, req_id))
        if status == "approved":
            for d in working_days(c, date.fromisoformat(r["start_date"]), date.fromisoformat(r["end_date"])):
                c.execute("""INSERT INTO attendance(emp_id,date,status,hours,leave_request_id) VALUES (?,?,'leave',0,?)
                    ON CONFLICT(emp_id,date) DO UPDATE SET status='leave', check_in=NULL, check_out=NULL, hours=0,
                    leave_request_id=excluded.leave_request_id""", (r["emp_id"], d.isoformat(), req_id))
        return one(c, REQ_SELECT + " WHERE r.id=?", req_id)


@router.post("/leave/requests/{req_id}/approve")
def approve(req_id: int, body: Decision):
    return decide(req_id, body, "approved")


@router.post("/leave/requests/{req_id}/reject")
def reject(req_id: int, body: Decision):
    return decide(req_id, body, "rejected")


@router.post("/leave/requests/{req_id}/cancel")
def cancel(req_id: int, emp_id: int):
    with db(HRMS_DB) as c:
        r = one(c, "SELECT * FROM leave_requests WHERE id=?", req_id)
        if not r or r["emp_id"] != emp_id:
            raise HTTPException(404, "request not found")
        if r["status"] != "pending":
            raise HTTPException(409, "only pending requests can be cancelled")
        c.execute("UPDATE leave_requests SET status='cancelled', decided_at=? WHERE id=?", (now(), req_id))
        return one(c, REQ_SELECT + " WHERE r.id=?", req_id)


@router.get("/holidays")
def holidays(upcoming: bool = False, all_years: bool = False):
    with db(HRMS_DB) as c:
        sql = "SELECT h.*, l.name AS location FROM holidays h LEFT JOIN locations l ON l.id=h.location_id"
        if upcoming:
            return rows(c, sql + " WHERE h.date>=? ORDER BY h.date", date.today().isoformat())
        if all_years:
            return rows(c, sql + " ORDER BY h.date")
        return rows(c, sql + " WHERE substr(h.date,1,4)=? ORDER BY h.date", str(date.today().year))


class HolidayIn(BaseModel):
    day: str  # YYYY-MM-DD
    name: str


@router.post("/holidays")
def add_holiday(body: HolidayIn):
    try:
        day = date.fromisoformat(body.day).isoformat()
    except ValueError:
        raise HTTPException(400, "day must be YYYY-MM-DD")
    if not body.name.strip():
        raise HTTPException(400, "name is required")
    with db(HRMS_DB) as c:
        c.execute("DELETE FROM holidays WHERE date=?", (day,))
        c.execute("INSERT INTO holidays(date,name,type,location_id) VALUES (?,?,'public',NULL)", (day, body.name.strip()))
    audit("hrms-web", "hrms.holiday.add", day, {"name": body.name.strip()})
    return {"date": day, "name": body.name.strip()}


@router.delete("/holidays/{day}")
def remove_holiday(day: str):
    with db(HRMS_DB) as c:
        if not c.execute("DELETE FROM holidays WHERE date=?", (day,)).rowcount:
            raise HTTPException(404, "no holiday on that date")
    audit("hrms-web", "hrms.holiday.remove", day)
    return {"removed": day}


@router.get("/payslips")
def payslips(emp_id: int):
    with db(HRMS_DB) as c:
        return dict(structure=one(c, "SELECT * FROM salary_structures WHERE emp_id=?", emp_id),
                    payslips=rows(c, "SELECT * FROM payslips WHERE emp_id=? ORDER BY month DESC", emp_id))


@router.get("/policies")
def policies():
    with db(HRMS_DB) as c:
        return rows(c, "SELECT slug, title, version, updated_at FROM policies ORDER BY title")


@router.get("/policies/{slug}")
def policy(slug: str):
    with db(HRMS_DB) as c:
        p = one(c, "SELECT * FROM policies WHERE slug=?", slug)
    if not p:
        raise HTTPException(404, "policy not found")
    return p


@router.get("/announcements")
def announcements():
    with db(HRMS_DB) as c:
        return rows(c, """SELECT a.*, e.first_name || ' ' || e.last_name AS posted_by_name FROM announcements a
            LEFT JOIN employees e ON e.id=a.posted_by ORDER BY a.posted_at DESC""")


@router.get("/dashboard/summary")
def dashboard():
    today = date.today().isoformat()
    with db(HRMS_DB) as c:
        return dict(
            headcount=one(c, "SELECT COUNT(*) n FROM employees WHERE status!='exited'")["n"],
            on_leave_today=rows(c, f"""SELECT {EMP_COLS} FROM {EMP_FROM} JOIN leave_requests r ON r.emp_id=e.id
                WHERE r.status='approved' AND r.start_date<=? AND r.end_date>=?""", today, today),
            pending_requests=one(c, "SELECT COUNT(*) n FROM leave_requests WHERE status='pending'")["n"],
            probation=one(c, "SELECT COUNT(*) n FROM employees WHERE status='probation'")["n"],
            new_joiners=rows(c, f"SELECT {EMP_COLS} FROM {EMP_FROM} WHERE e.date_of_joining>=? ORDER BY e.date_of_joining DESC",
                             (date.today() - timedelta(days=45)).isoformat()),
            by_department=rows(c, """SELECT d.code, d.name, COUNT(e.id) AS headcount FROM departments d
                LEFT JOIN employees e ON e.department_id=d.id AND e.status!='exited' GROUP BY d.id ORDER BY d.id"""),
            leave_by_type=rows(c, """SELECT t.code, COALESCE(SUM(r.days),0) AS days FROM leave_types t LEFT JOIN leave_requests r
                ON r.leave_type_id=t.id AND r.status='approved' AND substr(r.start_date,1,4)=? GROUP BY t.id
                HAVING days>0""", str(date.today().year)),
            recent_requests=rows(c, REQ_SELECT + " ORDER BY r.applied_at DESC LIMIT 8"),
        )
