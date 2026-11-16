"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Copy, ExternalLink, Rocket, Share2, ShieldCheck, Wallet } from "lucide-react";

type Network="testnet"|"mainnet";
type AccountData={
  account:{account_id:string;sequence:string;subentry_count:number};
  balances:{asset_code:string;asset_type:string;asset_issuer?:string;balance:string;is_authorized?:boolean}[];
  transactions:{hash:string;created_at:string;successful:boolean;operation_count:number;fee_charged:string;memo?:string}[];
};
const short=(v:string)=>v.length>19?v.slice(0,7)+"…"+v.slice(-6):v;
const LOAD_ERROR="Couldn't load this account.";

export default function ProfileExperience({network,address,profileAddress,onConnect}:{network:Network;address:string|null;profileAddress:string|null;onConnect:()=>void}){
  const targetAddress=profileAddress||address;
  const publicCreatorView=Boolean(profileAddress);
  const [account,setAccount]=useState<AccountData|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [copied,setCopied]=useState<"address"|"profile"|null>(null);
  const [toast,setToast]=useState("");
  const [showAccountDetails,setShowAccountDetails]=useState(false);

  useEffect(()=>{
    if(!targetAddress){
      const frame=window.requestAnimationFrame(()=>{setAccount(null);setError(null);setLoading(false);});
      return()=>window.cancelAnimationFrame(frame);
    }
    let cancelled=false;
    const frame=window.requestAnimationFrame(()=>{
      if(cancelled)return;
      setLoading(true);
      setError(null);
      fetch("/api/stellar/account?address="+encodeURIComponent(targetAddress)+"&network="+network,{cache:"no-store"})
        .then(async response=>{
          const data=await response.json();
          if(!response.ok)throw new Error(LOAD_ERROR);
          return data as AccountData;
        })
        .then(data=>{if(!cancelled)setAccount(data);})
        .catch(()=>{if(!cancelled){setAccount(null);setError(LOAD_ERROR);}})
        .finally(()=>{if(!cancelled)setLoading(false);});
    });
    return()=>{cancelled=true;window.cancelAnimationFrame(frame);};
  },[targetAddress,network]);

  const balances=account?.balances??[];
  const transactions=account?.transactions??[];
  const accountAddress=targetAddress||"";
  const totalEntries=account?.account.subentry_count??null;
  const profileUrl=accountAddress?"/creator/"+accountAddress.toLowerCase():"/profile";

  async function copyValue(kind:"address"|"profile"){
    if(!accountAddress)return;
    const value=kind==="address"?accountAddress:window.location.origin+profileUrl;
    try{await navigator.clipboard.writeText(value);setCopied(kind);setToast(kind==="address"?"Wallet address copied":"Profile link copied");}
    catch{setToast("Couldn't copy to clipboard.");}
    window.setTimeout(()=>{setCopied(null);setToast("");},1800);
  }

  if(!targetAddress&&!publicCreatorView){
    return <div className="nx-profile-experience">
      <div className="nx-profile-page-heading"><div><div className="nx-panel-kicker">WALLET &amp; PROFILE</div><h1>Your Stellar account.</h1><p>Set up your wallet to view your balances and activity.</p></div></div>
      <section className="nx-profile-guest">
        <span className="nx-profile-guest-icon"><Wallet size={25}/></span>
        <div className="nx-panel-kicker">WALLET</div>
        <h2>Set up your wallet</h2>
        <p>Create, import or unlock your Stellar wallet to view your portfolio and activity.</p>
        <button type="button" onClick={onConnect}>Set up wallet <Wallet size={14}/></button>
      </section>
    </div>;
  }

  return <div className="nx-profile-experience">
    <div className="nx-profile-page-heading">
      <div><div className="nx-panel-kicker">{publicCreatorView?"CREATOR PROFILE":"WALLET & PROFILE"}</div><h1>{publicCreatorView?"Creator account.":"Your Stellar account."}</h1><p>Balances, trustlines and recent activity.</p></div>
    </div>

    {publicCreatorView&&<Link href="/profile" className="nx-profile-back"><ArrowRight size={13}/> Open my profile</Link>}

    <div className="nx-profile-promo">
      <div><span><Rocket size={14}/></span><strong>Ready to launch your own Stellar asset?</strong><small>Prepare a token, distribution plan and issuer-control review.</small></div>
      <Link href="/launch">Launch an asset <ArrowUpRight size={13}/></Link>
    </div>

    {error&&<div className="nx-profile-error">{error}</div>}
    <div className="nx-profile-main-column">
        <section className="nx-profile-identity-card">
          <div className="nx-profile-identity-main">
            <div className="nx-profile-avatar"><span>{(accountAddress.slice(0,2)||"NX").toUpperCase()}</span><i/></div>
            <div className="nx-profile-identity-copy">
              <div className="nx-profile-name-row"><h2>{publicCreatorView?"Creator account":"My wallet"}</h2><span className="nx-profile-level"><ShieldCheck size={11}/> Stellar account</span></div>
              <button type="button" className="nx-profile-address" onClick={()=>void copyValue("address")}>{short(accountAddress)} <Copy size={12}/>{copied==="address"&&<em>Copied</em>}</button>
              <div className="nx-profile-identity-meta"><span><Wallet size={11}/>{balances.length} {balances.length===1?"balance":"balances"}</span></div>
            </div>
            <div className="nx-profile-identity-actions">
              <button type="button" onClick={()=>void copyValue("profile")}><Share2 size={12}/>{copied==="profile"?"Copied profile":"Share profile"}</button>
            </div>
          </div>
        </section>

        <section className="nx-profile-portfolio-card">
          <div className="nx-profile-section-heading"><div><div className="nx-panel-kicker">STELLAR ACCOUNT</div><h3>Portfolio &amp; recent activity</h3></div><button type="button" onClick={()=>setShowAccountDetails(v=>!v)}>{showAccountDetails?"Hide details":"View account details"} <ArrowRight size={12}/></button></div>
          <div className="nx-profile-portfolio-kpis"><div><small>Asset balances</small><strong>{account?String(balances.length):"—"}</strong></div><div><small>Trustlines &amp; entries</small><strong>{totalEntries===null?"—":String(totalEntries)}</strong></div><div><small>Latest transactions</small><strong>{account?String(transactions.length):"—"}</strong></div></div>
          {loading&&<div className="nx-profile-load-row">Loading balances…</div>}
          {showAccountDetails&&account&&<div className="nx-profile-detail-list">{balances.map((item,index)=><div key={item.asset_type+item.asset_code+(item.asset_issuer??"")+index}><div><strong>{item.asset_type==="native"?"XLM":item.asset_code}</strong><small>{item.asset_type==="native"?"Native Stellar asset":item.is_authorized===false?"Trustline not authorized":"Issued asset"}{item.asset_issuer?" · "+short(item.asset_issuer):""}</small></div><b>{Number(item.balance).toLocaleString(undefined,{maximumFractionDigits:7})}</b></div>)}</div>}
          {showAccountDetails&&account&&<div className="nx-profile-detail-list transactions">{transactions.slice(0,5).map(tx=><div key={tx.hash}><div><strong>{tx.successful?"Successful transaction":"Failed transaction"}</strong><small>{new Date(tx.created_at).toLocaleString()} · {tx.operation_count} {tx.operation_count===1?"operation":"operations"}</small></div><a href={"https://stellar.expert/explorer/public/tx/"+tx.hash} target="_blank" rel="noreferrer">View <ExternalLink size={11}/></a></div>)}</div>}
          {showAccountDetails&&account&&transactions.length===0&&<div className="nx-profile-empty-row">No recent transactions.</div>}
          {showAccountDetails&&!account&&!loading&&<div className="nx-profile-empty-row">No account data available.</div>}
        </section>
    </div>

    {toast&&<div className="nx-profile-toast"><Check size={13}/>{toast}</div>}
  </div>;
}
