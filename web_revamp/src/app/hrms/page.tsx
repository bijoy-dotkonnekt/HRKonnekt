"use client";
// /hrms on its own: go to the signed-in person's home page (the backend decides which one).

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/store";

export default function Hrms() {
  const router = useRouter();
  const session = useSession();
  useEffect(() => router.replace(session?.home ?? "/"), [session, router]);
  return null;
}
