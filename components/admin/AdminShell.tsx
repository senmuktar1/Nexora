"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ClipboardList, FileClock, Gauge, Landmark, LoaderCircle, LogOut, Moon, Settings, ShieldCheck, Sun, Users } from "lucide-react";
import { api } from "@/components/rwa/api";
import { Field, Notice } from "@/components/rwa/ui";

type Status = {
  ready: { database: boolean; encryption: boolean; email: boolean; adminEmail: boolean };
  bootstrapAvailable: boolean;
  session: null | { email: string; role: string; mfaEnabled: boolean; mfaPassed: boolean; permissions: string[] };
};

const AdminContext = createContext<{ email: string; role: string; permissions: string[] }>({ email: "", role: "", permissions: [] });
export const useAdmin = () => useContext(AdminContext);

const NAV = [
  { href: "/admin", label: "Overview", icon: Gauge, perm: "applications.read" },
  { href: "/admin/applications", label: "Applications", icon: ClipboardList, perm: "applications.read" },
  { href: "/admin/assets", label: "Assets & tokens", icon: Landmark, perm: "applications.read" },
  { href: "/admin/users", label: "Users & issuers", icon: Users, perm: "users.read" },
  { href: "/admin/audit", label: "Audit log", icon: FileClock, perm: "audit.read" },
  { href: "/admin/settings", label: "Settings", icon: Settings, perm: "settings.manage" }
];

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem("nexora-theme"); } catch { /* storage unavailable */ }
    const next = saved === "light" ? "light" : "dark";
    const f = window.requestAnimationFrame(() => { setTheme(next); document.documentElement.dataset.theme = next; });
    return () => window.cancelAnimationFrame(f);
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem("nexora-theme", next); } catch { /* ignore */ }
  };
  return { theme, toggle };
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");
  const { theme, toggle } = useTheme();

  const refresh = useCallback(async () => {
    const r = await api<Status>("/api/admin/auth/status");
    if (r.ok) { setStatus(r.data); setLoadError(""); } else setLoadError(r.error);
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(t); }, [refresh]);

  const brand = <div className="nx-admin-brand"><Image src="/nexora-mark.svg" alt="" width={30} height={30}/><div><strong>NEXORA</strong><small>ADMINISTRATION</small></div></div>;
  const themeButton = <button className="nx-icon-button" onClick={toggle} aria-label="Toggle theme">{theme === "dark" ? <Moon size={15}/> : <Sun size={15}/>}</button>;

  if (pathname === "/admin/verify") return <AuthFrame brand={brand} themeButton={themeButton}><VerifyScreen onDone={refresh}/></AuthFrame>;
  if (!status) return <AuthFrame brand={brand} themeButton={themeButton}>
    {loadError ? <Notice kind="error">{loadError}</Notice> : <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Loading…</p>}
  </AuthFrame>;

  const s = status.session;
  if (!s || !s.mfaEnabled || !s.mfaPassed) return <AuthFrame brand={brand} themeButton={themeButton}><AuthScreens status={status} onChange={refresh}/></AuthFrame>;

  const allowed = NAV.filter(n => s.permissions.includes(n.perm));
  return <AdminContext.Provider value={{ email: s.email, role: s.role, permissions: s.permissions }}>
    <div className="nx-admin">
      <aside className="nx-admin-side">
        {brand}
        <nav aria-label="Administration">
          {allowed.map(({ href, label, icon: Icon }) => {
            const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
            return <Link key={href} href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}><Icon size={16}/>{label}</Link>;
          })}
        </nav>
        <div className="nx-admin-side-foot">
          <div className="nx-admin-who"><ShieldCheck size={14}/><span>{s.email}</span><small>{s.role === "super_admin" ? "Super Admin" : s.role}</small></div>
          <div className="nx-admin-side-actions">{themeButton}<SignOut onDone={refresh}/></div>
        </div>
      </aside>
      <main className="nx-admin-main">{children}</main>
    </div>
  </AdminContext.Provider>;
}

