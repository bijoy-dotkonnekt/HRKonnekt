"""Keyword search over policy sections. ponytail: keyword scoring; swap for vector search if policies grow."""
import re
from functools import cache

from bot import hrms_client

STOP = set("""a an the is are am i me my we our us you your do does did can could will would should shall may might must
of to in on for at by with from and or not what how when where which who whom why there this that these those it its be been
have has had any much many get got about please tell know need want there's what's i'm hi hello hey""".split())


def tokens(s):
    return [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP]


@cache
def _index():
    out = []
    for p in hrms_client.get("/policies"):
        body = hrms_client.get(f"/policies/{p['slug']}")["body_md"]
        for m in re.finditer(r"^## (\d+)\. (.+?)\n(.*?)(?=^## |\Z)", body, re.M | re.S):
            no, heading, text = m.group(1), m.group(2).strip(), " ".join(m.group(3).split())
            out.append(dict(slug=p["slug"], title=p["title"], section_no=no, heading=heading, text=text,
                            h=set(tokens(heading)), t=set(tokens(text))))
    return out


def clear():
    _index.cache_clear()


def search(query, limit=3):
    q = set(tokens(query))
    if not q:
        return []
    hits = []
    for s in _index():
        matched = q & (s["h"] | s["t"])
        if len(matched) < max(1, round(len(q) * 0.5)):
            continue
        score = sum(2 if w in s["h"] else 1 for w in matched) + sum(1 for w in matched if w in s["t"] and w in s["h"])
        hits.append((score, s))
    hits.sort(key=lambda x: -x[0])
    return [dict(slug=s["slug"], title=s["title"], section_no=s["section_no"], heading=s["heading"], text=s["text"],
                 citation=f"{s['title']} §{s['section_no']} {s['heading']}", score=sc) for sc, s in hits[:limit]]
