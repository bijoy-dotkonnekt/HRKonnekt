"use client";
import { useEffect, useRef, useState } from "react";
import Card from "@/components/Card";
import { Any, initials, post, usePoll, useStored } from "@/lib/api";

const SUGGEST: Record<string, string[]> = {
  employee: ["How many casual leaves do I have?", "Apply leave next Friday", "Can I carry forward casual leave?", "Next holiday?", "Join badminton"],
  manager: ["How many casual leaves do I have?", "My leave requests", "Next holiday?"],
  hr_admin: ["How many casual leaves do I have?", "Next holiday?", "Remind me to drink water every 60 minutes"],
};

export default function Chat() {
  const [me, setMe] = useStored("chat-persona", 10);
  const [conv, setConv] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [personas] = usePoll<Any[]>("/bot/personas", 60000);
  const [convs] = usePoll<Any[]>(`/bot/conversations?emp_id=${me}`, 10000);
  const active = conv || `dm-${me}`;
  const [msgs, reload] = usePoll<Any[]>(`/bot/conversations/${active}/messages?emp_id=${me}`);
  const bottom = useRef<HTMLDivElement>(null);
  const user = personas?.find((p) => p.emp_id === me);
  const isDm = active.startsWith("dm-");
  const lastId = msgs?.at(-1)?.id;

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [lastId, active]);

  async function send(t: string) {
    if (!t.trim() || sending) return;
    setSending(true);
    setText("");
    try {
      await post("/bot/messages", { emp_id: me, conversation_id: active, text: t });
    } finally {
      setSending(false);
      reload();
    }
  }

  const demo = personas?.filter((p) => p.demo_order < 99) ?? [];
  return (
    <div className="flex h-screen">
      <aside className="w-[270px] shrink-0 bg-ink text-bg flex flex-col gap-5 px-3.5 py-5 overflow-y-auto">
        <div className="flex gap-2.5 items-center px-1.5">
          <span className="w-9 h-9 rounded-xl bg-plum text-gold flex items-center justify-center font-semibold">K</span>
          <div className="flex flex-col"><span className="font-semibold">HRKonnekt Chat</span><span className="text-xs text-[#C9C6E6]">DotKonnekt</span></div>
        </div>
        <div className="flex flex-col gap-1 p-3 rounded-2xl bg-white/5 border border-white/10">
          <span className="eb !text-gold mb-1">Signed in as · demo switcher</span>
          {demo.map((p) => (
            <button key={p.emp_id} onClick={() => { setMe(p.emp_id); setConv(""); }}
              className={`flex gap-2.5 items-center min-h-10 px-2 py-1.5 rounded-lg text-left ${p.emp_id === me ? "bg-gold/15" : "hover:bg-white/5"}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${p.emp_id === me ? "bg-gold" : "bg-white/25"}`} />
              <span className="flex flex-col">
                <span className="font-semibold text-[13px]">{p.name}</span>
                <span className="text-[11.5px] text-[#C9C6E6]">{p.role.replace("_", " ")} · {p.department}</span>
              </span>
            </button>
          ))}
        </div>
        <nav className="flex flex-col gap-0.5">
          <span className="eb !text-[#C9C6E6] px-3 py-1">Direct</span>
          {convs?.filter((c) => c.type === "dm").map((c) => <ConvLink key={c.id} c={c} active={active} onClick={setConv} label="HRKonnekt" />)}
          <span className="eb !text-[#C9C6E6] px-3 pt-3.5 pb-1">Channels</span>
          {convs?.filter((c) => c.type === "channel").map((c) => <ConvLink key={c.id} c={c} active={active} onClick={setConv} label={`# ${c.name}`} />)}
        </nav>
        <span className="mt-auto text-xs text-[#C9C6E6] px-1.5">Live updates · 3s polling</span>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <header className="flex justify-between items-center gap-3 px-8 py-4 border-b border-hair bg-paper">
          <div className="flex flex-col">
            <span className="font-semibold text-[17px]">{isDm ? "HRKonnekt" : `# ${active}`}</span>
            <span className="text-muted text-[12.5px]">
              {isDm ? "Private chat · only you and the bot see this" : active === "hr-private" ? "HR team only · handovers from the guard" : "Channel"}
            </span>
          </div>
          {isDm && <button className="text-[13px] font-semibold text-plum" onClick={() => send("What data do you have about me?")}>What HRKonnekt knows about me</button>}
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="flex flex-col gap-4 max-w-[900px]">
            {msgs?.map((m) => {
              const mine = m.sender_emp_id === me;
              if (mine && !m.card)
                return <div key={m.id} className="self-end max-w-[520px] bg-ink text-bg px-4 py-3 rounded-[20px_20px_6px_20px] text-[15px] leading-snug whitespace-pre-wrap">{m.text}</div>;
              const bot = !m.sender_emp_id;
              return (
                <div key={m.id} className="self-start flex gap-3 max-w-[640px]">
                  <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center font-semibold text-sm ${bot ? "bg-plum text-gold" : "bg-lilac text-plum"}`}>
                    {bot ? "K" : initials(m.sender)}
                  </span>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs text-muted">{m.sender} · {m.created_at.slice(11, 16)}</span>
                    {m.text && (
                      <div className="bg-paper border border-hair px-4 py-3 rounded-[6px_20px_20px_20px] text-[15px] leading-normal whitespace-pre-wrap">{m.text}</div>
                    )}
                    {m.card && <Card card={m.card} empId={me} onDone={reload} />}
                    {m.source && <span className="pill self-start bg-lilac-soft text-plum">{m.source}</span>}
                  </div>
                </div>
              );
            })}
            {sending && <span className="text-sm text-muted">HRKonnekt is thinking…</span>}
            <div ref={bottom} />
          </div>
        </div>

        <div className="px-8 pt-4 pb-6 flex flex-col gap-2.5 border-t border-hair bg-paper">
          {isDm && (
            <div className="flex gap-2 flex-wrap">
              {(SUGGEST[user?.role ?? "employee"] ?? SUGGEST.employee).map((s) => (
                <button key={s} onClick={() => send(s)} className="min-h-9 px-3.5 rounded-full border border-ink/20 bg-paper text-[13px] font-semibold">{s}</button>
              ))}
            </div>
          )}
          <form className="flex gap-2.5" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <label htmlFor="msg" className="sr-only">Message</label>
            <input id="msg" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
              placeholder={isDm ? "Ask about leave, policies, holidays, groups…" : `Message #${active}`}
              className="flex-1 min-w-0 min-h-12 px-4.5 rounded-full border border-ink/20 bg-bg text-[15px] outline-none focus:border-purple" />
            <button className="btn !min-h-12" disabled={sending}>Send</button>
          </form>
        </div>
      </section>
    </div>
  );
}

function ConvLink({ c, active, onClick, label }: { c: Any; active: string; onClick: (id: string) => void; label: string }) {
  return (
    <button onClick={() => onClick(c.id)}
      className={`text-left px-3 py-2 rounded-lg text-sm ${c.id === active ? "bg-white/10 text-bg font-semibold" : "text-[#C9C6E6] hover:bg-white/5"}`}>
      {label}
    </button>
  );
}