function SignOut({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return <button className="nx-admin-signout" disabled={busy} onClick={async () => { setBusy(true); await api("/api/admin/auth/logout", { body: {} }); setBusy(false); onDone(); }}>
    <LogOut size={14}/> Sign out
  </button>;
}

function AuthFrame({ brand, themeButton, children }: { brand: ReactNode; themeButton: ReactNode; children: ReactNode }) {
  return <div className="nx-admin-auth">
    <div className="nx-admin-auth-top">{brand}{themeButton}</div>
    <section className="nx-admin-auth-card">{children}</section>
    <p className="nx-admin-auth-foot">Restricted area. Access is limited to authorised NEXORA administrators and every action is logged.</p>
  </div>;
}

function AuthScreens({ status, onChange }: { status: Status; onChange: () => void }) {
  const s = status.session;
  const [mode, setMode] = useState<"login" | "bootstrap">(status.bootstrapAvailable ? "bootstrap" : "login");
  if (s && !s.mfaEnabled) return <MfaSetup onDone={onChange}/>;
  if (s && !s.mfaPassed) return <MfaVerify onDone={onChange}/>;
  const missing = Object.entries(status.ready).filter(([, ok]) => !ok).map(([k]) => ({ database: "DATABASE_URL", encryption: "DATA_ENCRYPTION_KEY", email: "email delivery (RESEND_API_KEY + EMAIL_FROM)", adminEmail: "NEXORA_ADMIN_EMAIL" }[k]));
  return <>
    <h1>{mode === "bootstrap" ? "Set up administration" : "Administrator sign in"}</h1>
    {missing.length > 0 && <Notice kind="info">Server configuration incomplete: {missing.join(", ")}. See the deployment guide.</Notice>}
    {mode === "bootstrap" ? <BootstrapForm/> : <LoginForm onDone={onChange}/>}
    {status.bootstrapAvailable && <button type="button" className="nx-admin-link" onClick={() => setMode(mode === "login" ? "bootstrap" : "login")}>
      {mode === "login" ? "First-time setup" : "Already set up? Sign in"}
    </button>}
  </>;
}

function PasswordInput({ value, onChange, label = "Password", autoComplete }: { value: string; onChange: (v: string) => void; label?: string; autoComplete: string }) {
  return <Field label={label}><input className="nx-wallet-input" type="password" value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} required minLength={12} maxLength={200}/></Field>;
}

function BootstrapForm() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) return <Notice kind="success">Check the inbox of the administrator email for a confirmation link. Open it on this device and enter the same password.</Notice>;
  return <form className="nx-admin-form" onSubmit={async e => {
    e.preventDefault();
    if (pw !== pw2) { setError("The passwords don't match."); return; }
    setBusy(true); setError("");
    const r = await api("/api/admin/auth/bootstrap", { body: { email, password: pw } });
    setBusy(false);
    if (r.ok) setSent(true); else setError(r.error);
  }}>
    <p className="nx-admin-help">This one-time setup is only available to the administrator email configured on the server.</p>
    <Field label="Administrator email"><input className="nx-wallet-input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required/></Field>
    <PasswordInput value={pw} onChange={setPw} autoComplete="new-password"/>
    <PasswordInput value={pw2} onChange={setPw2} label="Confirm password" autoComplete="new-password"/>
    <small className="nx-admin-help">At least 12 characters.</small>
    {error && <Notice kind="error">{error}</Notice>}
    <button className="nx-wallet-primary" disabled={busy}>{busy ? <LoaderCircle className="nx-spin" size={15}/> : null}Send confirmation link</button>
  </form>;
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="nx-admin-form" onSubmit={async e => {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await api("/api/admin/auth/login", { body: { email, password: pw } });
    setBusy(false);
    if (r.ok) { setPw(""); onDone(); } else setError(r.error);
  }}>
    <Field label="Email"><input className="nx-wallet-input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required/></Field>
    <PasswordInput value={pw} onChange={setPw} autoComplete="current-password"/>
    {error && <Notice kind="error">{error}</Notice>}
    <button className="nx-wallet-primary" disabled={busy}>{busy ? <LoaderCircle className="nx-spin" size={15}/> : null}Continue</button>
  </form>;
}

