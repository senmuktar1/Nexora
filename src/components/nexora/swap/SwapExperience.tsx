/* eslint-disable react-hooks/set-state-in-effect -- Effects hydrate browser state and coordinate asynchronous wallet reads. */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SwapMarketSide from "./SwapMarketSide";
import SwapReview, { loadQuote, type SwapQuote } from "./SwapReview";
import {
  ArrowDownUp, ArrowRight, BarChart3, ChevronDown,
  ChevronRight, Clock3, Info, Layers3, LoaderCircle,
  Repeat, Search, Settings2, ShieldCheck, Wallet, X
} from "lucide-react";

type Network="testnet"|"mainnet";
type Side="from"|"to";
type Mode="market"|"orders"|"recurring";
type Asset={code:string;issuer:string|null;type:"native"|"credit"};
type Balance={asset_code:string;asset_type:string;asset_issuer?:string;balance:string;is_authorized?:boolean};
type AssetRecord={asset_code:string;asset_issuer:string;num_accounts?:string;auth_required?:boolean;auth_revocable?:boolean;auth_immutable?:boolean};
const USDC_ISSUER={mainnet:"GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",testnet:"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"};
const XLM:Asset={code:"XLM",issuer:null,type:"native"};
const SLIPPAGE=["0.5","1","3","5"];
const RECENT_ASSETS_KEY="nexora_swap_recent_stellar_assets_v1";
const idOf=(a:Asset)=>a.type==="native"?"native:XLM":a.code+":"+a.issuer;
const clean=(s:string)=>s.replace(/[^0-9.]/g,"").replace(/(\..*)\./g,"$1");
const short=(s:string)=>s.slice(0,7)+"…"+s.slice(-6);
const tokenBalance=(asset:Asset,balances:Balance[])=>Number(balances.find(b=>asset.type==="native"?b.asset_type==="native":b.asset_type!=="native"&&b.asset_code===asset.code&&b.asset_issuer===asset.issuer)?.balance||0);
const fmt=(n:number)=>n.toLocaleString(undefined,{maximumFractionDigits:7});
function TokenMark({asset}:{asset:Asset}) {
  // Issuer-published icon only when the issuer's domain lists this exact asset (served by /api/stellar/asset-icon); otherwise a neutral letter mark.
  const [failed,setFailed]=useState(false);
  const id=asset.type==="credit"&&asset.issuer?asset.code+":"+asset.issuer:null;
  const glyph=asset.type==="native"?"✦":asset.code.slice(0,1);
  // eslint-disable-next-line @next/next/no-img-element -- same-origin, verified icon proxy
  const icon=id&&!failed?<img src={"/api/stellar/asset-icon?asset="+encodeURIComponent(id)} alt="" width={24} height={24} onError={()=>setFailed(true)}/>:null;
  return <span className={"nx-swap-token-mark "+(asset.type==="native"?"xlm":"other")}>{icon??glyph}</span>;
}

