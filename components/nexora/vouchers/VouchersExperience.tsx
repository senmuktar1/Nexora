"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { VoucherCreateFlow, VoucherMine, VoucherRedeem } from "./VoucherFlows";
import { splitEvenly, VOUCHER_ASSETS } from "@/lib/stellar/voucher";
import {
  AlertCircle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Gift, Minus, Plus, QrCode,
  ShieldCheck, Share2, Wallet
} from "lucide-react";

type Network = "testnet" | "mainnet";
type View = "create" | "redeem" | "link" | "mine";
type Asset = "XLM" | "USDC";
type Theme = "emerald" | "midnight" | "graphite" | "light";
type Step = 1 | 2 | 3 | 4;

const ASSETS: {id: Asset; label: string; description: string; icon: string}[] = [
  {id: "XLM", label: "Stellar Lumens", description: "Native Stellar asset", icon: "✦"},
  {id: "USDC", label: "USD Coin", description: "Circle-issued Stellar USDC", icon: "$"},
];

const THEMES: {id: Theme; label: string; surface: string; accent: string}[] = [
  {id: "emerald", label: "Emerald", surface: "linear-gradient(135deg,#063a2c 0%,#0d7854 48%,#04251d 100%)", accent: "#7df0bd"},
  {id: "midnight", label: "Midnight", surface: "linear-gradient(135deg,#111827 0%,#24374d 55%,#080f1d 100%)", accent: "#a9c8f5"},
  {id: "graphite", label: "Graphite", surface: "linear-gradient(135deg,#181c20 0%,#3d454b 55%,#111417 100%)", accent: "#d2e4d9"},
  {id: "light", label: "Pearl", surface: "linear-gradient(135deg,#e1eee7 0%,#a9d3bf 55%,#f5f8f6 100%)", accent: "#0c4d37"}
];

const OCCASIONS = [
  {label:"Thank you", emoji:"💚", message:"Thank you for being part of the journey. This gift is for you."},
  {label:"Celebration", emoji:"🎉", message:"A little gift to celebrate your next milestone. Enjoy!"},
  {label:"Community reward", emoji:"✨", message:"You made this community better. Here is a reward for your contribution."},
  {label:"Just because", emoji:"🎁", message:"No special reason. Just something to brighten your day."}
];

const STEPS = [
  {id:1 as const,label:"Choose asset",detail:"Select the value to gift"},
  {id:2 as const,label:"Amount & split",detail:"Set total and card count"},
  {id:3 as const,label:"Personalize",detail:"Message and card style"},
  {id:4 as const,label:"Review",detail:"Check the voucher details"}
];

function parseStellarAmount(value:string):bigint|null {
  const trimmed=value.trim();
  if(!/^(?:\d+)(?:\.\d{1,7})?$/.test(trimmed)) return null;
  const [whole,fraction=""]=trimmed.split(".");
  try { return BigInt(whole)*BigInt(10000000)+BigInt((fraction+"0000000").slice(0,7)); }
  catch { return null; }
}

function formatAmount(value: string, decimals = 7) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined,{maximumFractionDigits:decimals}) : "0";
}

function assetIssuer(asset: Asset) {
  if (asset === "XLM") return "Native Stellar asset";
  return "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
}

