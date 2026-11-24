import logging

from db import HRMS_DB, load_env

load_env()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from bot.agent_api import router as agent_router, tools as tools_router  # noqa: E402
from bot.api import router as bot_router  # noqa: E402
from hrms.api import router as hrms_router  # noqa: E402

logging.basicConfig(level=logging.INFO)
if not HRMS_DB.exists():
    import seed
    seed.main()

app = FastAPI(title="HRKonnekt + KonnektHRMS", description="Hackathon backend: /hrms (dummy HRMS), /bot (chat + console), /api/me (22 tools, offline stubs), /api/tools (13 Kompass tools)")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_methods=["*"], allow_headers=["*"])
app.include_router(hrms_router)
app.include_router(bot_router)
app.include_router(agent_router)
app.include_router(tools_router)


@app.get("/healthz")
def healthz():
    return {"ok": True}
