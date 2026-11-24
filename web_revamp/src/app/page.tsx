"use client";
// Sign-in page. The backend checks the email and password; every current employee has an account.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Face, Hydrated, Mark, ThemeToggle, greeting } from "@/components/ui";
import { signIn, useFetch, useSession } from "@/lib/store";

const field = "min-h-12 w-full rounded-xl border border-line bg-ground px-4 text-sm outline-none placeholder:text-muted focus:border-gold";
type Demo = { accounts: { id: string; name: string; email: string; label: string }[]; email_placeholder: string; password_hint: string };

export default function LoginPage() {
  return (
    <Hydrated>
      <Login />
    </Hydrated>
  );
}

function Login() {
  const router = useRouter();
  const session = useSession();
  const demo = useFetch<Demo>("/auth/demo-accounts");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in in this tab: go straight to the right home page.
  useEffect(() => {
    if (session) router.replace(session.home);
  }, [session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return setError("Enter your work email and password.");
    setBusy(true);
    try {
      router.replace(await signIn(email.trim(), password));
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="art relative grid min-h-screen place-items-center px-4 py-14">
      <div className="absolute top-3 right-3 sm:top-5 sm:right-5">
        <ThemeToggle />
      </div>
      <div className="rise w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Mark size={48} />
          <h1 className="text-3xl">KonnektHRMS</h1>
          <p className="text-sm text-muted">{greeting()}. Sign in to continue.</p>
        </div>

        <form onSubmit={submit} className="grid gap-4 rounded-[24px] border border-line bg-cell p-6" noValidate>
          <label className="grid gap-1.5 text-sm">
            Work email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              placeholder={demo?.email_placeholder}
              className={field}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              className={field}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red">
              {error}
            </p>
          )}
          <Button type="submit" className="min-h-12" disabled={busy}>
            {busy ? "Signing in" : "Sign in"}
          </Button>
        </form>

        {demo && demo.accounts.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-1 text-sm text-muted">Demo accounts</h2>
            <p className="mb-2 text-xs text-muted">{demo.password_hint}</p>
            <ul className="grid gap-2">
              {demo.accounts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(a.email);
                      setError("");
                    }}
                    className={`press flex min-h-14 w-full items-center gap-3 rounded-[16px] border bg-cell px-4 text-left ${email === a.email ? "border-gold" : "border-line hover:border-gold"}`}
                  >
                    <Face name={a.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{a.name}</span>
                      <span className="block truncate text-xs text-muted">{a.email}</span>
                    </span>
                    <span className="text-sm text-gold">{a.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
