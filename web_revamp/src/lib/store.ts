"use client";
// Live state from the FastAPI backend. One poll of /bot/ui-state every 3 seconds feeds every page and the chat bubble.
// Mutations are POSTs to /hrms and /bot, followed by an immediate refetch.
// ponytail: 3s polling instead of SSE; switch to EventSource if the demo needs instant updates.

import { useEffect, useState, useSyncExternalStore } from "react";
import { setPeople, leaveLabel, type Employee, type Persona, type Role } from "./data";

export const API = process.env.NEXT_PUBLIC_API ?? "http://localhost:8000";

export type Agent = "hr" | "bonding" | "wellness" | "guard";
type Facts = [string, string][];
export type Card =
  | { kind: "leaveConfirm"; facts: Facts }
  | { kind: "leaveApprove"; title: string; facts: Facts }
  | { kind: "payslip"; title: string; earnings: [string, number][]; deductions: [string, number][]; gross: number; net: number }
  | { kind: "poll"; title: string; options: { label: string; votes: number }[] }
  | { kind: "pulse" }
  | { kind: "checkin" }
  | { kind: "nudge"; title: string; lines: string[] }
  | { kind: "handoverNotice"; title: string; topic: string; from: string }
  | { kind: "myData" }
  | { kind: "info"; title: string; lines: string[]; facts: Facts };

export type Msg = { id: string; ch: string; from: string; agent?: Agent; text: string; source?: string; card?: Card; cardId?: number; canAct?: boolean; done?: string; at: number };
export type LeaveRequest = { id: string; empId: string; code: string; type: string; start: string; end: string; days: number; reason: string; status: "pending" | "approved" | "rejected" | "cancelled"; via: "chat" | "hrms"; approverId?: string; decidedBy?: string };
export type Handover = { id: string; empId: string; topic: string; category: string; sensitive: boolean; at: number; status: "open" | "resolved"; assignedName?: string };
export type Balance = { code: string; type: string; entitled: number; taken: number; pending: number; left: number };
export type Pulse = { team: string; week: string; avg: number | null; n: number };
export type Prefs = { wellness: boolean; nudges: boolean; birthday: boolean; reminders: string[] };

export type State = {
  me: Persona;
  requests: LeaveRequest[];
  messages: Msg[];
  typing: string[]; // channels where the bot is working on a reply
  conversations: { id: string; type: string; name: string }[];
  handovers: Handover[];
  unanswered: { q: string; count: number; team: string }[];
  pulse: Pulse[];
  groups: Record<string, string[]>;
  prefs: Prefs;
  holidays: { date: string; name: string }[];
  announcements: { title: string; body: string; at: string }[];
  attendanceToday: Record<string, string>; // empId -> present | wfh | leave | ...
  balances: Record<string, Balance[]>;
  audit: { at: number; who: string; what: string }[];
  usage: Record<Agent, number>;
  config: { force_offline: boolean; agents: Record<string, boolean> };
};

