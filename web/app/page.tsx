import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="flex flex-col gap-6 max-w-xl">
        <span className="eb">DotKonnekt · hackathon demo</span>
        <h1 className="text-5xl font-semibold tracking-tight m-0">HRKonnekt</h1>
        <p className="text-muted text-lg m-0">An HR assistant that answers from policy, applies leave with one tap, and hands sensitive issues to a human.</p>
        <div className="flex gap-3 flex-wrap">
          <Link href="/chat" className="btn">Open chat</Link>
          <Link href="/hrms" className="btn2">Open KonnektHRMS</Link>
          <Link href="/hrms/console" className="btn2">HRKonnekt Console</Link>
        </div>
        <p className="text-sm text-muted m-0">Tip: put Chat and KonnektHRMS side by side. All data is fictional.</p>
      </div>
    </main>
  );
}
