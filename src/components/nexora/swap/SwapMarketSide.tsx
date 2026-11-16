"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

type Side = { code: string; issuer: string | null };
type Book = { bid: number | null; ask: number | null; at: string };

function selector(prefix: "base" | "counter", a: Side) {
  return a.issuer ? `${prefix}Code=${encodeURIComponent(a.code)}&${prefix}Issuer=${a.issuer}` : "";
}

/** Live top-of-book for the selected pair (price of `from` in units of `to`). */
export default function SwapMarketSide({ from, to }: { from: Side; to: Side }) {
  const key = `${from.code}:${from.issuer}|${to.code}:${to.issuer}`;
  const [result, setResult] = useState<{ key: string; book: Book | null } | null>(null);
  const book = result?.key === key ? result.book : null;
  const state: "loading" | "ready" | "unavailable" = result?.key !== key ? "loading" : book ? "ready" : "unavailable";

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const qs = ["network=mainnet", "limit=1", selector("base", from), selector("counter", to)].filter(Boolean).join("&");
      fetch(`/api/stellar/orderbook?${qs}`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : Promise.reject(new Error("unavailable")))
        .then(d => {
          if (cancelled) return;
          const bid = Number(d.orderBook?.bids?.[0]?.price);
          const ask = Number(d.orderBook?.asks?.[0]?.price);
          setResult({ key, book: { bid: Number.isFinite(bid) && bid > 0 ? bid : null, ask: Number.isFinite(ask) && ask > 0 ? ask : null, at: d.retrievedAt } });
        })
        .catch(() => { if (!cancelled) setResult({ key, book: null }); });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures the pair identity
  }, [key]);

  const fmt = (n: number | null) => n === null ? "—" : n.toLocaleString(undefined, { maximumSignificantDigits: 7 });
  const spread = book?.bid && book?.ask ? ((book.ask - book.bid) / book.ask) * 100 : null;

  return <aside className="nx-swap-sidebar">
    <section className="nx-panel nx-swap-market-side">
      <div className="nx-panel-header"><div><div className="nx-panel-kicker">ORDER BOOK</div><h2>{from.code} / {to.code}</h2></div></div>
      <div className="nx-swap-market-stat"><span>Best bid</span><strong>{state === "ready" ? fmt(book?.bid ?? null) : "—"}</strong></div>
      <div className="nx-swap-market-stat"><span>Best ask</span><strong>{state === "ready" ? fmt(book?.ask ?? null) : "—"}</strong></div>
      <div className="nx-swap-market-stat"><span>Spread</span><strong>{state === "ready" && spread !== null ? `${spread.toFixed(2)}%` : "—"}</strong></div>
      <div className="nx-swap-market-stat"><span>Source</span><strong>{state === "unavailable" ? "Unavailable" : state === "loading" ? "Loading…" : `Stellar DEX · ${new Date(book!.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</strong></div>
      <Link href="/explore" className="nx-swap-market-link">Explore markets <ArrowRight size={13}/></Link>
    </section>
  </aside>;
}
