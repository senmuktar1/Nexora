"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight, ArrowUpRight, Check,
  ChevronDown, Coins, Compass, Copy, ExternalLink,
  Gift, Github, Moon, Rocket, Search,
  LockKeyhole, ShieldCheck, Sun, Unlock, User, Wallet, X
} from "lucide-react";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import DeleteAccount from "@/components/wallet/DeleteAccount";
import ReceiptExperience from "@/components/nexora/receipt/ReceiptExperience";
import PayExperience from "@/components/nexora/pay/PayExperience";
import IssuerEvidence from "@/components/nexora/assets/IssuerEvidence";
import LegalPage, { type LegalKind, type LegalProps } from "@/components/nexora/legal/LegalPage";
import { SITE } from "@/lib/site";
import LaunchExperience from "@/components/nexora/launch/LaunchExperience";
import VouchersExperience from "@/components/nexora/vouchers/VouchersExperience";
import ExploreExperience from "@/components/nexora/explore/ExploreExperience";
import SwapExperience from "@/components/nexora/swap/SwapExperience";
import LendingExperience from "@/components/nexora/lending/LendingExperience";
import ProfileExperience from "@/components/nexora/profile/ProfileExperience";
import RwaExperience from "@/components/rwa/RwaExperience";

type PageKey = "notfound" | "receipt" | "pay" | "explore" | "swap" | "lend" | "vouchers" | "launch" | "rwa" | "account" | "assets" | "profile" | "docs" | "help" | "legal";
type AssetRecord = { asset_code: string; asset_issuer: string; num_accounts?: string; amount?: string; auth_required?: boolean; auth_revocable?: boolean; auth_immutable?: boolean };

const NAV = [
  { label: "Explore", href: "/", key: "explore" as PageKey },
  { label: "Swap", href: "/swap", key: "swap" as PageKey },
  { label: "Lend & Stake", href: "/lend", key: "lend" as PageKey },
  { label: "Vouchers", href: "/vouchers", key: "vouchers" as PageKey },
  { label: "Launch", href: "/launch", key: "launch" as PageKey },
  { label: "RWA", href: "/rwa", key: "rwa" as PageKey },
  { label: "Profile", href: "/profile", key: "profile" as PageKey }
];

const ISSUER_REFERENCES = [
  { ticker: "BENJI", issuer: "Franklin Templeton", summary: "Tokenized U.S. government money market fund", href: "https://stellar.org/case-studies/franklin-templeton" },
  { ticker: "SAFO", issuer: "Spiko / Amundi", summary: "Tokenized money market fund reference", href: "https://stellar.org/solutions/real-world-assets" },
  { ticker: "WISDOMTREE", issuer: "WisdomTree", summary: "Digital funds with issuer-controlled transfer approval", href: "https://stellar.org/solutions/real-world-assets" },
  { ticker: "USDY", issuer: "Ondo", summary: "Treasury-backed tokenized product reference", href: "https://stellar.org/solutions/real-world-assets" }
];

function resolvePage(pathname: string): PageKey {
  if (pathname.startsWith("/swap")) return "swap";
  if (pathname.startsWith("/lend") || pathname.startsWith("/earn")) return "lend";
  if (pathname.startsWith("/receipt/")) return "receipt";
  if (pathname.startsWith("/pay/")) return "pay";
  if (pathname.startsWith("/voucher") || pathname.startsWith("/redeem")) return "vouchers";
  if (pathname.startsWith("/launch")) return "launch";
  if (pathname === "/rwa" || pathname.startsWith("/rwa/") || pathname === "/account" || pathname.startsWith("/account/")) return "rwa";
  if (pathname.startsWith("/assets") || pathname.startsWith("/explore/token/")) return "assets";
  if (pathname.startsWith("/profile") || pathname.startsWith("/creator/")) return "profile";
  if (pathname.startsWith("/docs")) return "docs";
  if (pathname.startsWith("/help")) return "help";
  return "explore";
}