const GUARD = new Set(["posh", "grievance", "termination", "pay_dispute", "crisis"]);
export const dm = (personaId: string) => `dm-${personaId}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : r.statusText);
  return data;
}
export const get = (path: string) => call("GET", path);
const post = (path: string, body?: unknown) => call("POST", path, body ?? {});

/** One-off read for page data too big to poll (payslips, attendance, policy text). Refetches when `path` changes. */
export function useFetch<T = Raw>(path: string | null): T | undefined {
  const [data, setData] = useState<{ path: string; value: T }>();
  useEffect(() => {
    if (!path) return;
    let live = true;
    get(path).then((value) => live && setData({ path, value })).catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  return data?.path === path ? data.value : undefined;
}

// ---------- mapping backend rows to the revamp's shapes ----------
const agentOf = (source?: string | null): Agent | undefined => {
  const s = (source ?? "").toLowerCase();
  return s.startsWith("guard") ? "guard" : s.startsWith("bonding") ? "bonding" : s.startsWith("wellness") ? "wellness" : s ? "hr" : undefined;
};

function toCard(c: Raw): Card | undefined {
  if (!c) return undefined;
  const facts = (c.facts ?? []) as Facts;
  switch (c.kind) {
    case "leave_confirm":
      return { kind: "leaveConfirm", facts };
    case "leave_approval":
      return { kind: "leaveApprove", title: c.title, facts };
    case "payslip":
      return { kind: "payslip", title: c.title, earnings: c.earnings, deductions: c.deductions, gross: c.gross, net: c.net };
    case "poll":
      return { kind: "poll", title: c.title, options: c.options ?? [] };
    case "pulse":
      return { kind: "pulse" };
    case "checkin":
      return { kind: "checkin" };
    case "nudge":
      return { kind: "nudge", title: c.title, lines: c.lines ?? [] };
    case "handover":
      return { kind: "handoverNotice", title: c.title, topic: c.lines?.[0] ?? "", from: facts.find((f) => f[0] === "From")?.[1] ?? "" };
    case "my_data":
      return { kind: "myData" };
    default:
      return { kind: "info", title: c.title ?? "", lines: c.lines ?? [], facts };
  }
}

function toMsg(m: Raw): Msg {
  const c = m.card;
  return {
    id: String(m.id),
    ch: m.conversation_id,
    from: m.sender_emp_id ? String(m.sender_emp_id) : "bot",
    agent: m.sender_emp_id ? undefined : agentOf(m.source) ?? "hr",
    text: m.text ?? "",
    card: toCard(c),
    cardId: c?.id,
    canAct: c?.can_act,
    done: c?.state === "closed" ? c.result : undefined,
    at: Date.parse(m.created_at),
  };
}

const roleOf = (r: Raw, e?: Employee): Role =>
  r.role === "hr_admin" ? "hradmin" : r.role === "manager" ? "manager" : e && Date.now() - Date.parse(e.joined) < 45 * 86_400_000 ? "newjoiner" : "employee";

function toState(d: Raw): State {
  const emps: Employee[] = d.employees.map((e: Raw) => ({
    id: String(e.id), name: e.name, title: e.designation, dept: e.department, team: e.department_code, location: e.location,
    managerId: e.manager_id ? String(e.manager_id) : undefined, joined: e.date_of_joining, birthday: e.dob.slice(5), status: e.status,
  }));
  const byId = new Map(emps.map((e) => [e.id, e]));
  const demo: Persona[] = d.users
    .filter((u: Raw) => u.demo_order < 99 && byId.has(String(u.emp_id)))
    .map((u: Raw) => ({ ...byId.get(String(u.emp_id))!, role: roleOf(u, byId.get(String(u.emp_id))) }));
  setPeople(emps, demo);
  const meEmp = byId.get(String(d.me.emp_id))!;

  const balances: Record<string, Balance[]> = {};
  for (const [id, list] of Object.entries(d.balances as Record<string, Raw[]>))
    balances[id] = list
      .filter((b) => ["CL", "SL", "EL"].includes(b.leave_type))
      .map((b) => ({ code: b.leave_type, type: leaveLabel(b.leave_type), entitled: b.opening + b.accrued, taken: b.used, pending: b.pending, left: b.available }));

  const reminders = (d.reminders as Raw[]).filter((r) => r.active).map((r) => `${r.kind === "walk" ? "Take a short walk" : "Drink water"}, every ${r.every_minutes} minutes`);
  return {
    me: { ...meEmp, role: roleOf(d.me, meEmp) },
    requests: (d.requests as Raw[])
      .map((r) => ({
        id: String(r.id), empId: String(r.emp_id), code: r.leave_type, type: leaveLabel(r.leave_type), start: r.start_date, end: r.end_date,
        days: r.days, reason: r.reason ?? "", status: r.status, via: r.source === "chat" ? "chat" : "hrms",
        approverId: r.approver_id ? String(r.approver_id) : undefined, decidedBy: r.decided_at && r.approver_id ? String(r.approver_id) : undefined,
      }) as LeaveRequest)
      .sort((a, b) => Number(b.id) - Number(a.id)),
    messages: (d.messages as Raw[]).map(toMsg),
    typing: [...typing],
    conversations: d.conversations,
    handovers: (d.handovers as Raw[]).map((h) => ({
      id: String(h.id), empId: String(h.emp_id), topic: h.summary, category: h.category, sensitive: GUARD.has(h.category),
      at: Date.parse(h.created_at), status: h.status === "open" ? "open" : "resolved", assignedName: h.assigned_name ?? undefined,
    })),
    unanswered: (d.unanswered as Raw[]).filter((u) => u.status === "open").map((u) => ({ q: u.question, count: u.times_asked, team: u.team })),
    pulse: d.pulse,
    groups: Object.fromEntries(Object.entries(d.groups as Record<string, number[]>).map(([k, v]) => [k, v.map(String)])),
    prefs: { wellness: !!d.prefs?.wellness_opt_in, nudges: !d.prefs?.nudges_stopped, birthday: !d.prefs?.birthday_opt_out, reminders },
    holidays: (d.holidays as Raw[]).filter((h) => h.location_id == null).map((h) => ({ date: h.date, name: h.name })),
    announcements: (d.announcements as Raw[]).map((a) => ({ title: a.title, body: a.body, at: a.posted_at })),
    attendanceToday: Object.fromEntries((d.attendance_today as Raw[]).map((a) => [String(a.emp_id), a.status])),
    balances,
    audit: (d.audit as Raw[]).map((a) => ({ at: Date.parse(a.created_at), who: a.actor, what: `${a.action} ${a.target ?? ""}`.trim() })),
    usage: d.usage,
    config: d.config,
  };
}

// ---------- store plumbing ----------
let state: State | null = null;
let error = "";
let typing = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let timer: ReturnType<typeof setInterval> | undefined;
let inflight = false;
let again = false;

export async function refresh(): Promise<void> {
  const id = readSession();
  if (!id) return;
  if (inflight) {
    again = true; // a mutation landed mid-poll: poll once more when this one finishes
    return;
  }
  inflight = true;
  try {
    state = toState(await get(`/bot/ui-state?emp_id=${id}`));
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

// ---------- derived ----------
export const balance = (s: State, empId: string): Balance[] =>
  s.balances[empId] ?? [{ code: "CL", type: "Casual", entitled: 0, taken: 0, pending: 0, left: 0 }];
export const leftOf = (s: State, empId: string, code: string) => balance(s, empId).find((b) => b.code === code)?.left ?? 0;

// ---------- leave (HRMS web; chat uses the cards) ----------
export async function applyLeave(empId: string, code: string, start: string, end: string, reason: string) {
  try {
    return await post("/bot/leave/apply", { emp_id: Number(empId), leave_type: code, start_date: start, end_date: end, reason });
  } finally {
    refresh();
  }
}

export async function decideLeave(requestId: string, decision: "approved" | "rejected", by: string) {
  try {
    await post(`/bot/leave/${requestId}/decide`, { approver_id: Number(by), decision: decision === "approved" ? "approve" : "reject" });
  } finally {
    refresh();
  }
}

export async function resolveHandover(id: string, by: string) {
  await post(`/bot/admin/handovers/${id}/resolve`, { hr_id: Number(by) }).finally(refresh);
}

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
    await post("/bot/messages", { emp_id: Number(pid), conversation_id: ch, text });
  } finally {
    typing.delete(ch);
    typing = new Set(typing);
    await refresh();
  }
}

// Card buttons map to the backend's no-AI button handlers (/bot/actions).
const CHECKIN: Record<string, number> = { "Settling in well": 5, "Okay so far": 3, "Finding it hard": 2 };
export async function tapCard(m: Msg, action: string, pid: string) {
  const c = m.card!;
  let a = action;
  let value: string | number | undefined;
  if (c.kind === "leaveConfirm") a = action === "yes" ? "leave_confirm" : "leave_cancel";
  else if (c.kind === "leaveApprove") a = action === "approved" ? "leave_approve" : "leave_reject";
  else if (c.kind === "poll") [a, value] = ["poll_vote", c.options[Number(action)].label];
  else if (c.kind === "pulse") [a, value] = ["pulse_submit", Number(action)];
  else if (c.kind === "checkin") [a, value] = ["checkin_submit", CHECKIN[action] ?? 3];
  else if (c.kind === "nudge") a = { find: "nudge_find_day", later: "nudge_not_now", stop: "nudge_stop" }[action] ?? action;
  else if (c.kind === "handoverNotice") a = "handover_pickup";
  else if (c.kind === "myData") [a, value] = ["pref_toggle", action];
  try {
    await post("/bot/actions", { emp_id: Number(pid), card_id: m.cardId, action: a, value });
  } catch (e) {
    console.warn("card action refused:", (e as Error).message);
  } finally {
    refresh();
  }
}

// ---------- Console ----------
export const JOBS = [
  { name: "birthdays", label: "Birthdays", what: "Posts today's birthdays in #general" },
  { name: "anniversaries", label: "Work anniversaries", what: "Posts today's work anniversaries in #general" },
  { name: "checkins", label: "30-day check-in", what: "Asks new joiners how it's going" },
  { name: "leave_nudges", label: "Leave nudge", what: "Nudges people with no day off in 90 days" },
  { name: "pulse", label: "Weekly pulse", what: "Sends the anonymous 1 to 5 question" },
  { name: "badminton_poll", label: "Group poll", what: "Opens the weekly poll in #badminton" },
] as const;

export async function runJob(name: (typeof JOBS)[number]["name"]): Promise<string[]> {
  try {
    return (await post(`/bot/jobs/${name}/run`)).sent;
  } finally {
    refresh();
  }
}

export const addHoliday = (day: string, name: string) => post("/hrms/holidays", { day, name }).finally(refresh);
export const removeHoliday = (day: string) => call("DELETE", `/hrms/holidays/${day}`).finally(refresh);
export const resetDemo = () => post("/bot/reset").finally(refresh);
export const setOffline = (on: boolean) => post("/bot/admin/offline", { force_offline: on }).finally(refresh);

// ---------- demo sign-in ----------
// Kept in sessionStorage, so each browser tab can be signed in as a different person.
const SESSION = "hrk-user";
const sessionListeners = new Set<() => void>();
const readSession = () => {
  try {
    return sessionStorage.getItem(SESSION);
  } catch {
    return null;
  }
};
export function signIn(id: string) {
  try {
    sessionStorage.setItem(SESSION, id);
  } catch {}
  state = null;
  sessionListeners.forEach((l) => l());
  refresh();
}
export function signOut() {
  try {
    sessionStorage.removeItem(SESSION);
  } catch {}
  state = null;
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
export const useMe = () => useSession() ?? "";
