"use client";
// Live state from the FastAPI backend. After sign-in, one poll of /bot/ui-state every 3 seconds feeds every page and the
// chat bubble, and /bot/meta (loaded once) supplies every label, list and rule the UI shows. Nothing is hardcoded here.
// ponytail: 3s polling instead of SSE; switch to EventSource if the demo needs instant updates.

import { useEffect, useState, useSyncExternalStore } from "react";
import { setPeople, type Employee, type Persona } from "./data";

export const API = process.env.NEXT_PUBLIC_API ?? "http://localhost:8000";

export type Agent = string; // ids come from meta.agents
export type CardButton = { label: string; action: string; value?: string | number; style?: string };
export type Card = {
  id: number;
  kind: string;
  title?: string;
  lines?: string[];
  facts?: [string, string][];
  buttons?: CardButton[];
  options?: { label: string; votes: number }[];
  earnings?: [string, number][];
  deductions?: [string, number][];
  gross?: number;
  net?: number;
  note?: string;
  source_label?: string;
  link?: string;
};
export type Msg = { id: string; ch: string; from: string; agent?: Agent | null; text: string; source?: string; card?: Card; cardId?: number; canAct?: boolean; done?: string; at: number };
export type LeaveRequest = {
  id: string; empId: string; employeeName: string; code: string; type: string; start: string; end: string; days: number; reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled"; via: "chat" | "hrms"; approverId?: string | null; approverName?: string | null;
};
export type Handover = { id: string; empId: string; employeeName: string; topic: string; category: string; sensitive: boolean; at: number; status: "open" | "resolved"; assignedName?: string | null };
export type Balance = { code: string; type: string; letter: string; entitled: number; taken: number; pending: number; left: number };
export type PulseRow = { week: string; label: string; avg: number | null; answers: number; shown: boolean };
export type TeamPerson = { id: string; name: string; title: string; location: string; today: { label: string; tone: string; on_leave: boolean }; leave_left: string };
export type Meta = {
  company: { name: string; email_domain: string; wfh_per_week: number; nudge_after_days: number; pulse_min_answers: number };
  leave_types: { code: string; label: string; name: string; letter: string; note: string }[];
  leave_form: { start_offset_days: number; end_offset_days: number; default_type: string | null };
  agents: { id: string; name: string; glyph: string }[];
  jobs: { name: string; label: string; what: string }[];
  suggestions: string[];
  nav: { href: string; label: string; badge?: string }[];
  home: string;
  pulse: { min_answers: number; scale_max: number };
};

export type State = {
  meta: Meta;
  me: Persona;
  people: Employee[];
  requests: LeaveRequest[];
  balances: Record<string, Balance[]>;
  messages: Msg[];
  typing: string[]; // channels where the bot is working on a reply
  conversations: { id: string; type: string; name: string; sub: string }[];
  groups: Record<string, string[]>;
  prefs: { wellness: boolean; nudges: boolean; birthday: boolean; toggles: { key: string; label: string; on: boolean }[]; reminders: string[] };
  holidays: { date: string; name: string }[];
  announcements: { title: string; body: string; at: string }[];
  team: { people: TeamPerson[]; on_leave_today: number; approved_ahead: number; legend: string } | null;
  pulse: { team: PulseRow[]; company: PulseRow[] };
  handovers: Handover[];
  unanswered: { q: string; count: number; team: string }[];
  attendanceToday: Record<string, { status: string; label: string }>;
  audit: { at: number; who: string; what: string }[];
  usage: { agent: string; name: string; count: number; what: string }[];
  config: { force_offline: boolean; agents: Record<string, boolean> } | null;
  badges: Record<string, number>;
};