export default function SwapExperience({network,address,onConnect}:{network:Network;address:string|null;onConnect:()=>void}) {
  const [mode,setMode]=useState<Mode>("market");
  const [from,setFrom]=useState<Asset>(XLM);
  const [to,setTo]=useState<Asset>({code:"USDC",issuer:USDC_ISSUER.mainnet,type:"credit"});
  const [amount,setAmount]=useState("10");
  const [picker,setPicker]=useState<Side|null>(null);
  const [pickerTab,setPickerTab]=useState<"all"|"balances"|"recent">("all");
  const [recentAssets,setRecentAssets]=useState<Asset[]>([]);
  const swapDialogRef=useRef<HTMLElement|null>(null);
  const swapDialogCloseRef=useRef<HTMLButtonElement|null>(null);
  const tokenSearchRef=useRef<HTMLInputElement|null>(null);
  const [search,setSearch]=useState("USDC");
  const [assets,setAssets]=useState<AssetRecord[]>([]);
  const [searching,setSearching]=useState(false);
  const [assetSearchError,setAssetSearchError]=useState<string|null>(null);
  const [searchRetry,setSearchRetry]=useState(0);
  const [deepLinkError,setDeepLinkError]=useState<string|null>(null);
  const [balances,setBalances]=useState<Balance[]>([]);
  const [balancesNetwork,setBalancesNetwork]=useState<Network|null>(null);
  const [balancesLoading,setBalancesLoading]=useState(false);
  const [accountError,setAccountError]=useState<string|null>(null);
  const [accountRetry,setAccountRetry]=useState(0);
  const [holdings,setHoldings]=useState(false);
  const [settings,setSettings]=useState(false);
  const [quoteDetailsOpen,setQuoteDetailsOpen]=useState(false);
  const [slippage,setSlippage]=useState("1");
  const [customSlip,setCustomSlip]=useState("");
  const [route,setRoute]=useState("auto");
  const [orderType,setOrderType]=useState("Limit buy");
  const [price,setPrice]=useState("");
  const [orderAmount,setOrderAmount]=useState("");
  const [expiry,setExpiry]=useState("7 days");
  const [recurringAmount,setRecurringAmount]=useState("25");
  const [frequency,setFrequency]=useState("Weekly");
  const [recurringAsset,setRecurringAsset]=useState("USDC");
  const [quote,setQuote]=useState<SwapQuote|null>(null);
  const [quoteState,setQuoteState]=useState<"idle"|"loading"|"ready"|"none"|"unavailable">("idle");
  const [reviewOpen,setReviewOpen]=useState(false);

  useEffect(()=>{
    try{
      const stored=window.localStorage.getItem(RECENT_ASSETS_KEY);
      if(!stored)return;
      const parsed:unknown=JSON.parse(stored);
      if(Array.isArray(parsed)){
        const valid=parsed.filter((item):item is Asset=>Boolean(item&&typeof item==="object"&&typeof item.code==="string"&&(item.type==="native"||item.type==="credit")&&(item.type==="native"||typeof item.issuer==="string"||item.issuer===null))).slice(0,5);
        setRecentAssets(valid);
      }
    }catch{/* Ignore malformed or unavailable browser storage. */}
  },[]);

  useEffect(()=>{
    if(!picker&&!holdings)return;
    const previousOverflow=document.body.style.overflow;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.body.style.overflow="hidden";
    const focusFrame=window.requestAnimationFrame(()=>{(picker?tokenSearchRef.current:swapDialogCloseRef.current)?.focus();});
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();if(picker)setPicker(null);else setHoldings(false);return;}
      if(event.key!=="Tab")return;
      const focusable=swapDialogRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if(!focusable?.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    window.addEventListener("keydown",onKeyDown);
    return()=>{
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow=previousOverflow;
      window.removeEventListener("keydown",onKeyDown);
      previousFocus?.focus();
    };
  },[picker,holdings]);

  useEffect(()=>{
    const frame=window.requestAnimationFrame(()=>{
      setTo(v=>v.code==="USDC"?{...v,issuer:USDC_ISSUER[network]}:v);
      if(recurringAsset==="USDC")setRecurringAsset("USDC");
    });
    return ()=>window.cancelAnimationFrame(frame);
  },[network,recurringAsset]);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const rawCode=params.get("buyCode"),issuer=params.get("buyIssuer");
    if(!rawCode&&!issuer)return;
    const code=(rawCode??"").trim().toUpperCase();
    if(!code||!issuer||code.length>12||!/^[A-Z0-9._-]+$/.test(code)||!/^G[A-Z2-7]{55}$/.test(issuer)){
      setDeepLinkError("This asset link is incomplete or invalid.");
      return;
    }
    let cancelled=false;
    const controller=new AbortController();
    setDeepLinkError(null);
    fetch(`/api/stellar/assets?code=${encodeURIComponent(code)}&issuer=${encodeURIComponent(issuer)}&network=${network}`,{cache:"no-store",signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error("Could not validate the linked asset.");return data;})
      .then(data=>{
        if(cancelled)return;
        const match=Array.isArray(data.assets)&&data.assets.some((asset:AssetRecord)=>asset.asset_code===code&&asset.asset_issuer===issuer);
        if(match)setTo({code,issuer,type:"credit"});
        else setDeepLinkError(`${code} from this issuer was not found. The asset was not selected.`);
      })
      .catch((error:unknown)=>{if(!cancelled)setDeepLinkError(error instanceof Error?error.message:"Asset link validation failed.");});
    return()=>{cancelled=true;controller.abort();};
  },[network]);

  useEffect(()=>{
    if(!address){
      const frame=window.requestAnimationFrame(()=>{setBalances([]);setBalancesNetwork(null);setAccountError(null);setBalancesLoading(false);});
      return ()=>window.cancelAnimationFrame(frame);
    }
    let cancelled=false;
    const controller=new AbortController();
    setBalancesLoading(true);
    setBalancesNetwork(null);
    setAccountError(null);
    fetch(`/api/stellar/account?address=${encodeURIComponent(address)}&network=${network}`,{cache:"no-store",signal:controller.signal})
      .then(async r=>{const d=await r.json();if(!r.ok)throw new Error("Account read unavailable.");return d;})
      .then(d=>{if(!cancelled){setBalances(d.balances??[]);setBalancesNetwork(network);setAccountError(null);}})
      .catch((e:unknown)=>{if(!cancelled&&!controller.signal.aborted){setBalances([]);setAccountError(e instanceof Error?e.message:"Account read unavailable.");}})
      .finally(()=>{if(!cancelled)setBalancesLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[address,network,accountRetry]);

  useEffect(()=>{
    if(!picker||pickerTab!=="all")return;
    const q=search.trim();
    if(q.length<2){
      const frame=window.requestAnimationFrame(()=>{setAssets([]);setSearching(false);setAssetSearchError(null);});
      return ()=>window.cancelAnimationFrame(frame);
    }
    let cancelled=false;
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      setSearching(true);
      setAssetSearchError(null);
      fetch(`/api/stellar/assets?code=${encodeURIComponent(q)}&network=${network}`,{cache:"no-store",signal:controller.signal})
        .then(async r=>{const d=await r.json();if(!r.ok)throw new Error("Asset lookup failed.");return d;})
        .then(d=>{if(!cancelled)setAssets(Array.isArray(d.assets)?d.assets:[]);})
        .catch((e:unknown)=>{if(!cancelled){setAssets([]);setAssetSearchError(controller.signal.aborted?"Asset search timed out. Try again.":e instanceof Error?e.message:"Asset lookup unavailable.");}})
        .finally(()=>{if(!cancelled)setSearching(false);});
    },250);
    const timeout=window.setTimeout(()=>controller.abort(),12000);
    return ()=>{cancelled=true;window.clearTimeout(timer);window.clearTimeout(timeout);controller.abort();};
  },[picker,pickerTab,search,network,searchRetry]);

  const assetIdOf=(a:Asset)=>a.type==="native"?"native":a.code+":"+a.issuer;
  const sendId=assetIdOf(from),destId=assetIdOf(to);
  const amountForQuote=/^\d+(\.\d{1,7})?$/.test(amount.trim())&&Number(amount)>0?amount.trim():"";
  useEffect(()=>{
    if(!amountForQuote||sendId===destId){setQuote(null);setQuoteState("idle");return;}
    let cancelled=false;
    // Never show a quote for a different pair or amount while the new one loads.
    setQuote(null);
    setQuoteState("loading");
    const timer=window.setTimeout(()=>{
      loadQuote(sendId,destId,amountForQuote)
        .then(q=>{if(cancelled)return;setQuote(q);setQuoteState(q?"ready":"none");})
        .catch(()=>{if(!cancelled){setQuote(null);setQuoteState("unavailable");}});
    },400);
    const refresh=window.setInterval(()=>{loadQuote(sendId,destId,amountForQuote).then(q=>{if(!cancelled){setQuote(q);setQuoteState(q?"ready":"none");}}).catch(()=>undefined);},20_000);
    return()=>{cancelled=true;window.clearTimeout(timer);window.clearInterval(refresh);};
  },[sendId,destId,amountForQuote]);
  const slippageBps=Math.round(Number(customSlip||slippage)*100);
  const slippageValid=Number.isInteger(slippageBps)&&slippageBps>=1&&slippageBps<=1000;
  const minReceived=quote&&slippageValid?(Number(quote.destAmount)*(10000-slippageBps)/10000).toFixed(7).replace(/\.?0+$/,""):null;
  const balancesReady=Boolean(address&&!balancesLoading&&!accountError&&balancesNetwork===network);
  const balance=balancesReady?tokenBalance(from,balances):0;
  const nativeBalance=balancesReady?balances.find(b=>b.asset_type==="native"):undefined;
  const receiveBalance=balancesReady?balances.find(b=>to.type==="credit"&&b.asset_type!=="native"&&b.asset_code===to.code&&b.asset_issuer===to.issuer):undefined;
  const receiveTrustlineMissing=Boolean(balancesReady&&to.type==="credit"&&!receiveBalance);
  const receiveNotAuthorized=receiveBalance?.is_authorized===false;
  const same=idOf(from)===idOf(to);
  const n=Number(amount);
  const valid=amount.trim()!==""&&Number.isFinite(n)&&n>0;
  const insufficient=Boolean(balancesReady&&valid&&n>balance);
  const orderPriceValid=price.trim()!==""&&Number.isFinite(Number(price))&&Number(price)>0;
  const orderAmountValid=orderAmount.trim()!==""&&Number.isFinite(Number(orderAmount))&&Number(orderAmount)>0;
  const recurringAmountValid=recurringAmount.trim()!==""&&Number.isFinite(Number(recurringAmount))&&Number(recurringAmount)>0;
  const recurringAssetIdentity=recurringAsset==="XLM"?"Native Stellar asset":`Issuer: ${short(USDC_ISSUER[network])}`;
  const pickerAssets=useMemo(()=>{
    const found:Asset[]=[XLM,{code:"USDC",issuer:USDC_ISSUER[network],type:"credit"},...assets.map(a=>({code:a.asset_code,issuer:a.asset_issuer,type:"credit" as const}))];
    const seen=new Set<string>(),q=search.trim().toLowerCase();
    return found.filter(a=>{const key=idOf(a);if(key===idOf(picker==="from"?to:from)||seen.has(key)||q&&!a.code.toLowerCase().includes(q))return false;seen.add(key);return true;});
  },[assets,network,picker,from,to,search]);

  const balanceAssets=useMemo(()=>{
    const found=(balancesReady?balances:[]).filter(b=>Number(b.balance)>0).map(b=>b.asset_type==="native"?XLM:{code:b.asset_code,issuer:b.asset_issuer??null,type:"credit" as const});
    const seen=new Set<string>();
    return found.filter(a=>{const key=idOf(a);if(key===idOf(picker==="from"?to:from)||seen.has(key))return false;seen.add(key);return true;});
  },[balances,balancesReady,picker,from,to]);
  const recentPickerAssets=useMemo(()=>recentAssets.filter(a=>idOf(a)!==idOf(picker==="from"?to:from)),[recentAssets,picker,from,to]);
  const visiblePickerAssets=pickerTab==="balances"?balanceAssets:pickerTab==="recent"?recentPickerAssets:pickerAssets;
  const activeAsset=picker==="from"?from:to;

  function openPicker(side:Side){setSearch(side==="from"?"XLM":"USDC");setPickerTab("all");setPicker(side);}
  function choose(asset:Asset){
    if(!picker)return;
    const nextRecent=[asset,...recentAssets.filter(a=>idOf(a)!==idOf(asset))].slice(0,5);
    setRecentAssets(nextRecent);
    try{window.localStorage.setItem(RECENT_ASSETS_KEY,JSON.stringify(nextRecent));}catch{/* Recent assets remain available for this session. */}
    if(picker==="from"){
      if(idOf(asset)===idOf(to)){setFrom(to);setTo(from);}else setFrom(asset);
      setAmount(asset.code==="XLM"?"10":"1");
    }else{
      if(idOf(asset)===idOf(from)){setFrom(to);setTo(from);}else setTo(asset);
    }
    setPicker(null);
  }
  function setPercent(p:number){const f=p===100?.995:p/100;setAmount((balance*f).toFixed(from.code==="XLM"?5:4).replace(/0+$/,"").replace(/\.$/,""));}

  return <div className="nx-swap-experience">
    <div className="nx-swap-topline"><div><div className="nx-panel-kicker">STELLAR TRADING TERMINAL</div><h1>Swap</h1><p>Exchange assets on the Stellar network.</p></div></div>
    <div className="nx-swap-subtabs" role="tablist" aria-label="Swap modes">
      <button role="tab" aria-selected={mode==="market"} className={mode==="market"?"active":""} onClick={()=>setMode("market")}><BarChart3 size={14}/>Market</button>
      <button role="tab" aria-selected={mode==="orders"} className={mode==="orders"?"active":""} onClick={()=>setMode("orders")}><Layers3 size={14}/>Orders</button>
      <button role="tab" aria-selected={mode==="recurring"} className={mode==="recurring"?"active":""} onClick={()=>setMode("recurring")}><Repeat size={14}/>Recurring</button>
    </div>

    {mode==="market"&&<div className="nx-swap-market-layout">
      <div className="nx-swap-main-column">
        <button type="button" className="nx-swap-portfolio" onClick={()=>setHoldings(true)}><span className="nx-swap-portfolio-icon"><Wallet size={16}/></span><span><small>{address?"STELLAR PORTFOLIO":"YOUR STELLAR PORTFOLIO"}</small><strong>{address?accountError?"Balances unavailable":balancesLoading||!balancesReady?"Loading balances…":fmt(balances.length)+" asset entries":"Set up a wallet to view balances"}</strong><em>{address?accountError?"Tap to retry":(balancesReady?("Native balance: "+(nativeBalance?fmt(Number(nativeBalance.balance))+" XLM":"—")):"Loading account data"):"Create or import a wallet"}</em></span><ChevronRight size={17}/></button>
        <section className="nx-swap-card">
          <div className="nx-swap-card-heading"><div><div className="nx-panel-kicker">INSTANT MARKET SWAP</div><h2>Swap assets</h2></div><button type="button" className={settings?"active":""} aria-label="Swap settings" onClick={()=>setSettings(v=>!v)}><Settings2 size={17}/></button></div>
          {deepLinkError&&<div className="nx-swap-validation" role="alert"><Info size={14}/>{deepLinkError}</div>}
          {settings&&<div className="nx-swap-settings"><div className="nx-swap-settings-head"><strong>Swap settings</strong><button type="button" onClick={()=>setSettings(false)}><X size={14}/></button></div><div><small>Slippage tolerance</small><div className="nx-swap-preset-row">{SLIPPAGE.map(v=><button key={v} className={slippage===v?"active":""} onClick={()=>{setSlippage(v);setCustomSlip("");}}>{v}%</button>)}<input value={customSlip} onChange={e=>{const v=clean(e.target.value);setCustomSlip(v);if(v)setSlippage(v);}} placeholder="Custom" aria-label="Custom slippage"/></div></div><label><span>Preferred route</span><select value={route} onChange={e=>setRoute(e.target.value)}><option value="auto">Auto</option><option value="classic">Classic Stellar path payments</option><option value="soroban">Soroban AMM route</option></select></label></div>}
          <div className="nx-swap-input-box"><div className="nx-swap-field-head"><span>You Pay (Sell)</span>{address&&balancesReady&&<span>Balance: {fmt(balance)} {from.code}</span>}</div><div className="nx-swap-field-main"><input value={amount} onChange={e=>setAmount(clean(e.target.value))} placeholder="0.0" inputMode="decimal" aria-label="Sell amount"/><button type="button" onClick={()=>openPicker("from")}><TokenMark asset={from}/><strong>{from.code}</strong><ChevronDown size={14}/></button></div>{address&&<div className="nx-swap-percentages">{[25,50,100].map(p=><button key={p} onClick={()=>setPercent(p)}>{p===100?"MAX":p+"%"}</button>)}</div>}{from.issuer&&<div className="nx-swap-issuer-line">Issuer: {short(from.issuer)}</div>}</div>
          <div className="nx-swap-flip"><button type="button" onClick={()=>{setFrom(to);setTo(from);}} aria-label="Flip tokens"><ArrowDownUp size={16}/></button></div>
          <div className="nx-swap-input-box receive"><div className="nx-swap-field-head"><span>You Receive (Estimated)</span><small>{quoteState==="loading"?"Updating…":quoteState==="none"?"No route":quoteState==="unavailable"?"Unavailable":quote?"Stellar DEX":""}</small></div><div className="nx-swap-field-main"><strong className="nx-swap-output">{quote?fmt(Number(quote.destAmount)):"—"}</strong><button type="button" onClick={()=>openPicker("to")}><TokenMark asset={to}/><strong>{to.code}</strong><ChevronDown size={14}/></button></div>{to.issuer&&<div className="nx-swap-issuer-line">Issuer: {short(to.issuer)}</div>}</div>
          {same&&<div className="nx-swap-validation"><Info size={14}/> Select two different assets.</div>}{!valid&&amount.length>0&&<div className="nx-swap-validation"><Info size={14}/> Enter an amount greater than zero.</div>}{insufficient&&<div className="nx-swap-validation"><Info size={14}/> Amount exceeds your {from.code} balance.</div>}{receiveTrustlineMissing&&<div className="nx-swap-validation"><Info size={14}/> This account has no {to.code} trustline for this issuer. It will be added in the same transaction (0.5 XLM reserve).</div>}{receiveNotAuthorized&&<div className="nx-swap-validation"><ShieldCheck size={14}/> The {to.code} trustline is not authorized by its issuer.</div>}
          <button type="button" className="nx-swap-details-toggle" aria-expanded={quoteDetailsOpen} onClick={()=>setQuoteDetailsOpen(v=>!v)}><span><Info size={13}/> Quote and route details</span><ChevronDown size={14}/></button>{quoteDetailsOpen&&<div className="nx-swap-quote-details"><div><span>Pair</span><strong>{from.code} / {to.code}</strong></div><div><span>Route</span><strong>{quote?(quote.path.length?quote.path.length+" hop"+(quote.path.length>1?"s":""):"Direct"):"—"}</strong></div><div><span>Rate</span><strong>{quote&&valid?`1 ${from.code} ≈ ${fmt(Number(quote.destAmount)/n)} ${to.code}`:"—"}</strong></div><div><span>Slippage tolerance</span><strong>{slippage}%</strong></div><div><span>Minimum received</span><strong>{minReceived?`${minReceived} ${to.code}`:"—"}</strong></div><div><span>Updated</span><strong>{quote?new Date(quote.retrievedAt).toLocaleTimeString():"—"}</strong></div></div>}
          <button type="button" className="nx-swap-submit" disabled={!address||!quote||!valid||same||insufficient||!slippageValid||receiveNotAuthorized} onClick={()=>setReviewOpen(true)}>Review swap</button>
          {reviewOpen&&address&&<SwapReview address={address} sendAsset={sendId} destAsset={destId} sendAmount={amountForQuote} slippageBps={slippageBps} onClose={()=>{setReviewOpen(false);setAccountRetry(v=>v+1);}}/>}
          {!address&&<button type="button" className="nx-swap-connect" onClick={onConnect}>Set up wallet <Wallet size={14}/></button>}
        </section>
        <section className="nx-swap-popular"><div><div className="nx-panel-kicker">QUICK PAIR PICKS</div><h3>Popular Stellar pairs</h3></div><div className="nx-swap-popular-row"><button onClick={()=>{setFrom(XLM);setTo({code:"USDC",issuer:USDC_ISSUER[network],type:"credit"});}}><TokenMark asset={XLM}/>XLM / USDC <ArrowRight size={12}/></button><button onClick={()=>{setFrom({code:"USDC",issuer:USDC_ISSUER[network],type:"credit"});setTo(XLM);}}>USDC / XLM <ArrowRight size={12}/></button></div></section>
      </div>
      <SwapMarketSide from={from} to={to}/>
    </div>}

    {mode==="orders"&&<div className="nx-swap-order-layout"><section className="nx-panel nx-swap-order-form"><div className="nx-panel-header"><div><div className="nx-panel-kicker">STELLAR CLASSIC DEX</div><h2>Create an order</h2></div></div><div className="nx-swap-order-types">{["Limit buy","Limit sell","Take profit","Stop loss","Trailing stop"].map(t=><button key={t} className={orderType===t?"active":""} onClick={()=>setOrderType(t)}>{t}</button>)}</div><label className="nx-swap-order-field">Order type<select value={orderType} onChange={e=>setOrderType(e.target.value)}>{["Limit buy","Limit sell","Take profit","Stop loss","Trailing stop"].map(t=><option key={t}>{t}</option>)}</select></label><div className="nx-swap-order-two"><label className="nx-swap-order-field">Limit price (USDC per XLM)<input value={price} onChange={e=>setPrice(clean(e.target.value))} placeholder="0.00" inputMode="decimal"/></label><label className="nx-swap-order-field">Amount (XLM)<input value={orderAmount} onChange={e=>setOrderAmount(clean(e.target.value))} placeholder="0.00" inputMode="decimal"/></label></div><label className="nx-swap-order-field">Order expiry<select value={expiry} onChange={e=>setExpiry(e.target.value)}><option>24 hours</option><option>7 days</option><option>30 days</option><option>Good till cancelled</option></select></label>{(!orderPriceValid||!orderAmountValid)&&<div className="nx-swap-validation" role="alert">{!orderPriceValid&&!orderAmountValid?"Enter a limit price and amount greater than zero.":!orderPriceValid?"Enter a limit price greater than zero.":"Enter an order amount greater than zero."}</div>}<button className="nx-swap-submit" disabled>Review order</button></section><section className="nx-panel nx-swap-orders-list"><div className="nx-panel-header"><div><div className="nx-panel-kicker">OPEN ORDERS</div><h2>Your orders</h2></div></div><div className="nx-swap-empty-orders"><span><Layers3 size={22}/></span><strong>No open orders</strong></div><div className="nx-swap-order-summary"><div><span>Type</span><strong>{orderType}</strong></div><div><span>Limit price</span><strong>{price||"—"}</strong></div><div><span>Amount</span><strong>{orderAmount||"—"} XLM</strong></div><div><span>Expiry</span><strong>{expiry}</strong></div><div><span>Status</span><strong>{orderPriceValid&&orderAmountValid?"Parameters entered":"Incomplete parameters"}</strong></div></div></section></div>}

    {mode==="recurring"&&<div className="nx-swap-recurring-layout"><section className="nx-panel nx-swap-recurring-form"><div><div className="nx-panel-kicker">RECURRING PURCHASE</div><h2>Build a recurring plan</h2></div><label className="nx-swap-order-field">Purchase asset<select value={recurringAsset} onChange={e=>setRecurringAsset(e.target.value)}><option>USDC</option><option>XLM</option></select></label><label className="nx-swap-order-field">Amount per purchase<input value={recurringAmount} onChange={e=>setRecurringAmount(clean(e.target.value))} inputMode="decimal" placeholder="25.00"/></label><label className="nx-swap-order-field">Purchase frequency<select value={frequency} onChange={e=>setFrequency(e.target.value)}><option>Daily</option><option>Weekly</option><option>Every two weeks</option><option>Monthly</option></select></label><div className="nx-swap-recurring-preview"><span><Clock3 size={14}/> Plan summary</span><strong>{recurringAmount||"—"} {recurringAsset} · {frequency}</strong><small>{recurringAssetIdentity}</small>{!recurringAmountValid&&<small>Enter a purchase amount greater than zero.</small>}</div><button className="nx-swap-submit" disabled>Review plan</button></section><section className="nx-panel nx-swap-orders-list"><div className="nx-panel-kicker">MY RECURRING PLANS</div><h2>Scheduled purchases</h2><div className="nx-swap-empty-orders"><span><Repeat size={22}/></span><strong>No recurring plans</strong></div></section></div>}

    {picker&&<div className="nx-swap-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setPicker(null);}}><section ref={swapDialogRef} className="nx-swap-token-picker" role="dialog" aria-modal="true" aria-label="Select Stellar asset" tabIndex={-1}><div className="nx-swap-picker-head"><div><div className="nx-panel-kicker">STELLAR ASSET SELECTOR</div><h2>{picker==="from"?"Pay with":"Receive"}</h2></div><button ref={swapDialogCloseRef} type="button" onClick={()=>setPicker(null)} aria-label="Close asset selector"><X size={17}/></button></div><label className="nx-swap-picker-search"><Search size={15}/><input ref={tokenSearchRef} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search asset code…" aria-label="Search Stellar assets by code"/></label>{search&&<button type="button" className="nx-swap-picker-clear" onClick={()=>{setSearch("");tokenSearchRef.current?.focus();}}>Clear search</button>}<div className="nx-swap-picker-tabs" role="tablist" aria-label="Asset source"><button type="button" role="tab" aria-selected={pickerTab==="all"} className={pickerTab==="all"?"active":""} onClick={()=>{setPickerTab("all");setSearch("");}}>All assets</button><button type="button" role="tab" aria-selected={pickerTab==="balances"} className={pickerTab==="balances"?"active":""} onClick={()=>{setPickerTab("balances");setSearch("");}}>My balances <span>{balanceAssets.length}</span></button><button type="button" role="tab" aria-selected={pickerTab==="recent"} className={pickerTab==="recent"?"active":""} onClick={()=>{setPickerTab("recent");setSearch("");}}>Recent <span>{recentPickerAssets.length}</span></button></div><div className="nx-swap-picker-selected"><TokenMark asset={activeAsset}/><span><small>Currently selected · {picker==="from"?"You pay":"You receive"}</small><strong>{activeAsset.code}</strong><em>{activeAsset.type==="native"?"Native Stellar asset":"Issuer: "+short(activeAsset.issuer??"Unavailable")}</em></span></div><div className="nx-swap-picker-list">{visiblePickerAssets.map(asset=><button key={idOf(asset)} className={idOf(asset)===idOf(activeAsset)?"selected":""} aria-pressed={idOf(asset)===idOf(activeAsset)} aria-label={asset.code+(asset.issuer?", issuer "+asset.issuer:"")+(idOf(asset)===idOf(activeAsset)?", currently selected":"")} onClick={()=>choose(asset)}><TokenMark asset={asset}/><span><strong>{asset.code}</strong><small>{asset.type==="native"?"Native Stellar asset":(()=>{const record=assets.find(item=>item.asset_code===asset.code&&item.asset_issuer===asset.issuer);return <>{ "Issuer: "+short(asset.issuer??"")}{record?.num_accounts?" · "+Number(record.num_accounts).toLocaleString()+" accounts":""}{record?.auth_required===true?" · issuer authorization required":record?.auth_required===false?" · no authorization flag reported":""}</>;})()}</small></span><i>{asset.type==="native"?"NATIVE":assets.some(record=>record.asset_code===asset.code&&record.asset_issuer===asset.issuer)?"LISTED":"ISSUED"}</i><ChevronRight size={14}/></button>)}{pickerTab==="balances"&&(balancesLoading||Boolean(address&&!balancesReady&&!accountError))&&<div className="nx-swap-picker-empty"><LoaderCircle size={14}/> Loading wallet balances…</div>}{pickerTab==="balances"&&!address&&<div className="nx-swap-picker-empty"><Wallet size={15}/>Set up a wallet to view your balances.</div>}{pickerTab==="balances"&&address&&accountError&&<div className="nx-swap-picker-empty error" role="alert"><span>{accountError}</span><button type="button" onClick={()=>setAccountRetry(value=>value+1)}>Retry balance read</button></div>}{pickerTab==="balances"&&address&&balancesReady&&balanceAssets.length===0&&<div className="nx-swap-picker-empty">No asset balances yet.</div>}{pickerTab==="recent"&&recentPickerAssets.length===0&&<div className="nx-swap-picker-empty">Assets you select will appear here for quick access.</div>}{pickerTab==="all"&&searching&&<div className="nx-swap-picker-empty"><LoaderCircle size={14}/> Searching assets…</div>}{pickerTab==="all"&&!searching&&assetSearchError&&<div className="nx-swap-picker-empty error" role="alert"><span>{assetSearchError}</span><button type="button" onClick={()=>setSearchRetry(value=>value+1)}>Retry search</button></div>}{pickerTab==="all"&&!searching&&!assetSearchError&&visiblePickerAssets.length===0&&search.trim().length>=2&&<div className="nx-swap-picker-empty">No assets found for “{search}”.</div>}{pickerTab==="all"&&!searching&&!assetSearchError&&visiblePickerAssets.length===0&&search.trim().length===1&&<div className="nx-swap-picker-empty">Enter at least 2 characters to search.</div>}</div><div className="nx-swap-picker-foot"><ShieldCheck size={13}/> Asset codes are not unique. Always verify the issuer.</div></section></div>}

    {holdings&&<div className="nx-swap-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setHoldings(false);}}><aside ref={swapDialogRef} className="nx-swap-holdings-drawer" role="dialog" aria-modal="true" aria-label="Stellar wallet holdings" tabIndex={-1}><div className="nx-swap-picker-head"><div><div className="nx-panel-kicker">WALLET</div><h2>Stellar portfolio</h2></div><button ref={swapDialogCloseRef} type="button" onClick={()=>setHoldings(false)} aria-label="Close portfolio"><X size={17}/></button></div>{!address?<div className="nx-swap-picker-empty"><Wallet size={18}/>Set up a wallet to view balances.</div>:balancesLoading?<div className="nx-swap-picker-empty" role="status"><LoaderCircle size={15}/> Loading Stellar account balances…</div>:accountError?<div className="nx-swap-picker-empty error" role="alert"><span>{accountError}</span><button type="button" onClick={()=>setAccountRetry(value=>value+1)}>Retry account read</button></div>:!balancesReady?<div className="nx-swap-picker-empty" role="status"><LoaderCircle size={15}/> Loading balances…</div>:balances.length?balances.map((b,i)=>{const asset:Asset=b.asset_type==="native"?XLM:{code:b.asset_code,issuer:b.asset_issuer??null,type:"credit"};return <button key={idOf(asset)+i} className="nx-swap-holding-row" onClick={()=>{if(idOf(asset)===idOf(to)){setFrom(to);setTo(from);}else setFrom(asset);setHoldings(false);}}><TokenMark asset={asset}/><span><strong>{asset.code}</strong><small>{asset.issuer?short(asset.issuer):"Native Stellar asset"}</small></span><span><strong>{fmt(Number(b.balance))}</strong><small>{b.is_authorized===false?"Trustline not authorized":"Select as sell asset"}</small></span><ChevronRight size={14}/></button>; }):<div className="nx-swap-picker-empty">No balances yet.</div>}</aside></div>}
  </div>;
}
