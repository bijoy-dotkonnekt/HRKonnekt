"""Sign-in for KonnektHRMS + HRKonnekt. One account per current employee (users table), sessions in hrkonnekt.db.
The UI sends `Authorization: Bearer <session>`; the bot's own calls into /hrms send `X-Service-Key`."""
import hashlib
import hmac
import os
import secrets
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from db import BOT_DB, HRMS_DB, audit, db, one, rows

router = APIRouter(prefix="/auth", tags=["Sign-in"])
SERVICE_KEY = secrets.token_urlsafe(32)  # same process as /hrms, so the bot's HTTP calls can prove they're internal
SESSION_HOURS = 12
ITERATIONS = 20_000  # ponytail: demo-strength PBKDF2; raise for production


def demo_password():
    return os.getenv("DEMO_PASSWORD", "demo")


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(8)
    return f"{salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), ITERATIONS).hex()}"


def check_pw(pw, stored):
    if not stored or "$" not in stored:
        return False
    salt = stored.split("$", 1)[0]
    return hmac.compare_digest(hash_pw(pw, salt), stored)


def profile(emp_id):
    """The signed-in person as the UI needs them. Role and new-joiner flag are decided here, not in the browser."""
    with db(BOT_DB) as c:
        u = one(c, "SELECT emp_id, email, name, role, department, team, designation, manager_id FROM users WHERE emp_id=?", emp_id)
    if not u:
        return None
    with db(HRMS_DB) as c:
        e = one(c, """SELECT e.date_of_joining, e.status, l.name AS location, e.location_id FROM employees e
            JOIN locations l ON l.id=e.location_id WHERE e.id=?""", emp_id)
        co = one(c, "SELECT new_joiner_days FROM company WHERE id=1")
    from datetime import date
    joined = date.fromisoformat(e["date_of_joining"])
    new = (date.today() - joined).days < co["new_joiner_days"]
    home = {"hr_admin": "/hrms/admin", "manager": "/hrms/manager"}.get(u["role"], "/hrms/employee")
    return dict(id=str(u["emp_id"]), name=u["name"], email=u["email"], role=u["role"], is_new_joiner=new, home=home,
                title=u["designation"], dept=u["department"], team=u["team"], location=e["location"], location_id=e["location_id"],
                managerId=str(u["manager_id"]) if u["manager_id"] else None, joined=e["date_of_joining"], status=e["status"])


def _session(authorization):
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        return None
    with db(BOT_DB) as c:
        s = one(c, "SELECT * FROM sessions WHERE token=?", token)
    if not s or s["expires_at"] < time.time():
        return None
    with db(BOT_DB) as c:
        u = one(c, "SELECT emp_id, role, name FROM users WHERE emp_id=?", s["emp_id"])
    return u


def current_user(authorization: str = Header("", description="Bearer <session token from /auth/login>")):
    u = _session(authorization)
    if not u:
        raise HTTPException(401, "Please sign in again.")
    return u


def require(*roles):
    def dep(u=Depends(current_user)):
        if u["role"] not in roles:
            raise HTTPException(403, "Your account can't do that.")
        return u
    return dep


def viewer(authorization: str = Header(""), x_service_key: str = Header("")):
    """For /hrms: the bot (service key) sees everything; a person sees what their role allows."""
    if x_service_key and hmac.compare_digest(x_service_key, SERVICE_KEY):
        return {"emp_id": None, "role": "service"}
    return current_user(authorization)


def is_privileged(v):
    return v["role"] in ("service", "hr_admin")


def reports_of(emp_id):
    with db(HRMS_DB) as c:
        return {r["id"] for r in rows(c, "SELECT id FROM employees WHERE manager_id=?", emp_id)}


def may_see(v, emp_id, managers_too=True):
    """Self, HR admin, the bot, or (for leave and attendance) the person's manager."""
    if is_privileged(v) or v["emp_id"] == emp_id:
        return True
    return managers_too and emp_id in reports_of(v["emp_id"])


def check_may_see(v, emp_id, managers_too=True):
    if not may_see(v, emp_id, managers_too):
        raise HTTPException(403, "You can only see your own records.")


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: LoginIn):
    with db(BOT_DB) as c:
        u = one(c, "SELECT emp_id, password_hash FROM users WHERE lower(email)=lower(?)", body.email.strip())
    if not u or not check_pw(body.password, u["password_hash"]):
        raise HTTPException(401, "That email and password don't match an account.")
    token = secrets.token_urlsafe(32)
    with db(BOT_DB) as c:
        c.execute("DELETE FROM sessions WHERE expires_at<?", (time.time(),))
        c.execute("INSERT INTO sessions(token, emp_id, expires_at) VALUES (?,?,?)", (token, u["emp_id"], time.time() + SESSION_HOURS * 3600))
    audit(u["emp_id"], "auth.login", u["emp_id"])
    return {"token": token, "me": profile(u["emp_id"])}


@router.post("/logout")
def logout(authorization: str = Header("")):
    with db(BOT_DB) as c:
        c.execute("DELETE FROM sessions WHERE token=?", ((authorization or "").removeprefix("Bearer ").strip(),))
    return {"ok": True}


@router.get("/me")
def me(u=Depends(current_user)):
    return profile(u["emp_id"])


@router.get("/demo-accounts")
def demo_accounts():
    """The demo cast, so the sign-in page can offer them. Every other employee can sign in too."""
    labels = {"hr_admin": "HR", "manager": "Manager", "employee": "Employee"}
    with db(BOT_DB) as c:
        us = rows(c, "SELECT emp_id, name, email, role FROM users WHERE demo_order<99 ORDER BY demo_order")
    with db(HRMS_DB) as c:
        domain = one(c, "SELECT email_domain FROM company WHERE id=1")["email_domain"]
    return {"accounts": [dict(id=str(u["emp_id"]), name=u["name"], email=u["email"], label=labels[u["role"]]) for u in us],
            "email_placeholder": f"you@{domain}", "password_hint": "Every account uses the demo password."}