export default function VouchersExperience({}: {
  network: Network;
  connected: boolean;
  onConnect: () => void;
}) {
  const [view, setView] = useState<View>("create");
  const [step, setStep] = useState<Step>(1);
  const [asset, setAsset] = useState<Asset>("USDC");
  const [amount, setAmount] = useState("50");
  const [cardCount, setCardCount] = useState(5);
  const [message, setMessage] = useState("A little gift to celebrate your next milestone. Enjoy!");
  const [theme, setTheme] = useState<Theme>("emerald");
  const [unlock, setUnlock] = useState("immediate");
  const [expiry, setExpiry] = useState("30");
  const [redeemLink, setRedeemLink] = useState("");
  const [redeemNonce, setRedeemNonce] = useState(0);
  const [createRequest, setCreateRequest] = useState<{ asset: string; amounts: string[]; expiry: number; unlockAt: number | null; message: string; theme: string } | null>(null);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [linkAsset, setLinkAsset] = useState<Asset>("USDC");
  const [linkAmount, setLinkAmount] = useState("10");
  const [linkMessage, setLinkMessage] = useState("A little gift for you. Enjoy!");
  const [linkTheme, setLinkTheme] = useState<Theme>("emerald");
  const [linkUnlock, setLinkUnlock] = useState("immediate");
  const [linkExpiry, setLinkExpiry] = useState("30");

  const totalStroops=parseStellarAmount(amount);
  const perCardStroops=totalStroops!==null&&cardCount>0&&totalStroops%BigInt(cardCount)===BigInt(0)?totalStroops/BigInt(cardCount):null;
  const perCard = perCardStroops===null?0:Number(perCardStroops)/10_000_000;
  const selectedTheme = THEMES.find(item => item.id === theme) ?? THEMES[0];
  const amountValid = totalStroops!==null&&totalStroops>BigInt(0)&&cardCount>=1&&cardCount<=50&&perCardStroops!==null;
  const amountError=totalStroops===null?"Enter a positive amount with no more than 7 decimal places.":totalStroops<=BigInt(0)?"Amount must be greater than zero.":perCardStroops===null?"This total can't be split evenly across the selected number of cards.":null;
  const linkStroops=parseStellarAmount(linkAmount);
  const linkAmountValid=linkStroops!==null&&linkStroops>BigInt(0);
  const selectedAsset = ASSETS.find(item => item.id === asset)!;
  const canAdvance = step === 1 || step === 2 && amountValid || step === 3 || step === 4;

  const faq = useMemo(() => [
    {
      question: "How do Stellar vouchers work?",
      answer: "Each voucher holds a set amount on Stellar that the recipient can claim once, within the unlock and expiry window you choose."
    },
    {
      question: "Are voucher funds held by NEXORA?",
      answer: "No. Vouchers are funded from your own wallet and held on Stellar until claimed. NEXORA never takes custody of your funds or asks for your secret key."
    },
    {
      question: "Can I send a voucher to someone who does not have a Stellar wallet?",
      answer: "The recipient needs a Stellar wallet to claim. They can set one up before redeeming the voucher."
    },
    {
      question: "Can an unclaimed voucher be refunded?",
      answer: "The expiry you set determines when an unclaimed voucher can be recovered. The exact deadline is shown before you confirm."
    }
  ], []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const readHash = () => {
      if (cancelled) return;
      const hash = window.location.hash;
      if (/(?:^#|&)k=/.test(hash)) { setRedeemLink(window.location.href); setRedeemNonce(n => n + 1); setView("redeem"); }
      else if (window.location.pathname.startsWith("/redeem")) setView("redeem");
    };
    const frame = window.requestAnimationFrame(readHash);
    window.addEventListener("hashchange", readHash);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", readHash);
    };
  }, []);

  function startCreate(kind: "batch" | "link") {
    const nowSec = Math.floor(Date.now() / 1000);
    const days = Number(kind === "batch" ? expiry : linkExpiry);
    const unlockChoice = kind === "batch" ? unlock : linkUnlock;
    const unlockHours = unlockChoice === "24h" ? 24 : unlockChoice === "3d" ? 72 : unlockChoice === "7d" ? 168 : 0;
    const chosen = kind === "batch" ? asset : linkAsset;
    const amounts = kind === "batch" ? splitEvenly(amount, cardCount) : (linkAmountValid ? [linkAmount] : null);
    if (!amounts) return;
    setCreateRequest({
      asset: chosen === "XLM" ? VOUCHER_ASSETS.native.assetId : VOUCHER_ASSETS.usdc.assetId,
      amounts,
      expiry: nowSec + days * 86400,
      unlockAt: unlockHours ? nowSec + unlockHours * 3600 : null,
      message: kind === "batch" ? message : linkMessage,
      theme: kind === "batch" ? theme : linkTheme
    });
  }

  function changeView(next: View) {
    setView(next);
    if (next === "create") setStep(1);
  }

  function nextStep() {
    if (!canAdvance || step === 4) return;
    setStep(current => Math.min(4,current+1) as Step);
  }

  function previousStep() {
    setStep(current => Math.max(1,current-1) as Step);
  }

  return (
    <div className="nx-vouchers-page">
      <section className="nx-voucher-header">
        <div className="nx-voucher-heading-main">
          <span className="nx-voucher-heading-icon"><Gift size={19}/></span>
          <div>
            <div className="nx-panel-kicker">STELLAR PAYMENT VOUCHERS</div>
            <h1>Gift with Stellar.</h1>
            <p>Split a supported asset into shareable vouchers and track the recipient experience from one place.</p>
          </div>
        </div>
      </section>

      <section className="nx-voucher-stats">
        <article><span><Gift size={16}/></span><div><strong>1–50 cards</strong><small>One batch, equal value per card</small></div></article>
        <article><span><QrCode size={16}/></span><div><strong>Shareable claim flow</strong><small>Share by link or QR code</small></div></article>
        <article><span><ShieldCheck size={16}/></span><div><strong>On-chain conditions</strong><small>Unlock, expiry and refund rules</small></div></article>
      </section>

      <div className="nx-voucher-tabs" role="tablist" aria-label="Voucher actions">
        {([
          ["create","Create",Gift],
          ["redeem","Redeem",QrCode],
          ["link","One Link",Share2],
          ["mine","My Cards",Wallet]
        ] as const).map(([id,label,Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => changeView(id)}>
            <Icon size={14}/>{label}
          </button>
        ))}
      </div>

      {view === "create" && (
        <div className="nx-voucher-create-layout">
          <div className="nx-voucher-create-main">
            <div className="nx-voucher-stepper">
              {STEPS.map((item,index) => <div className="nx-voucher-step-wrap" key={item.id}>
                <button type="button" disabled={item.id > step} onClick={() => item.id < step && setStep(item.id)} className={step === item.id ? "active" : item.id < step ? "complete" : ""}>
                  <span>{item.id < step ? <Check size={12}/> : item.id}</span>
                  <strong>{item.label}</strong>
                </button>
                {index < STEPS.length - 1 && <i className={item.id < step ? "complete" : ""}/>}
              </div>)}
              <div className="nx-voucher-mobile-step">STEP {step} OF 4 · {STEPS[step-1].label}</div>
            </div>

            {step === 1 && (
              <section className="nx-panel nx-voucher-form-panel">
                <div><div className="nx-panel-kicker">STEP 1 OF 4</div><h2>Choose gift asset</h2><p>Select a Stellar asset for your voucher batch.</p></div>
                <div className="nx-voucher-asset-grid">
                  {ASSETS.map(item => <button type="button" key={item.id} onClick={() => setAsset(item.id)} className={asset === item.id ? "selected" : ""}>
                    <span className="nx-voucher-asset-symbol">{item.icon}</span>
                    <span><strong>{item.id}</strong><small>{item.label}</small><em>{item.description}</em></span>
                    <i>{asset === item.id ? <CheckCircle2 size={18}/> : <CircleHelp size={18}/>}</i>
                  </button>)}
                </div>
                <div className="nx-voucher-asset-identity">
                  <span><ShieldCheck size={15}/></span>
                  <div><strong>{selectedAsset.label} ({asset}) issuer</strong><code>{assetIssuer(asset)}</code></div>
                </div>
                <button type="button" className="nx-primary-button nx-voucher-wide-button" onClick={nextStep}>Continue to amount &amp; split <ChevronRight size={15}/></button>
              </section>
            )}

            {step === 2 && (
              <section className="nx-panel nx-voucher-form-panel">
                <div><div className="nx-panel-kicker">STEP 2 OF 4</div><h2>Amount &amp; card split</h2><p>Set the total voucher value and divide it into equal cards.</p></div>
                <label className="nx-voucher-field">Total amount ({asset})<div className="nx-voucher-amount-input"><input value={amount} onChange={event => setAmount(event.target.value.replace(/[^0-9.]/g,""))} inputMode="decimal" placeholder="0.00" aria-invalid={!amountValid}/><span>{asset}</span></div><small>Enter the total value for the entire batch.</small></label>
                <div className="nx-voucher-field">
                  <div className="nx-voucher-field-head"><span>Number of cards</span><small>1 to 50 cards</small></div>
                  <div className="nx-voucher-count-control"><button type="button" aria-label="Remove one card" onClick={() => setCardCount(value => Math.max(1,value-1))} disabled={cardCount <= 1}><Minus size={15}/></button><strong>{cardCount}</strong><button type="button" aria-label="Add one card" onClick={() => setCardCount(value => Math.min(50,value+1))} disabled={cardCount >= 50}><Plus size={15}/></button></div>
                  <div className="nx-voucher-presets">{[1,5,10,25,50].map(value => <button type="button" key={value} className={cardCount === value ? "active" : ""} onClick={() => setCardCount(value)}>{value} cards</button>)}</div>
                </div>
                {amountError&&<div className="nx-voucher-validation" role="alert"><AlertCircle size={13}/>{amountError}</div>}
                <div className="nx-voucher-split-summary">
                  <div><span>Total batch value</span><strong>{formatAmount(amount)} {asset}</strong></div>
                  <div><span>Value per voucher</span><strong>{formatAmount(String(perCard))} {asset}</strong></div>
                  <div><span>Voucher count</span><strong>{cardCount}</strong></div>
                </div>
                <div className="nx-voucher-step-actions"><button type="button" className="nx-secondary-button" onClick={previousStep}><ChevronLeft size={14}/>Back</button><button type="button" className="nx-primary-button" onClick={nextStep} disabled={!amountValid}>Continue to personalize <ChevronRight size={14}/></button></div>
              </section>
            )}

            {step === 3 && (
              <section className="nx-panel nx-voucher-form-panel">
                <div><div className="nx-panel-kicker">STEP 3 OF 4</div><h2>Personalize your gift</h2><p>Choose a card style, message and recipient timing.</p></div>
                <div className="nx-voucher-field">
                  <div className="nx-voucher-field-head"><span>Quick message templates</span><small>Tap to use</small></div>
                  <div className="nx-voucher-occasions">{OCCASIONS.map(item => <button type="button" key={item.label} onClick={() => setMessage(item.message)}><span>{item.emoji}</span><strong>{item.label}</strong></button>)}</div>
                </div>
                <div className="nx-voucher-field">
                  <div className="nx-voucher-field-head"><span>Card theme</span><small>Emerald &amp; Graphite</small></div>
                  <div className="nx-voucher-themes">{THEMES.map(item => <button type="button" key={item.id} className={theme === item.id ? "active" : ""} onClick={() => setTheme(item.id)}><i style={{background:item.surface}}/><span>{item.label}</span>{theme === item.id && <Check size={12}/>}</button>)}</div>
                </div>
                <label className="nx-voucher-field">Gift message <span className="nx-voucher-character-count">{message.length}/280</span><textarea value={message} onChange={event => setMessage(event.target.value.slice(0,280))} rows={3} placeholder="Write a message for the recipient…"/></label>
                <div className="nx-voucher-timing">
                  <div><div className="nx-voucher-field-head"><span><Clock3 size={13}/> Unlock time</span><small>When the recipient can claim</small></div><div className="nx-voucher-choice-row">{[["immediate","Immediate"],["24h","24 hours"],["3d","3 days"],["7d","7 days"]].map(([id,label]) => <button key={id} type="button" onClick={() => setUnlock(id)} className={unlock === id ? "active" : ""}>{label}</button>)}</div></div>
                  <div><div className="nx-voucher-field-head"><span><CalendarDaysIcon/> Expiration</span><small>When the voucher expires</small></div><div className="nx-voucher-choice-row">{[["14","14 days"],["30","30 days"],["90","90 days"],["365","1 year"]].map(([id,label]) => <button key={id} type="button" onClick={() => setExpiry(id)} className={expiry === id ? "active" : ""}>{label}</button>)}</div></div>
                </div>
                <div className="nx-voucher-step-actions"><button type="button" className="nx-secondary-button" onClick={previousStep}><ChevronLeft size={14}/>Back</button><button type="button" className="nx-primary-button" disabled={!amountValid} onClick={nextStep}>Review voucher batch <ChevronRight size={14}/></button></div>
              </section>
            )}

            {step === 4 && (
              <section className="nx-panel nx-voucher-form-panel">
                <div><div className="nx-panel-kicker">STEP 4 OF 4</div><h2>Review &amp; confirm</h2><p>Check the voucher details before you confirm.</p></div>
                <div className="nx-voucher-review-list">
                  <div><span>Asset</span><strong>{asset} · {selectedAsset.label}</strong></div>
                  <div><span>Network</span><strong>Stellar Mainnet</strong></div>
                  <div><span>Total batch value</span><strong>{formatAmount(amount)} {asset}</strong></div>
                  <div><span>Number of vouchers</span><strong>{cardCount}</strong></div>
                  <div><span>Value per voucher</span><strong>{formatAmount(String(perCard))} {asset}</strong></div>
                  <div><span>Unlock schedule</span><strong>{unlock === "immediate" ? "Immediate" : unlock === "24h" ? "24 hours" : unlock === "3d" ? "3 days" : "7 days"}</strong></div>
                  <div><span>Expiry</span><strong>{expiry === "365" ? "1 year" : expiry + " days"}</strong></div>
                  <div><span>Card theme</span><strong>{selectedTheme.label}</strong></div>
                </div>
                {message && <blockquote className="nx-voucher-review-message">“{message}”</blockquote>}
                <div className="nx-voucher-step-actions"><button type="button" className="nx-secondary-button" onClick={previousStep}><ChevronLeft size={14}/>Back</button><button type="button" className="nx-primary-button" disabled={!amountValid} onClick={() => startCreate("batch")}>Create vouchers</button></div>
              </section>
            )}
          </div>

          <aside className="nx-voucher-preview-column">
            <div className="nx-voucher-preview-panel">
              <div className="nx-panel-kicker">YOUR VOUCHER CARD</div>
              <div className={"nx-voucher-preview-card theme-" + theme} style={{background:selectedTheme.surface}}>
                <div className="nx-voucher-preview-top"><div><small>NEXORA DIGITAL GIFT</small><strong>Payment voucher</strong></div><Image src="/nexora-mark.svg" alt="NEXORA" width={36} height={36}/></div>
                <div className="nx-voucher-preview-amount"><strong>{formatAmount(String(perCard))}</strong><span>{asset}</span></div>
                <div className="nx-voucher-preview-divider"/>
                <p>{message || "A gift for someone special."}</p>
                <div className="nx-voucher-preview-foot"><span>ONE-TIME CLAIM</span><span>STELLAR</span></div>
                <div className="nx-voucher-preview-watermark">NEXORA</div>
              </div>
              <div className="nx-voucher-preview-meta"><div><span>Cards in batch</span><strong>{cardCount}</strong></div><div><span>Total value</span><strong>{formatAmount(amount)} {asset}</strong></div><div><span>Recipient timing</span><strong>{unlock === "immediate" ? "Immediate" : unlock === "24h" ? "24 hours" : unlock === "3d" ? "3 days" : "7 days"}</strong></div></div>
            </div>
          </aside>
        </div>
      )}

      {view === "redeem" && (
        <section className="nx-voucher-redeem-layout">
          <VoucherRedeem key={redeemNonce} initialLink={redeemLink}/>
          <aside className="nx-panel nx-voucher-redeem-aside"><span className="nx-voucher-redeem-icon"><QrCode size={26}/></span><h2>Before you claim</h2><p>Confirm the voucher issuer, asset, amount, unlock time, expiry and destination wallet before any claim is submitted.</p><div className="nx-voucher-redeem-check"><CheckCircle2 size={15}/> Only claim from a trusted sender</div><div className="nx-voucher-redeem-check"><CheckCircle2 size={15}/> Keep the claim secret private</div><div className="nx-voucher-redeem-check"><CheckCircle2 size={15}/> Review the destination account</div></aside>
        </section>
      )}


      {view === "link" && (
        <div className="nx-voucher-one-link-layout">
          <section className="nx-panel nx-voucher-form-panel nx-voucher-one-link-form">
            <div><div className="nx-panel-kicker">ONE-LINK GIFT</div><h2>Create a single shareable voucher</h2><p>Create one gift card and share it through a one-time claim link.</p></div>
            <div className="nx-voucher-field">
              <div className="nx-voucher-field-head"><span>Choose gift asset</span><small>Select one</small></div>
              <div className="nx-voucher-asset-grid">
                {ASSETS.map(item => (
                  <button type="button" key={item.id} className={linkAsset === item.id ? "selected" : ""} onClick={() => setLinkAsset(item.id)}>
                    <span className="nx-voucher-asset-symbol">{item.icon}</span>
                    <span><strong>{item.id}</strong><small>{item.label}</small><em>{item.description}</em></span>
                    <i>{linkAsset === item.id ? <CheckCircle2 size={18}/> : <CircleHelp size={18}/>}</i>
                  </button>
                ))}
              </div>
            </div>
            <label className="nx-voucher-field">Gift amount ({linkAsset})
              <div className="nx-voucher-amount-input"><input value={linkAmount} onChange={event => setLinkAmount(event.target.value.replace(/[^0-9.]/g,""))} inputMode="decimal" placeholder="0.00" aria-invalid={!linkAmountValid}/><span>{linkAsset}</span></div>
            </label>
            <div className="nx-voucher-field">
              <div className="nx-voucher-field-head"><span>Quick amount</span><small>Tap to set</small></div>
              <div className="nx-voucher-presets">{(linkAsset === "XLM" ? ["5","10","25","50"] : ["1","5","10","25"]).map(value => <button type="button" key={value} className={linkAmount === value ? "active" : ""} onClick={() => setLinkAmount(value)}>{value} {linkAsset}</button>)}</div>
            </div>
            <div className="nx-voucher-field">
              <div className="nx-voucher-field-head"><span>Personalize your gift</span><small>One recipient · one claim</small></div>
              <div className="nx-voucher-occasions">{OCCASIONS.map(item => <button type="button" key={item.label} onClick={() => setLinkMessage(item.message)}><span>{item.emoji}</span><strong>{item.label}</strong></button>)}</div>
            </div>
            <label className="nx-voucher-field">Gift message <span className="nx-voucher-character-count">{linkMessage.length}/280</span>
              <textarea value={linkMessage} onChange={event => setLinkMessage(event.target.value.slice(0,280))} rows={3} placeholder="Write a message for the recipient…"/>
            </label>
            <div className="nx-voucher-field">
              <div className="nx-voucher-field-head"><span>Card style</span><small>Choose a theme</small></div>
              <div className="nx-voucher-themes">{THEMES.map(item => <button type="button" key={item.id} className={linkTheme === item.id ? "active" : ""} onClick={() => setLinkTheme(item.id)}><i style={{background:item.surface}}/><span>{item.label}</span>{linkTheme === item.id && <Check size={12}/>}</button>)}</div>
            </div>
            <div className="nx-voucher-one-link-options">
              <div><div className="nx-voucher-field-head"><span><Clock3 size={13}/> Unlock</span></div><div className="nx-voucher-choice-row">{[["immediate","Immediate"],["24h","24 hours"],["3d","3 days"],["7d","7 days"]].map(([id,label]) => <button key={id} type="button" className={linkUnlock===id?"active":""} onClick={() => setLinkUnlock(id)}>{label}</button>)}</div></div>
              <div><div className="nx-voucher-field-head"><span><CalendarDaysIcon/> Expiration</span></div><div className="nx-voucher-choice-row">{[["14","14 days"],["30","30 days"],["90","90 days"],["365","1 year"]].map(([id,label]) => <button key={id} type="button" className={linkExpiry===id?"active":""} onClick={() => setLinkExpiry(id)}>{label}</button>)}</div></div>
            </div>
            {!linkAmountValid&&<div className="nx-voucher-validation" role="alert"><AlertCircle size={13}/>Enter a positive amount with up to 7 decimal places.</div>}
            <button type="button" className="nx-primary-button nx-voucher-wide-button" disabled={!linkAmountValid} onClick={() => startCreate("link")}>Create gift link</button>
          </section>
          <aside className="nx-voucher-preview-column">
            <div className="nx-voucher-preview-panel">
              <div className="nx-panel-kicker">YOUR GIFT CARD</div>
              <div className={"nx-voucher-preview-card theme-" + linkTheme} style={{background:(THEMES.find(item=>item.id===linkTheme)??THEMES[0]).surface}}>
                <div className="nx-voucher-preview-top"><div><small>NEXORA DIGITAL GIFT</small><strong>One Link Voucher</strong></div><Image src="/nexora-mark.svg" alt="NEXORA" width={36} height={36}/></div>
                <div className="nx-voucher-preview-amount"><strong>{formatAmount(linkAmount)}</strong><span>{linkAsset}</span></div>
                <div className="nx-voucher-preview-divider"/>
                <p>{linkMessage || "A gift for someone special."}</p>
                <div className="nx-voucher-preview-foot"><span>ONE-TIME CLAIM</span><span>STELLAR</span></div>
                <div className="nx-voucher-preview-watermark">NEXORA</div>
              </div>
              <div className="nx-voucher-one-link-qr"><QrCode size={27}/><div><strong>Claim QR / link</strong><small>Shown after the gift is confirmed.</small></div></div>
              <div className="nx-voucher-preview-meta"><div><span>Gift amount</span><strong>{formatAmount(linkAmount)} {linkAsset}</strong></div><div><span>Recipient</span><strong>One claim</strong></div><div><span>Expiry</span><strong>{linkExpiry==="365"?"1 year":linkExpiry+" days"}</strong></div><div><span>Unlock</span><strong>{linkUnlock==="immediate"?"Immediate":linkUnlock==="24h"?"24 hours":linkUnlock==="3d"?"3 days":"7 days"}</strong></div></div>
            </div>
          </aside>
        </div>
      )}

      {view === "mine" && <VoucherMine onCreate={() => changeView("create")}/>}

      {createRequest && <VoucherCreateFlow {...createRequest} onClose={() => setCreateRequest(null)}/>}

      <section className="nx-voucher-how">
        <button type="button" className="nx-voucher-how-trigger" aria-expanded={faqOpen !== null} onClick={() => setFaqOpen(faqOpen === -1 ? null : -1)}>
          <span className="nx-voucher-how-icon"><CircleHelp size={18}/></span><span><strong>How it works &amp; FAQ</strong><small>Voucher sharing, expiry and recipient safety.</small></span><ChevronDown size={17} className={faqOpen === -1 ? "rotated" : ""}/>
        </button>
        {faqOpen === -1 && <div className="nx-voucher-how-body">
          <div className="nx-voucher-how-steps">{[
            ["01","Choose & split","Select an eligible Stellar asset and divide the total into equal-value voucher cards."],
            ["02","Personalize & share","Add a note, choose a card theme and share the claim link."],
            ["03","Recipient claims","The recipient reviews the gift and claims it to their Stellar wallet."]
          ].map(([number,title,description]) => <article key={number}><span>{number}</span><strong>{title}</strong><p>{description}</p></article>)}</div>
          <div className="nx-voucher-faq"><div className="nx-panel-kicker">FREQUENTLY ASKED QUESTIONS</div>
            {faq.map((item,index) => <div className="nx-voucher-faq-item" key={item.question}><button type="button" onClick={() => setFaqOpen(faqOpen === index ? -1 : index)}><strong>{item.question}</strong><ChevronDown size={14} className={faqOpen === index ? "rotated" : ""}/></button>{faqOpen === index && <p>{item.answer}</p>}</div>)}
          </div>
        </div>}
      </section>
    </div>
  );
}

function CalendarDaysIcon() {
  return <span className="nx-inline-calendar" aria-hidden="true">▦</span>;
}
