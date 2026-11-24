"use client";
import { useCallback, useEffect, useState } from "react";

export const API = process.env.NEXT_PUBLIC_API ?? "http://localhost:8000";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = any;

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
export const post = (path: string, body?: unknown) => call("POST", path, body ?? {});

/** Fetch `path` now and every `ms` (3s polling instead of SSE). Pass null to pause. */
export function usePoll<T = Any>(path: string | null, ms = 3000): [T | undefined, () => void] {
  const [data, setData] = useState<T>();
  const load = useCallback(() => {
    if (path) get(path).then(setData).catch(() => {});
  }, [path]);
  useEffect(() => {
    load();
    if (!path) return;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms, path]);
  return [data, load];
}

export function useStored(key: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s) setV(Number(s));
    } catch {}
  }, [key]);
  const set = (n: number) => {
    setV(n);
    try {
      localStorage.setItem(key, String(n));
    } catch {}
  };
  return [v, set];
}

export const fmtDate = (d: string) =>
  new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
export const initials = (name: string) => name.split(" ").map((p) => p[0]).join("").slice(0, 2);

/** Current date, set after mount (Next prerender must not read the clock). */
export function useToday() {
  const [d, setD] = useState<Date | null>(null);
  useEffect(() => { setD(new Date()); }, []);
  return d;
}
