"use client";
// HRKonnekt as a chat bubble in the bottom-right corner of KonnektHRMS, signed in as the current user.

import { useEffect, useRef, useState } from "react";
import { Message } from "@/components/ChatParts";
import { Button, Mark } from "@/components/ui";
import { type Role } from "@/lib/data";
import { dm, sendMessage, useStore, type State } from "@/lib/store";

// Every suggestion here is a phrase the offline agents handle (checked against the backend stubs).
const suggestions: Record<Role, string[]> = {
  employee: ["How many leaves do I have left?", "Apply casual leave next Friday", "Show my payslip", "Upcoming holidays", "Can I work from home on Fridays?", "Join running", "Remind me to drink water every 60 minutes", "What do you know about me?", "Is there pet adoption leave?", "I'm being harassed by a colleague"],
  manager: ["Who in my team is on leave this week?", "How many leaves do I have left?", "Upcoming holidays", "Join running"],
  newjoiner: ["How do I claim reimbursement?", "Can I carry forward casual leave?", "I want to talk to someone in HR"],
  hr: ["Upcoming holidays", "Can I carry forward casual leave?"],
  hradmin: ["Upcoming holidays", "Can I carry forward casual leave?", "How many leaves do I have left?", "What do you know about me?"],
};

// Channels come from the backend: your DM, #general, groups you joined, and #hr-private for HR admins.
function channelsFor(s: State, pid: string) {
  return s.conversations.map((c) =>
    c.id === dm(pid)
      ? { id: c.id, name: "HRKonnekt", sub: "Private. Your manager can't see this." }
      : c.id === "general"
        ? { id: c.id, name: "#general", sub: "Everyone in the company" }
        : c.id === "hr-private"
          ? { id: c.id, name: "#hr-private", sub: "HR only. Messages the bot held back." }
          : { id: c.id, name: `#${c.name}`, sub: `${s.groups[c.id]?.length ?? 0} members` },
  );
}

export function ChatWidget({ pid }: { pid: string }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [ch, setCh] = useState(dm(pid));
  const [text, setText] = useState("");
  // Message count per channel when it was last looked at. On load, only cards still waiting for this
  // person count as unread, so an approval waiting for a manager shows on the bubble straight away.
  const [seen, setSeen] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      channelsFor(s, pid).map((c) => {
        const ms = s.messages.filter((m) => m.ch === c.id);
        return [c.id, ms.length - ms.filter((m) => m.card && m.canAct && !m.done && m.card.kind !== "myData").length];
      }),
    ),
  );
  const endRef = useRef<HTMLDivElement>(null);

  const channels = channelsFor(s, pid);
  const active = channels.find((c) => c.id === ch) ?? channels[0];
  const msgs = s.messages.filter((m) => m.ch === active.id);
  const typing = s.typing.includes(active.id);
  const count = (c: string) => s.messages.filter((m) => m.ch === c).length;
  const unread = (c: string) => (open && c === active.id ? 0 : Math.max(0, count(c) - (seen[c] ?? 0)));
  const totalUnread = channels.reduce((n, c) => n + unread(c.id), 0);
  const role = s.me.role;

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, msgs.length, typing, active.id]);

  const markSeen = () => setSeen((x) => ({ ...x, [active.id]: msgs.length }));
  function send(t: string) {
    if (!t.trim()) return;
    sendMessage(pid, active.id, t.trim());
    setText("");
  }

  return (
    <>
      {open && (
        <section
          className="rise fixed right-3 bottom-24 z-40 flex h-[min(640px,calc(100dvh-8rem))] w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[20px] border border-line bg-ground shadow-2xl shadow-black/40 sm:right-6"
          aria-label="HRKonnekt chat"
        >
          <header className="flex items-center gap-3 border-b border-line bg-cell px-4 py-3">
            <Mark state={typing ? "working" : "idle"} size={30} />
            <div className="min-w-0 flex-1">
              <div className="font-display font-semibold">{active.name}</div>
              <div className="truncate text-xs text-muted">{typing ? "Thinking" : active.sub}</div>
            </div>
            <button
              onClick={() => {
                markSeen();
                setOpen(false);
              }}
              aria-label="Close chat"
              className="press grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <nav className="flex gap-1 overflow-x-auto border-b border-line bg-cell px-3 pb-2" aria-label="Chats">
            {channels.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  markSeen();
                  setCh(c.id);
                }}
                aria-current={c.id === active.id ? "page" : undefined}
                className={`press flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs ${c.id === active.id ? "bg-raised font-medium text-ink" : "text-muted hover:text-ink"}`}
              >
                {c.name}
                {unread(c.id) > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-gold-fill px-1 text-[10px] font-semibold text-[#0b0b0d]">{unread(c.id)}</span>}
              </button>
            ))}
          </nav>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {msgs.map((m) => (
              <Message key={m.id} m={m} pid={pid} s={s} isDm />
            ))}
            {typing && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Mark state="working" size={18} /> HRKonnekt is thinking
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-line bg-cell px-3 py-3">
            {active.id === dm(pid) && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {suggestions[role].map((q) => (
                  <button key={q} onClick={() => send(q)} className="press shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-ink">
                    {q}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
              className="flex gap-2"
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={active.id === dm(pid) ? "Ask HRKonnekt" : `Message ${active.name}`}
                aria-label="Message"
                className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-ground px-4 text-sm outline-none placeholder:text-muted focus:border-gold"
              />
              <Button type="submit" disabled={!text.trim() || typing} className="min-h-11">
                Send
              </Button>
            </form>
          </div>
        </section>
      )}

      <button
        onClick={() => {
          if (open) markSeen();
          setOpen(!open);
        }}
        aria-label={open ? "Close HRKonnekt chat" : `Chat with HRKonnekt${totalUnread ? `, ${totalUnread} new` : ""}`}
        aria-expanded={open}
        className="press fixed right-3 bottom-5 z-40 flex h-14 items-center gap-2 rounded-full bg-btn pr-5 pl-3 text-btn-ink shadow-xl shadow-black/30 sm:right-6"
      >
        <span className="grid h-9 w-9 place-items-center rounded-full bg-btn-ink text-btn">
          <Mark state={typing ? "working" : totalUnread ? "needs" : "idle"} size={24} />
        </span>
        <span className="text-sm font-semibold">{open ? "Close" : `Ask HRKonnekt`}</span>
        {!open && totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 grid h-6 min-w-6 place-items-center rounded-full bg-red px-1.5 text-xs font-semibold text-ground ring-2 ring-ground">{totalUnread}</span>
        )}
      </button>
      <span className="sr-only">Signed in to chat as {s.me.name}</span>
    </>
  );
}
