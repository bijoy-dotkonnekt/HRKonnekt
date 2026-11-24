"""Channel adapter: delivers bot messages and cards. WebChat (hrkonnekt.db) now; Microsoft Teams later."""
import json

from db import BOT_DB, db, now, one

BOT = "HRKonnekt"


def post(conversation_id, text="", card=None, sender=BOT, sender_emp_id=None, source=None):
    with db(BOT_DB) as c:
        cur = c.execute(
            "INSERT INTO messages(conversation_id,sender,sender_emp_id,created_at,text,card_json,source) VALUES (?,?,?,?,?,?,?)",
            (conversation_id, sender, sender_emp_id, now(), text, None, source))
        mid = cur.lastrowid
        if card:
            card = {"state": "open", **card, "id": mid}
            c.execute("UPDATE messages SET card_json=? WHERE id=?", (json.dumps(card), mid))
    return mid


def dm(emp_id, text="", card=None, source=None):
    return post(f"dm-{emp_id}", text, card, source=source)


def get_card(message_id):
    with db(BOT_DB) as c:
        m = one(c, "SELECT card_json FROM messages WHERE id=?", message_id)
    return json.loads(m["card_json"]) if m and m["card_json"] else None


def update_card(card):
    with db(BOT_DB) as c:
        c.execute("UPDATE messages SET card_json=? WHERE id=?", (json.dumps(card), card["id"]))
    return card


def close_card(card, result):
    card.update(state="closed", result=result)
    return update_card(card)