export const dm = (personaId: string) => `dm-${personaId}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

// ---------- session ----------
// Kept in sessionStorage, so each browser tab can be signed in as a different person.
const SESSION = "hrk-session";
type Session = { token: string; id: string; home: string };
const sessionListeners = new Set<() => void>();
let sessionCache: { raw: string | null; value: Session | null } = { raw: null, value: null };
const readSession = (): Session | null => {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SESSION);
  } catch {}
  if (raw !== sessionCache.raw) sessionCache = { raw, value: raw ? (JSON.parse(raw) as Session) : null };
  return sessionCache.value;
};

async function call(method: string, path: string, body?: unknown) {
  const s = readSession();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (s) headers.Authorization = `Bearer ${s.token}`;
  const r = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && s) signOut();
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : r.statusText);
  return data;
}
export const get = (path: string) => call("GET", path);
export const post = (path: string, body?: unknown) => call("POST", path, body ?? {});

export async function signIn(email: string, password: string): Promise<string> {
  const r = await call("POST", "/auth/login", { email, password });
  try {
    sessionStorage.setItem(SESSION, JSON.stringify({ token: r.token, id: r.me.id, home: r.me.home }));
  } catch {}
  state = null;
  meta = null;
  sessionListeners.forEach((l) => l());
  refresh();
  return r.me.home as string;
}
export function signOut() {
  const s = readSession();
  if (s) fetch(API + "/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${s.token}` } }).catch(() => {});
  try {
    sessionStorage.removeItem(SESSION);
  } catch {}
  state = null;
  meta = null;
  sessionListeners.forEach((l) => l());
  emit();
}
export const useSession = () =>
  useSyncExternalStore(
    (l) => (sessionListeners.add(l), () => void sessionListeners.delete(l)),
    readSession,
    () => null,
  );
/** The signed-in person's emp id (pages render only once signed in). */
export const useMe = () => useSession()?.id ?? "";

/** One-off read for page data too big to poll (payslips, attendance, policy text). Refetches when `path` or `key` changes. */
export function useFetch<T = Raw>(path: string | null, key = 0): T | undefined {
  const [data, setData] = useState<{ id: string; value: T }>();
  const id = `${path}#${key}`;
  useEffect(() => {
    if (!path) return;
    let live = true;
    get(path).then((value) => live && setData({ id, value })).catch(() => {});
    return () => {
      live = false;
    };
  }, [path, id]);
  return data?.id === id ? data.value : undefined;
}

// ---------- backend rows to UI shapes (renames only; every rule lives in the backend) ----------
function toMsg(m: Raw): Msg {
  const c = m.card;
  return {
    id: String(m.id),
    ch: m.conversation_id,
    from: m.sender_emp_id ? String(m.sender_emp_id) : "bot",
    agent: m.agent,
    text: m.text ?? "",
    source: m.source ?? undefined,
    card: c ?? undefined,
    cardId: c?.id,
    canAct: c?.can_act,
    done: c?.state === "closed" ? c.result : undefined,
    at: Date.parse(m.created_at),
  };
}

function toState(d: Raw, m: Meta): State {
  setPeople(d.people);
  return {
    meta: m,
    me: d.me,
    people: d.people,
    requests: d.requests,
    balances: d.balances,
    messages: (d.messages as Raw[]).map(toMsg),
    typing: [...typing],
    conversations: d.conversations,
    groups: d.groups,
    prefs: d.prefs,
    holidays: d.holidays,
    announcements: d.announcements,
    team: d.team,
    pulse: d.pulse,
    handovers: (d.handovers as Raw[]).map((h) => ({ ...h, at: Date.parse(h.at) })),
    unanswered: d.unanswered,
    attendanceToday: d.attendance_today,
    audit: (d.audit as Raw[]).map((a) => ({ ...a, at: Date.parse(a.at) })),
    usage: d.usage,
    config: d.config,
    badges: d.badges,
  };
}

// ---------- store plumbing ----------
let state: State | null = null;
let meta: Meta | null = null;
let error = "";
let typing = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let timer: ReturnType<typeof setInterval> | undefined;
let inflight = false;
let again = false;

