"""HRMS adapter: the only bot code that talks to the HRMS. KonnektHRMS now; a Razorpay adapter later."""
import os

import httpx


class HRMSError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _base():
    return os.getenv("HRMS_BASE_URL", "http://localhost:8000/hrms")


def _check(r):
    if r.is_error:
        try:
            detail = r.json().get("detail", r.text)
        except ValueError:
            detail = r.text
        raise HRMSError(r.status_code, detail)
    return r.json()


def _headers():
    from auth import SERVICE_KEY  # the bot is a trusted caller of the HRMS
    return {"X-Service-Key": SERVICE_KEY}


def get(path, **params):
    return _check(httpx.get(_base() + path, params={k: v for k, v in params.items() if v is not None}, headers=_headers(), timeout=10))


def post(path, json=None, **params):
    # never blind-retry writes
    return _check(httpx.post(_base() + path, json=json, params=params or None, headers=_headers(), timeout=10))
