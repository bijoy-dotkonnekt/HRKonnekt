import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
HRMS_DB = DATA / "hrms.db"
BOT_DB = DATA / "hrkonnekt.db"
POLICIES = ROOT.parent / "policies"


def load_env():
    env = ROOT.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


@contextmanager
def db(path):
    c = sqlite3.connect(path, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    try:
        yield c
        c.commit()
    finally:
        c.close()


def rows(c, sql, *args):
    return [dict(r) for r in c.execute(sql, args)]


def one(c, sql, *args):
    r = c.execute(sql, args).fetchone()
    return dict(r) if r else None


def now():
    return datetime.now().isoformat(timespec="seconds")


def audit(actor, action, target="", details=None):
    with db(BOT_DB) as c:
        c.execute(
            "INSERT INTO audit_log(actor, action, target, details, created_at) VALUES (?,?,?,?,?)",
            (str(actor), action, str(target), json.dumps(details or {}), now()),
        )