function shortAddress(address: string) { return `${address.slice(0, 6)}…${address.slice(-5)}`; }

export default function NexoraApp({ notFound = false, legal }: { notFound?: boolean; legal?: { kind: LegalKind; config: LegalProps } } = {}) {
  const pathname = usePathname();
  const page: PageKey = notFound ? "notfound" : legal ? "legal" : resolvePage(pathname);
  const creatorProfileAddress = pathname.startsWith("/creator/") ? pathname.slice("/creator/".length).split("/")[0] || null : null;
  const { address, network, status, unlocked, requestWallet, lock } = useStellarWallet();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [accountMenu, setAccountMenu] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("nexora-theme");
    const next = saved === "light" || saved === "dark" ? saved : "dark";
    const frame = window.requestAnimationFrame(() => {
      setTheme(next);
      document.documentElement.dataset.theme = next;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setAccountMenu(false);
      setSearchOpen(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    if (!accountMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) {
        setAccountMenu(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [accountMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setAccountMenu(false);
      }
    };
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-palette", openSearch);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", openSearch);
    };
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("nexora-theme", next);
  }

  function handleConnect() {
    void requestWallet();
  }

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return <main className="nx-app">
    <header className="nx-header">
      <div className="nx-header-inner">
        <Link href="/" className="nx-brand" aria-label="NEXORA home">
          <span className="nx-brand-mark">
            <Image src="/nexora-mark.svg" alt="NEXORA" width={35} height={35} priority/>
          </span>
          <span className="nx-brand-copy">
            <strong>NEXORA</strong>
            <small>STELLAR FINANCIAL TERMINAL</small>
          </span>
        </Link>

        <nav className="nx-nav" aria-label="Main navigation">
          {NAV.map((item) => <Link
            key={item.key}
            href={item.href}
            aria-current={page === item.key || (item.key === "explore" && page === "assets") ? "page" : undefined}
            className={page === item.key || (item.key === "explore" && page === "assets") ? "nx-nav-link active" : "nx-nav-link"}
          >{item.label}</Link>)}
        </nav>

        <div className="nx-header-actions">
          <button className="nx-icon-button" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle light and dark mode">
            {theme === "dark" ? <Moon size={16}/> : <Sun size={16}/>}
          </button>

          {address ? <div className="nx-account-wrap" ref={accountMenuRef}>
            <button className="nx-wallet-button nx-wallet-connected" onClick={() => setAccountMenu(!accountMenu)} aria-expanded={accountMenu} aria-label="Account menu">
              {unlocked ? <span className="nx-live-dot"/> : <LockKeyhole size={12}/>}<span className="nx-wallet-address">{shortAddress(address)}</span><ChevronDown size={14}/>
            </button>
            {accountMenu && <div className="nx-account-menu">
              <div className="nx-account-label">WALLET</div>
              <div className="nx-address-full">{address}</div>
              <button className="nx-menu-row" onClick={() => void copyAddress()}>
                {copied ? <Check size={14}/> : <Copy size={14}/>}
                {copied ? "Copied address" : "Copy address"}
              </button>
              <Link href="/profile" className="nx-menu-row"><Wallet size={14}/> Portfolio & profile</Link>
              {unlocked
                ? <button className="nx-menu-row" onClick={() => { lock(); setAccountMenu(false); }}><LockKeyhole size={14}/> Lock wallet</button>
                : <button className="nx-menu-row" onClick={() => { setAccountMenu(false); handleConnect(); }}><Unlock size={14}/> Unlock wallet</button>}
            </div>}
          </div> : status === "none" ? <button className="nx-wallet-button" onClick={handleConnect}>
            <span className="nx-connect-label-desktop">Create or import wallet</span>
            <span className="nx-connect-label-mobile">Wallet</span>
          </button> : null}
        </div>
      </div>
    </header>

    <div className="nx-container">
      <div className="nx-mobile-search-wrap">
        <button className="nx-mobile-search" type="button" onClick={() => setSearchOpen(true)}>
          <Search size={15}/>
          <span>Search tokens &amp; pages</span>
          <kbd>⌘ K</kbd>
        </button>
      </div>

      {page === "explore" && <ExploreExperience network={network} onOpenSearch={() => window.dispatchEvent(new Event("open-command-palette"))}/>}
      {page === "swap" && <SwapExperience network={network} address={address} onConnect={handleConnect}/>}
      {page === "lend" && <LendingExperience network={network} address={address} onConnect={handleConnect}/>}
      {page === "vouchers" && <VouchersExperience network={network} connected={!!address} onConnect={handleConnect}/>}
      {page === "launch" && <LaunchExperience network={network} connected={!!address} onConnect={handleConnect}/>}
      {page === "rwa" && <RwaExperience pathname={pathname}/>}
      {page === "assets" && <AssetsPage network={network}/>}
      {page === "profile" && <ProfileExperience network={network} address={address} profileAddress={creatorProfileAddress} onConnect={handleConnect}/>}
      {page === "profile" && !creatorProfileAddress && <DeleteAccount/>}
      {page === "docs" && <InfoPage title="Documents" eyebrow="NEXORA DOCS" description="How NEXORA protects keys, verifies transactions and handles data." links={[...(SITE.repositoryUrl?[{label:"Security model",href:SITE.repositoryUrl+"/blob/main/docs/SECURITY.md"},{label:"README",href:SITE.repositoryUrl+"#readme"}]:[]),{label:"Stellar developer docs",href:"https://developers.stellar.org/"}]}/>}
      {page === "help" && <InfoPage title="How can we help?" eyebrow="NEXORA SUPPORT" description="Guides for setting up your wallet, verifying assets and using NEXORA safely." links={[...(SITE.repositoryUrl?[{label:"Source code",href:SITE.repositoryUrl}]:[]),{label:"Stellar developer docs",href:"https://developers.stellar.org/"}]}/>}
      {page === "legal" && legal && <LegalPage kind={legal.kind} config={legal.config}/>}
      {page === "notfound" && <InfoPage title="Page not found" eyebrow="404" description="This page doesn’t exist or has moved." links={[{label:"Go to Explore",href:"/"}]}/>}
      {page === "receipt" && <ReceiptExperience hash={pathname.slice("/receipt/".length).split("/")[0].toLowerCase()}/>}
      {page === "pay" && <PayExperience recipient={pathname.slice("/pay/".length).split("/")[0]}/>}
    </div>

    <footer className="nx-reference-footer">
      <div className="nx-reference-footer-main">
        <div className="nx-reference-footer-brand">
          <div className="nx-reference-footer-logo"><Image src="/nexora-mark.svg" alt="NEXORA" width={34} height={34}/><strong>NEXORA</strong><span>STELLAR</span></div>
          <p>Discover Stellar assets, compare market data, explore lending and yield protocols, prepare token launches, and share digital vouchers — from one wallet-controlled workspace.</p>
          <div className="nx-reference-footer-principle"><ShieldCheck size={14}/><span>Built around public Stellar data and transparent transaction review.</span></div>
        </div>
        <nav className="nx-reference-footer-columns" aria-label="Footer navigation">
          <div><strong>PRODUCTS</strong><Link href="/">Explore</Link><Link href="/swap">Swap</Link><Link href="/launch">Launchpad</Link><Link href="/rwa">RWA Offerings</Link></div>
          <div><strong>FINANCE</strong><Link href="/lend">Lend &amp; Stake</Link><Link href="/vouchers">Voucher Center</Link><Link href="/profile">Creator Profile</Link><Link href="/rwa/apply">Tokenize an Asset</Link><Link href="/account">Account</Link></div>
          <div><strong>LEGAL &amp; SAFETY</strong><Link href="/terms">Terms of Service</Link><Link href="/privacy">Privacy Policy</Link><Link href="/risk-disclosure">Risk Disclosure</Link><Link href="/wallet-security">Wallet Security</Link><Link href="/restricted-regions">Regional Availability</Link></div>
          <div><strong>RESOURCES</strong><Link href="/docs">Documents</Link><Link href="/help">Help Center</Link><a href="https://developers.stellar.org/" target="_blank" rel="noreferrer">Stellar Developers <ExternalLink size={11}/></a>{SITE.repositoryUrl&&<a href={SITE.repositoryUrl} target="_blank" rel="noreferrer"><Github size={12}/> GitHub <ExternalLink size={11}/></a>}</div>
        </nav>
      </div>
      <div className="nx-reference-footer-bottom">
        <div><span>© {new Date().getFullYear()} NEXORA · Built for Stellar</span>{SITE.repositoryUrl&&<a href={SITE.repositoryUrl} target="_blank" rel="noreferrer"><Github size={13}/> Verify open source on GitHub <ExternalLink size={10}/></a>}</div>
        <div><span>Wallet-controlled interface</span><i>·</i><span>Not financial, legal or tax advice</span></div>
      </div>
    </footer>

    <MobileBottomNav page={page}/>

    {searchOpen && <div className="nx-command-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setSearchOpen(false);
    }}>
      <section className="nx-command-dialog" role="dialog" aria-modal="true" aria-label="Search NEXORA">
        <div className="nx-command-top">
          <Search size={18}/>
          <input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search assets, markets and pages…"/>
          <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={17}/></button>
        </div>
        <div className="nx-command-list">
          <span>WORKSPACE</span>
          {[...NAV, {label:"Asset directory",href:"/assets",key:"assets" as PageKey},{label:"Account",href:"/account",key:"account" as PageKey},{label:"Documents",href:"/docs",key:"docs" as PageKey},{label:"Help",href:"/help",key:"help" as PageKey}]
            .filter((item) => !searchQuery.trim() || item.label.toLowerCase().includes(searchQuery.trim().toLowerCase()))
            .map((item) => <Link key={item.key} href={item.href} onClick={() => setSearchOpen(false)}>
              <span>{item.label}</span><ArrowUpRight size={14}/>
            </Link>)}
          {!([...NAV, {label:"Asset directory",href:"/assets",key:"assets" as PageKey},{label:"Account",href:"/account",key:"account" as PageKey},{label:"Documents",href:"/docs",key:"docs" as PageKey},{label:"Help",href:"/help",key:"help" as PageKey}]).some((item) => !searchQuery.trim() || item.label.toLowerCase().includes(searchQuery.trim().toLowerCase())) && <p>No matching NEXORA page.</p>}
        </div>
        <div className="nx-command-footer"><span>Navigate to a workspace page</span><kbd>ESC</kbd></div>
      </section>
    </div>}
  </main>;
}