export async function refresh(): Promise<void> {
  if (!readSession()) return;
  if (inflight) {
    again = true; // a mutation landed mid-poll: poll once more when this one finishes
    return;
  }
  inflight = true;
  try {
    meta = meta ?? ((await get("/bot/meta")) as Meta);
    const d = await get("/bot/ui-state");
    if (readSession()) state = toState(d, meta);
    error = "";
  } catch (e) {
    error = `Can't reach the HRKonnekt backend at ${API} (${(e as Error).message}).`;
  } finally {
    inflight = false;
    emit();
  }
  if (again) {
    again = false;
    return refresh();
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!timer) {
    refresh();
    timer = setInterval(refresh, 3000);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const empty = null as unknown as State;
// Null until the first poll lands. The HRMS shell waits for it, so pages can assume a State.
export const useStore = () => useSyncExternalStore(subscribe, () => state ?? empty, () => empty);
export const useStoreError = () => useSyncExternalStore(subscribe, () => error, () => "");

// ---------- lookups ----------
export const balance = (s: State, empId: string): Balance[] => s.balances[empId] ?? [];
export const leftOf = (s: State, empId: string, code: string) => balance(s, empId).find((b) => b.code === code)?.left;
export const agentInfo = (s: State | null, id?: string | null) => s?.meta.agents.find((a) => a.id === id);

// ---------- leave (HRMS web; chat uses the cards) ----------
export type Preview = { ok: boolean; days: number; left: number | null; left_after?: number | null; approver_name?: string; message: string };
export const previewLeave = (code: string, start: string, end: string) =>
  post("/hrms/leave/preview", { leave_type: code, start_date: start, end_date: end }) as Promise<Preview>;

export async function applyLeave(code: string, start: string, end: string, reason: string) {
  try {
    return await post("/bot/leave/apply", { leave_type: code, start_date: start, end_date: end, reason });
  } finally {
    refresh();
  }
}

export async function decideLeave(requestId: string, decision: "approved" | "rejected") {
  try {
    await post(`/bot/leave/${requestId}/decide`, { decision: decision === "approved" ? "approve" : "reject" });
  } finally {
    refresh();
  }
}

export const resolveHandover = (id: string) => post(`/bot/admin/handovers/${id}/resolve`).finally(refresh);

// ---------- chat ----------
export async function sendMessage(pid: string, ch: string, text: string) {
  const isDm = ch === dm(pid);
  if (isDm) typing.add(ch);
  if (state) {
    const mine: Msg = { id: `local-${Date.now()}`, ch, from: pid, text, at: Date.now() };
    state = { ...state, messages: [...state.messages, mine], typing: [...typing] };
    emit();
  }
  try {
    await post("/bot/messages", { conversation_id: ch, text });
  } finally {
    typing.delete(ch);
    typing = new Set(typing);
    await refresh();
  }
}

// Card buttons carry their own action and value from the backend; the UI just sends them back.
export async function tapCard(m: Msg, action: string, value?: string | number) {
  try {
    await post("/bot/actions", { card_id: m.cardId, action, value });
  } catch (e) {
    console.warn("card action refused:", (e as Error).message);
  } finally {
    refresh();
  }
}

// ---------- Console and HR ----------
export async function runJob(name: string): Promise<string[]> {
  try {
    return (await post(`/bot/jobs/${name}/run`)).sent;
  } finally {
    refresh();
  }
}

export const addHoliday = (day: string, name: string) => post("/hrms/holidays", { day, name }).finally(refresh);
export const removeHoliday = (day: string) => call("DELETE", `/hrms/holidays/${day}`).finally(refresh);
export const resetDemo = () => post("/bot/reset").finally(() => ((meta = null), refresh()));
export const setOffline = (on: boolean) => post("/bot/admin/offline", { force_offline: on }).finally(refresh);
export const lockPayroll = (month: string) => post(`/hrms/payroll/${month}/lock`);
export const uploadPolicy = (filename: string, content: string) => post("/bot/admin/policies", { filename, content });
export const addEmployee = (body: Record<string, unknown>) => post("/bot/admin/employees", body).finally(refresh);