function VerifyScreen({ onDone }: { onDone: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <>
    <h1>Confirm administrator setup</h1>
    {!token ? <Notice kind="error">This link is incomplete. Open the link from the email again.</Notice> :
      <form className="nx-admin-form" onSubmit={async e => {
        e.preventDefault();
        setBusy(true); setError("");
        const r = await api("/api/admin/auth/verify", { body: { token, password: pw } });
        setBusy(false);
        if (r.ok) { onDone(); router.replace("/admin"); } else setError(r.error);
      }}>
        <p className="nx-admin-help">Enter the password you chose when you started the setup.</p>
        <PasswordInput value={pw} onChange={setPw} autoComplete="current-password"/>
        {error && <Notice kind="error">{error}</Notice>}
        <button className="nx-wallet-primary" disabled={busy}>Confirm</button>
      </form>}
  </>;
}

function MfaSetup({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (codes) return <>
    <h1>Save your recovery codes</h1>
    <p className="nx-admin-help">Each code works once if you lose your authenticator. Store them offline; they won’t be shown again.</p>
    <pre className="nx-wallet-code nx-admin-codes" aria-label="Recovery codes">{codes.join("\n")}</pre>
    <label className="nx-wallet-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}/>I have stored these recovery codes safely.</label>
    <button className="nx-wallet-primary" disabled={!saved} onClick={onDone}>Open the admin portal</button>
  </>;

  return <>
    <h1>Set up two-factor authentication</h1>
    <p className="nx-admin-help">Two-factor authentication is required for administrators. Use an authenticator app (e.g. 1Password, Google Authenticator, Authy).</p>
    {!setup ? <>
      {error && <Notice kind="error">{error}</Notice>}
      <button className="nx-wallet-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        const r = await api<{ secret: string; qr: string }>("/api/admin/auth/mfa/setup", { body: {} });
        setBusy(false);
        if (r.ok) setSetup(r.data); else setError(r.error);
      }}>Start setup</button>
    </> : <form className="nx-admin-form" onSubmit={async e => {
      e.preventDefault();
      setBusy(true); setError("");
      const r = await api<{ recoveryCodes: string[] }>("/api/admin/auth/mfa/enable", { body: { code } });
      setBusy(false);
      if (r.ok) setCodes(r.data.recoveryCodes); else setError(r.error);
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="Authenticator QR code" width={180} height={180} className="nx-admin-qr"/>
      <Field label="Or enter this key manually"><code className="nx-wallet-code" data-testid="mfa-secret">{setup.secret}</code></Field>
      <Field label="6-digit code from the app"><input className="nx-wallet-input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} required/></Field>
      {error && <Notice kind="error">{error}</Notice>}
      <button className="nx-wallet-primary" disabled={busy || code.length !== 6}>Turn on two-factor authentication</button>
    </form>}
  </>;
}

function MfaVerify({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <>
    <h1>Two-factor verification</h1>
    <form className="nx-admin-form" onSubmit={async e => {
      e.preventDefault();
      setBusy(true); setError("");
      const r = await api("/api/admin/auth/mfa/verify", { body: useRecovery ? { recoveryCode: code } : { code } });
      setBusy(false);
      if (r.ok) onDone(); else { setError(r.error); setCode(""); }
    }}>
      {useRecovery
        ? <Field label="Recovery code"><input className="nx-wallet-input" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" required/></Field>
        : <Field label="6-digit code from your authenticator app"><input className="nx-wallet-input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} required/></Field>}
      {error && <Notice kind="error">{error}</Notice>}
      <button className="nx-wallet-primary" disabled={busy}>Verify</button>
      <button type="button" className="nx-admin-link" onClick={() => { setUseRecovery(!useRecovery); setCode(""); setError(""); }}>{useRecovery ? "Use authenticator code" : "Use a recovery code"}</button>
    </form>
  </>;
}