function MobileBottomNav({ page }: { page: PageKey }) {
  const items = [
    { label:"Explore", href:"/", key:"explore" as PageKey, icon:Compass, active:page==="explore" || page==="assets" },
    { label:"Swap", href:"/swap", key:"swap" as PageKey, icon:ArrowLeftRight, active:page==="swap" },
    { label:"Lend", href:"/lend", key:"lend" as PageKey, icon:Coins, active:page==="lend" },
    { label:"Launch", href:"/launch", key:"launch" as PageKey, icon:Rocket, active:page==="launch" },
    { label:"Vouchers", href:"/vouchers", key:"vouchers" as PageKey, icon:Gift, active:page==="vouchers" },
    { label:"Profile", href:"/profile", key:"profile" as PageKey, icon:User, active:page==="profile" }
  ];
  return <nav className="nx-mobile-bottom-nav" aria-label="Mobile navigation">
    {items.map(({label,href,key,icon:Icon,active}) => <Link
      key={key}
      href={href}
      aria-current={active ? "page" : undefined}
      className={active ? "nx-mobile-nav-item active" : "nx-mobile-nav-item"}
    >
      <span className="nx-mobile-nav-icon"><Icon size={19} strokeWidth={active ? 2.3 : 1.8}/>{active && <i/>}</span>
      <span className="nx-mobile-nav-label">{label}</span>
    </Link>)}
  </nav>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="nx-page-heading"><div><div className="nx-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div></div>;
}


