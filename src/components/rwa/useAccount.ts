"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export type AccountUser = { email: string; verified: boolean; stellarAddress: string | null };

/** The signed-in NEXORA account (separate from the local wallet, which never leaves the browser). */
export function useAccount() {
  const [state, setState] = useState<{ loading: boolean; available: boolean; user: AccountUser | null; error: string }>({ loading: true, available: true, user: null, error: "" });
  const reload = useCallback(async () => {
    const r = await api<{ available: boolean; user: AccountUser | null }>("/api/account/me");
    setState(r.ok ? { loading: false, available: r.data.available, user: r.data.user, error: "" } : { loading: false, available: true, user: null, error: r.error });
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void reload(), 0); return () => window.clearTimeout(t); }, [reload]);
  return { ...state, reload };
}