function AssetsPage({ network, embedded = false }: { network: "testnet" | "mainnet"; embedded?: boolean }) {
  const [query, setQuery] = useState("USDC");
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [inspect, setInspect] = useState<{ code: string; issuer: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      const frame = window.requestAnimationFrame(() => {
        if (!cancelled) {
          setAssets([]);
          setSearched(false);
          setLoading(false);
        }
      });
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(frame);
      };
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/stellar/assets?code=${encodeURIComponent(query.trim())}&network=${network}`, {cache:"no-store"})
        .then(async (response) => { if (!response.ok) throw new Error("Could not query Horizon."); return response.json(); })
        .then((data) => { if (!cancelled) { setAssets(data.assets ?? []); setSearched(true); } })
        .catch(() => { if (!cancelled) { setAssets([]); setSearched(true); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, network]);
  return <>
    {!embedded && <PageHeading eyebrow="ASSET DISCOVERY" title="Explore Stellar assets." description="Search Stellar assets by code and check who issued them."/>}
    <div className={embedded ? "nx-panel nx-assets-embedded" : "nx-panel nx-assets-panel"}>
      <div className="nx-panel-header"><div><div className="nx-panel-kicker">STELLAR ASSET DIRECTORY</div><h2>Search issued assets</h2></div></div>
      <div className="nx-directory-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Enter asset code (e.g. USDC)"/><button onClick={() => setQuery(query.trim())}>Search</button></div>
      <div className="nx-asset-table"><div className="nx-table-head"><span>ASSET</span><span>ISSUER ACCOUNT</span><span>HOLDERS</span><span>ISSUER</span></div>
        {loading ? <div className="nx-table-message">Searching…</div> : assets.length ? assets.map((asset) => <div className="nx-table-row" key={`${asset.asset_code}-${asset.asset_issuer}`}><div><strong>{asset.asset_code}</strong><small>Classic Stellar asset</small></div><code title={asset.asset_issuer}>{shortAddress(asset.asset_issuer)}</code><span>{asset.num_accounts ?? "—"}</span><button type="button" className="nx-table-status nx-evidence-button" onClick={() => setInspect({ code: asset.asset_code, issuer: asset.asset_issuer })}>Check issuer</button></div>) : searched ? <div className="nx-table-message">No assets match “{query}”.</div> : null}
      </div>
      <div className="nx-info-note"><ShieldCheck size={15}/> Anyone can issue a Stellar asset under any code. Check the issuer before holding it.</div>
    </div>
    {inspect && <IssuerEvidence code={inspect.code} issuer={inspect.issuer} onClose={() => setInspect(null)}/>}
    {!embedded && <section className="nx-panel nx-rwa-references"><div className="nx-panel-header"><div><div className="nx-panel-kicker">ISSUER DISCOVERY</div><h2>Institutional RWA ecosystem references</h2></div><Link href="https://stellar.org/solutions/real-world-assets" target="_blank" className="nx-text-link">Stellar overview <ExternalLink size={13}/></Link></div><div className="nx-issuer-grid">{ISSUER_REFERENCES.map((item) => <Link key={item.ticker} href={item.href} target="_blank" className="nx-rwa-reference"><strong>{item.ticker}</strong><span>{item.issuer}</span><small>{item.summary}</small><em>stellar.org reference <ArrowUpRight size={12}/></em></Link>)}</div></section>}
  </>;
}


function InfoPage({ title, eyebrow, description, links }: { title: string; eyebrow: string; description: string; links: {label:string;href:string}[] }) {
  return <div className="nx-info-page"><div className="nx-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p><div className="nx-info-link-list">{links.map((link) => <Link key={link.href} href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined}>{link.label}<ArrowUpRight size={15}/></Link>)}</div></div>;
}
