/* eslint-disable react-hooks/set-state-in-effect -- Quick-view selection resets are intentional UI state transitions. */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity, ArrowDownUp, ArrowRight, Check,
  ChevronDown, Clock3, ExternalLink, Filter, Flame, Globe2, Info, Landmark,
  Layers3, LayoutGrid, Search, ShieldCheck, Sparkles, Star, TrendingUp, X
} from "lucide-react";

type Network = "testnet" | "mainnet";
type AssetRecord = {asset_code:string;asset_issuer:string;num_accounts?:string;amount?:string;auth_required?:boolean;auth_revocable?:boolean;auth_immutable?:boolean};
type Candle = {timestamp:string|number;open:string;close:string;avg:string;trade_count:string|number;counter_volume:string};
type Snapshot = {bids:{price:string;amount:string}[];asks:{price:string;amount:string}[];candles:Candle[];retrievedAt:string};
type NetworkInfo = {latestLedger?:number;closedAt?:string;online?:boolean};
type IndexedAsset = {rank:number;assetCode:string;issuer:string;holders:number|null;supply:string|null;domain:string|null;price:number|null;change24h:number|null;volume24h:number|null;marketCap:number|null};
type IntelligenceDirectory = {provider:string;source:string;dataset:string;rankingMeaning:string;assets:IndexedAsset[];retrievedAt:string};
type AssetSupply = {provider:string;source:string;asset:string;supply:string;decimals:number;retrievedAt:string};
type Category = "trending"|"rwa";
type ExplorerTab = "all"|"watchlist"|"classic"|"rwa";

const ISSUER = {
  mainnet:"GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  testnet:"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
};
const RWA = [
  {name:"BENJI",issuer:"Franklin Templeton",text:"Tokenized U.S. government money market fund reference",href:"https://stellar.org/case-studies/franklin-templeton"},
  {name:"Spiko",issuer:"Spiko",text:"Institutional money-market fund ecosystem reference",href:"https://stellar.org/solutions/real-world-assets"},
  {name:"WisdomTree",issuer:"WisdomTree",text:"Digital funds and issuer-controlled transfer access",href:"https://stellar.org/solutions/real-world-assets"},
  {name:"Ondo",issuer:"Ondo",text:"Tokenized treasury product ecosystem reference",href:"https://stellar.org/solutions/real-world-assets"}
];
const WATCH_KEY="nexora-stellar-watchlist-v1";
const RECENT_KEY="nexora-stellar-recent-searches-v1";
const keyOf=(a:Pick<AssetRecord,"asset_code"|"asset_issuer">)=>a.asset_code+":"+a.asset_issuer;
const fmt=(n:number|null,d=2)=>n===null||!Number.isFinite(n)?"—":n.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
const short=(s:string)=>s.length>20?s.slice(0,7)+"…"+s.slice(-6):s;
const time=(s?:string)=>s?new Date(s).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—";

export default function ExploreExperience({network,onOpenSearch}:{network:Network;onOpenSearch:()=>void}) {
  const [query,setQuery]=useState("USDC");
  const [heroSearchOpen,setHeroSearchOpen]=useState(false);
  const [recentSearches,setRecentSearches]=useState<string[]>([]);
  const [assets,setAssets]=useState<AssetRecord[]>([]);
  const [loading,setLoading]=useState(false);
  const [searched,setSearched]=useState(false);
  const [assetsError,setAssetsError]=useState<string|null>(null);
  const [market,setMarket]=useState<Snapshot|null>(null);
  const [marketLoading,setMarketLoading]=useState(false);
  const [marketError,setMarketError]=useState<string|null>(null);
  const [networkInfo,setNetworkInfo]=useState<NetworkInfo|null>(null);
  const [directory,setDirectory]=useState<IntelligenceDirectory|null>(null);
  const [directoryLoading,setDirectoryLoading]=useState(false);
  const [directoryError,setDirectoryError]=useState<string|null>(null);
  const [selectedSupply,setSelectedSupply]=useState<AssetSupply|null>(null);
  const [selectedSupplyLoading,setSelectedSupplyLoading]=useState(false);
  const [selectedSupplyError,setSelectedSupplyError]=useState<string|null>(null);
  const [category,setCategory]=useState<Category>("trending");
  const [explorerTab,setExplorerTab]=useState<ExplorerTab>("all");
  const [sort,setSort]=useState<"holders"|"code">("holders");
  const [assetView,setAssetView]=useState<"table"|"cards">("table");
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [authorizationFilter,setAuthorizationFilter]=useState<"all"|"required"|"not_required">("all");
  const [minimumHolders,setMinimumHolders]=useState<"0"|"100"|"1000"|"10000">("0");
  const [revocabilityFilter,setRevocabilityFilter]=useState<"all"|"revocable"|"non_revocable">("all");
  const [watchlist,setWatchlist]=useState<string[]>([]);
  const [selected,setSelected]=useState<AssetRecord|null>(null);
  const [quickViewTab,setQuickViewTab]=useState<"overview"|"market"|"swap">("overview");
  const quickViewRef=useRef<HTMLElement|null>(null);
  const quickViewCloseRef=useRef<HTMLButtonElement|null>(null);
  const [spotlight,setSpotlight]=useState(0);

  useEffect(()=>{
    if(!selected)return;
    const previousOverflow=document.body.style.overflow;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.body.style.overflow="hidden";
    quickViewCloseRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();setSelected(null);return;}
      if(event.key!=="Tab")return;
      const focusable=quickViewRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if(!focusable?.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    window.addEventListener("keydown",onKeyDown);
    return()=>{
      document.body.style.overflow=previousOverflow;
      window.removeEventListener("keydown",onKeyDown);
      previousFocus?.focus();
    };
  },[selected]);
  useEffect(()=>{
    setQuickViewTab("overview");
  },[selected?.asset_code,selected?.asset_issuer]);

  useEffect(()=>{
    let cancelled=false;
    const frame=window.requestAnimationFrame(()=>{
      try {
        const data=JSON.parse(localStorage.getItem(WATCH_KEY)||"[]");
        const recent=JSON.parse(localStorage.getItem(RECENT_KEY)||"[]");
        if(!cancelled&&Array.isArray(data))setWatchlist(data.filter((v):v is string=>typeof v==="string"));
        if(!cancelled&&Array.isArray(recent))setRecentSearches(recent.filter((v):v is string=>typeof v==="string").slice(0,6));
      } catch { if(!cancelled)setWatchlist([]); }
    });
    return ()=>{cancelled=true;window.cancelAnimationFrame(frame);};
  },[]);

  useEffect(()=>{
    let cancelled=false;
    if(query.trim().length<2){
      const frame=window.requestAnimationFrame(()=>{
        if(!cancelled){setAssets([]);setSearched(false);setLoading(false);setAssetsError(null);}
      });
      return()=>{cancelled=true;window.cancelAnimationFrame(frame);};
    }
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      setLoading(true);
      setAssetsError(null);
      fetch("/api/stellar/assets?code="+encodeURIComponent(query.trim())+"&network="+network,{cache:"no-store",signal:controller.signal})
        .then(async r=>{const d=await r.json();if(!r.ok)throw new Error("assets");return d;})
        .then(d=>{if(!cancelled){setAssets(Array.isArray(d.assets)?d.assets:[]);setSearched(true);}})
        .catch(()=>{if(!cancelled){setAssets([]);setSearched(true);setAssetsError("Couldn't load assets. Try again.");}})
        .finally(()=>{if(!cancelled)setLoading(false);});
    },250);
    const timeout=window.setTimeout(()=>controller.abort(),12000);
    return()=>{cancelled=true;window.clearTimeout(timer);window.clearTimeout(timeout);controller.abort();};
  },[query,network]);

  useEffect(()=>{
    let cancelled=false;
    const controller=new AbortController();
    const pair="network="+network+"&baseCode=XLM&counterCode=USDC&counterIssuer="+ISSUER[network];
    const frame=window.requestAnimationFrame(()=>{
      if(!cancelled){
        setMarketLoading(true);
        setMarketError(null);
        setMarket(null);
        setNetworkInfo(null);
      }
    });
    const timeout=window.setTimeout(()=>controller.abort(),12000);
    Promise.all([
      fetch("/api/stellar/orderbook?"+pair+"&limit=20",{cache:"no-store",signal:controller.signal}),
      fetch("/api/stellar/trade-aggregations?"+pair+"&resolution=900000&limit=100",{cache:"no-store",signal:controller.signal}),
      fetch("/api/stellar/network?network="+network,{cache:"no-store",signal:controller.signal})
    ]).then(async([b,c,n])=>{
      const [book,candles,networkData]=await Promise.all([b.json(),c.json(),n.json()]);
      if(!b.ok||!c.ok)throw new Error("market");
      if(!cancelled){
        setMarket({bids:book.orderBook?.bids??[],asks:book.orderBook?.asks??[],candles:candles.aggregations??[],retrievedAt:candles.retrievedAt??book.retrievedAt??new Date().toISOString()});
        setNetworkInfo(n.ok?networkData:null);
        setMarketError(null);
      }
    }).catch(()=>{
      if(!cancelled){
        setMarket(null);
        setMarketError("Couldn't load market data.");
      }
    }).finally(()=>{
      window.clearTimeout(timeout);
      if(!cancelled)setMarketLoading(false);
    });
    return()=>{cancelled=true;window.cancelAnimationFrame(frame);window.clearTimeout(timeout);controller.abort();};
  },[network]);
  const selectedCode=selected?.asset_code;
  const selectedIssuer=selected?.asset_issuer;
  useEffect(()=>{
    if(!selectedCode||!selectedIssuer){setSelectedSupply(null);setSelectedSupplyError(null);setSelectedSupplyLoading(false);return;}
    let cancelled=false;
    const controller=new AbortController();
    setSelectedSupply(null);
    setSelectedSupplyError(null);
    setSelectedSupplyLoading(true);
    const params=new URLSearchParams({network,code:selectedCode,issuer:selectedIssuer});
    fetch("/api/stellar/intelligence/supply?"+params.toString(),{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error("supply");
        return data as AssetSupply;
      })
      .then(data=>{if(!cancelled)setSelectedSupply(data);})
      .catch(()=>{if(!cancelled)setSelectedSupplyError("Supply unavailable.");})
      .finally(()=>{if(!cancelled)setSelectedSupplyLoading(false);});
    return()=>{cancelled=true;controller.abort();};
  },[network,selectedCode,selectedIssuer]);

  useEffect(()=>{
    let cancelled=false;
    const controller=new AbortController();
    setDirectoryLoading(true);
    setDirectoryError(null);
    fetch("/api/stellar/intelligence?network="+network,{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error("directory");
        return data as IntelligenceDirectory;
      })
      .then(data=>{if(!cancelled){setDirectory(data);setDirectoryError(null);}})
      .catch(()=>{if(!cancelled){setDirectory(null);setDirectoryError("Couldn't load assets.");}})
      .finally(()=>{if(!cancelled)setDirectoryLoading(false);});
    return()=>{cancelled=true;controller.abort();};
  },[network]);

  const stats=useMemo(()=>{
    const rows=market?.candles??[], first=rows[0],last=rows[rows.length-1];
    const open=first?Number(first.open||first.avg):NaN,close=last?Number(last.close||last.avg):NaN;
    const change=Number.isFinite(open)&&open>0&&Number.isFinite(close)?(close-open)/open*100:null;
    const volume=rows.reduce((s,x)=>s+Number(x.counter_volume||0),0);
    const trades=rows.reduce((s,x)=>s+Number(x.trade_count||0),0);
    const bid=market?.bids[0]?.price?Number(market.bids[0].price):null;
    const ask=market?.asks[0]?.price?Number(market.asks[0].price):null;
    const spread=bid!==null&&ask!==null?ask-bid:null;
    const depth=(market?.bids??[]).reduce((s,x)=>s+Number(x.amount||0)*Number(x.price||0),0);
    const askDepth=(market?.asks??[]).reduce((s,x)=>s+Number(x.amount||0)*Number(x.price||0),0);
    const values=rows.map(x=>Number(x.close||x.avg)).filter(x=>Number.isFinite(x)&&x>0);
    const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1,range=max-min||Math.max(max*.001,.0000001);
    const points=values.map((v,i)=>`${values.length<2?0:i/(values.length-1)*420},${70-(v-min)/range*55}`).join(" ");
    return {change,volume,trades,bid,ask,spread,depth,askDepth,values,points};
  },[market]);

  const visibleAssets=useMemo(()=>{
    let list=[...assets];
    if(explorerTab==="watchlist")list=list.filter(a=>watchlist.includes(keyOf(a)));
    if(authorizationFilter==="required")list=list.filter(a=>a.auth_required===true);
    if(authorizationFilter==="not_required")list=list.filter(a=>a.auth_required===false);
    if(revocabilityFilter==="revocable")list=list.filter(a=>a.auth_revocable===true);
    if(revocabilityFilter==="non_revocable")list=list.filter(a=>a.auth_revocable===false);
    if(minimumHolders!=="0")list=list.filter(a=>a.num_accounts!==undefined&&Number(a.num_accounts)>=Number(minimumHolders));
    return sort==="holders"?list.sort((a,b)=>Number(b.num_accounts||0)-Number(a.num_accounts||0)):list.sort((a,b)=>a.asset_code.localeCompare(b.asset_code));
  },[assets,explorerTab,sort,watchlist,authorizationFilter,minimumHolders,revocabilityFilter]);
  const activeFilterCount=(authorizationFilter!=="all"?1:0)+(minimumHolders!=="0"?1:0)+(revocabilityFilter!=="all"?1:0);

  const spotlights=[
    {eyebrow:"MARKET SPOTLIGHT #1",title:"XLM / USDC",subtitle:"Native Stellar asset · Circle-issued USDC",kind:"LIVE MARKET PAIR",text:"Live order book, recent trades and top-of-book price.",href:"/swap"},
    {eyebrow:"MARKET SPOTLIGHT #2",title:"Stellar asset directory",subtitle:"Classic asset code + issuer identity",kind:"ON-CHAIN DISCOVERY",text:"Search issued assets and review their issuer accounts.",href:"#token-explorer"},
    {eyebrow:"MARKET SPOTLIGHT #3",title:"Tokenized real-world assets",subtitle:"Institutional issuer research",kind:"RWA RESEARCH",text:"Research issuers of tokenized funds and treasuries.",href:"#rwa-references"}
  ];
  const spotlightItem=spotlights[spotlight];

  function toggleWatch(asset:AssetRecord) {
    const key=keyOf(asset);
    setWatchlist(current=>{
      const next=current.includes(key)?current.filter(v=>v!==key):[...current,key];
      localStorage.setItem(WATCH_KEY,JSON.stringify(next));
      return next;
    });
  }
  function rememberSearch(value:string){
    const term=value.trim();
    if(!term)return;
    const next=[term,...recentSearches.filter(item=>item.toLowerCase()!==term.toLowerCase())].slice(0,6);
    setRecentSearches(next);
    try{localStorage.setItem(RECENT_KEY,JSON.stringify(next));}catch{/* recent searches are optional */}
  }
  function scrollExplorer(){document.getElementById("token-explorer")?.scrollIntoView({behavior:"smooth",block:"start"});}

  return <div className="nx-explore-experience">
    <section className="nx-explore-hero">
      <div className="nx-explore-hero-copy">
        <div className="nx-explore-kicker"><i/> STELLAR FINANCIAL ECOSYSTEM</div>
        <h1>Discover assets. <span>Swap in app.</span></h1>
        <p>Live Stellar liquidity, tokenized real-world asset discovery and DeFi protocol research in one financial workspace.</p>
        <div className="nx-explore-search-shell" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setHeroSearchOpen(false);}}>
          <div className="nx-explore-search"><Search size={18}/><input value={query} onFocus={()=>setHeroSearchOpen(true)} onChange={e=>{setQuery(e.target.value);setExplorerTab("all");setHeroSearchOpen(true);}} onKeyDown={e=>{if(e.key==="Escape")setHeroSearchOpen(false);if(e.key==="Enter"){e.preventDefault();rememberSearch(query);setHeroSearchOpen(false);scrollExplorer();}}} placeholder="Search a Stellar asset code…" aria-label="Search Stellar assets"/><button type="button" onClick={()=>{setHeroSearchOpen(false);onOpenSearch();}}><kbd>⌘ K</kbd></button></div>
          {heroSearchOpen&&<div className="nx-explore-search-dropdown">
            {query.trim().length>=2?<><div className="nx-explore-search-dropdown-title">{loading?"SEARCHING":"ASSET RESULTS"}</div>
              {loading?<div className="nx-explore-search-dropdown-empty">Searching…</div>:assetsError?<div className="nx-explore-search-dropdown-empty error">{assetsError}</div>:assets.length?assets.slice(0,6).map(asset=><button type="button" className="nx-explore-search-suggestion" key={keyOf(asset)} onClick={()=>{rememberSearch(asset.asset_code);setSelected(asset);setHeroSearchOpen(false);}}><span><TrendingUp size={14}/></span><div><strong>{asset.asset_code}</strong><small>{short(asset.asset_issuer)}</small></div><em>{asset.num_accounts??"—"} holders</em></button>):searched?<div className="nx-explore-search-dropdown-empty">No matching assets. Try a different code.</div>:<div className="nx-explore-search-dropdown-empty">Enter at least two characters.</div>}
            </>:<><div className="nx-explore-search-dropdown-title">{recentSearches.length?"RECENT SEARCHES":"QUICK ACCESS"}</div>
              {recentSearches.length?recentSearches.map(term=><button type="button" key={term} className="nx-explore-search-recent" onClick={()=>{setQuery(term);setExplorerTab("all");setHeroSearchOpen(true);}}><Clock3 size={13}/>{term}</button>):<div className="nx-explore-search-dropdown-empty">Search by asset code.</div>}
            </>}
            <div className="nx-explore-search-shortcuts"><Link href="/swap">XLM / USDC <ArrowRight size={11}/></Link><button type="button" onClick={()=>{setExplorerTab("watchlist");setHeroSearchOpen(false);scrollExplorer();}}>Watchlist <Star size={11}/></button><button type="button" onClick={()=>{setExplorerTab("rwa");setHeroSearchOpen(false);document.getElementById("token-explorer")?.scrollIntoView({behavior:"smooth",block:"start"});}}>RWA research <Landmark size={11}/></button></div>
          </div>}
        </div>
        <div className="nx-explore-hero-actions"><button type="button" className="nx-primary-button" onClick={scrollExplorer}>Browse assets <ChevronDown size={15}/></button><Link href="/launch" className="nx-secondary-button"><Sparkles size={15}/> Launch asset</Link></div>
      </div>
      <article className="nx-explore-spotlight">
        <div className="nx-explore-spotlight-head"><span>{spotlightItem.eyebrow}</span><div>{[0,1,2].map(i=><button key={i} aria-label={"Spotlight "+(i+1)} className={spotlight===i?"active":""} onClick={()=>setSpotlight(i)}/>)}</div></div>
        <div className="nx-explore-spotlight-body"><span className="nx-explore-spotlight-icon">{spotlight===0?"X":spotlight===1?<Layers3 size={22}/>:<Landmark size={22}/>}</span><span><strong>{spotlightItem.title}</strong><small>{spotlightItem.subtitle}</small></span></div>
        <small className="nx-explore-spotlight-kind">{spotlightItem.kind}</small><p>{spotlightItem.text}</p>
        {spotlight===0?<div className="nx-explore-spotlight-price"><div><small>Last aggregated price</small><strong>{fmt(stats.values.length?Number(market?.candles[market.candles.length-1]?.close||market?.candles[market.candles.length-1]?.avg):null,5)} <em>USDC</em></strong></div><b className={stats.change===null?"neutral":stats.change>=0?"up":"down"}>{stats.change===null?"—":(stats.change>=0?"+":"")+stats.change.toFixed(2)+"%"}</b></div>:<div className="nx-explore-spotlight-reference"><ShieldCheck size={14}/>{spotlight===1?"Identified by code + issuer":"Issuer information only"}</div>}
        {spotlight===0&&<div className="nx-explore-spotlight-meta"><div><small>24h volume</small><strong>{fmt(stats.volume)+" USDC"}</strong></div><div><small>Best bid / ask</small><strong>{fmt(stats.bid,5)+" / "+fmt(stats.ask,5)}</strong></div></div>}
        <Link href={spotlightItem.href}>{spotlight===0?"Open XLM / USDC market":spotlight===1?"Browse issued assets":"Explore RWA references"} <ArrowRight size={14}/></Link>
      </article>
    </section>

    <section className="nx-market-overview-strip">
      <div className="nx-market-overview-heading"><div><div className="nx-panel-kicker">STELLAR MARKETS OVERVIEW</div><h2>Live market snapshot</h2></div><span className={"nx-data-freshness "+(marketError?"error":"")}>{marketLoading?<><i className="loading"/>Updating</>:market?<><i/>Live</>:marketError?"Unavailable":"Market snapshot"}</span></div>
      <div className="nx-market-overview-grid">
        <div className="nx-overview-primary"><small>24h trading volume</small><strong>{market?fmt(stats.volume):"—"} <em>{market?"USDC":""}</em></strong><span>{market?stats.trades.toLocaleString()+" aggregated trades":marketLoading?"Fetching trade history":"No aggregated trade data"}</span></div>
        <div><small>Best bid</small><strong>{fmt(stats.bid,5)}</strong><span>USDC per XLM</span></div>
        <div><small>Best ask</small><strong>{fmt(stats.ask,5)}</strong><span>USDC per XLM</span></div>
        <div><small>Top-of-book spread</small><strong>{fmt(stats.spread,6)}</strong><span>USDC per XLM</span></div>
        <div className="nx-overview-chart"><div><small>24H PRICE HISTORY</small><span>{time(market?.retrievedAt)}</span></div>{stats.values.length>1?<svg viewBox="0 0 420 80" preserveAspectRatio="none" role="img" aria-label="XLM USDC price history"><line x1="0" y1="15" x2="420" y2="15"/><line x1="0" y1="42" x2="420" y2="42"/><line x1="0" y1="69" x2="420" y2="69"/><polyline points={stats.points}/></svg>:<div className="nx-overview-chart-empty">{marketLoading?"Loading…":marketError?"Chart unavailable.":"Not enough market history for a chart."}</div>}<div><span>24h ago</span><span>Now</span></div></div>
      </div>
      {marketError&&<div className="nx-overview-error">{marketError}</div>}
      <div className="nx-market-overview-source">XLM / USDC (Circle) · 15-minute intervals · Updated {time(market?.retrievedAt)}</div>
    </section>

    <section className="nx-overview-signals">
      <div className="nx-overview-section-head"><div><div className="nx-panel-kicker">MARKET SIGNALS &amp; MOVERS</div><h2>Stellar market signals</h2><p>Key metrics for the XLM / USDC pair.</p></div><Link href="/swap">Open trading terminal <ArrowRight size={13}/></Link></div>
      <div className="nx-overview-signal-grid">
        <Signal icon={<TrendingUp size={17}/>} title="24h price movement" value={stats.change===null?"—":(stats.change>=0?"+":"")+stats.change.toFixed(2)+"%"} note="XLM / USDC · 24h" tone={stats.change===null?"neutral":stats.change>=0?"positive":"negative"}/>
        <Signal icon={<Activity size={17}/>} title="Aggregated trades" value={market?stats.trades.toLocaleString():"—"} note="Last 24 hours"/>
        <Signal icon={<Layers3 size={17}/>} title="Bid-side depth" value={market?fmt(stats.depth)+" USDC":"—"} note="Top 20 bids"/>
        <Signal icon={<Layers3 size={17}/>} title="Ask-side depth" value={market?fmt(stats.askDepth)+" USDC":"—"} note="Top 20 asks"/>
        <Signal icon={<Globe2 size={17}/>} title="Latest ledger" value={networkInfo?.latestLedger?.toLocaleString()??"—"} note={networkInfo?.online?"Network online":"Unavailable"}/>
      </div>
    </section>

    <section className="nx-overview-discovery">
      <div className="nx-overview-discovery-head"><div><div className="nx-panel-kicker">DISCOVERY HUB</div><h2>{category==="trending"?"Stellar market activity":"Tokenized real-world assets"}</h2><p>{category==="trending"?"Leading assets on the Stellar network.":"Issuer research references."}</p></div>
        <div className="nx-overview-discovery-tabs" role="tablist" aria-label="Discovery categories">
          <button role="tab" aria-selected={category==="trending"} className={category==="trending"?"active":""} onClick={()=>setCategory("trending")}><Flame size={13}/>Trending</button>
          <button role="tab" aria-selected={category==="rwa"} className={category==="rwa"?"active":""} onClick={()=>setCategory("rwa")}><Landmark size={13}/>Tokenized RWAs</button>
        </div>
      </div>
      <div className="nx-discovery-action-row"><span>STELLAR DISCOVERY STREAM</span><button type="button" onClick={scrollExplorer}>Browse all assets <ArrowRight size={13}/></button></div>
      {category==="trending"?<div className="nx-indexed-assets-panel">
        <div className="nx-indexed-assets-head"><div><strong>Top 50 Stellar assets</strong>{directory&&<small>Updated {time(directory.retrievedAt)}</small>}</div></div>
        {directoryLoading&&!directory&&<div className="nx-indexed-assets-empty">Loading assets…</div>}
        {directoryError&&<div className="nx-indexed-assets-empty error">{directoryError}</div>}
        {directory?.assets.length?<div className="nx-indexed-assets-list">{directory.assets.slice(0,10).map(asset=><button type="button" className="nx-indexed-asset-row" key={asset.assetCode+":"+asset.issuer} onClick={()=>{setQuery(asset.assetCode);setExplorerTab("all");scrollExplorer();}}>
          <span className="nx-indexed-asset-rank">{String(asset.rank).padStart(2,"0")}</span><span className="nx-indexed-asset-identity"><strong>{asset.assetCode}</strong><small>{asset.domain??short(asset.issuer)}</small></span>
          <span><small>Holders</small><b>{asset.holders===null?"—":asset.holders.toLocaleString()}</b></span>
          <span><small>Price</small><b>{asset.price===null?"—":fmt(asset.price,6)}</b></span>
          <span><small>24h volume</small><b>{asset.volume24h===null?"—":fmt(asset.volume24h)}</b></span>
        </button>)}</div>:!directoryLoading&&!directoryError&&<div className="nx-indexed-assets-empty">No assets to show.</div>}
      </div>:<div className="nx-overview-rwa-grid">{RWA.map(item=><RwaCard key={item.name} item={item}/>)}</div>}
    </section>

    <section className="nx-panel nx-explorer-workspace" id="token-explorer">
      <div className="nx-explorer-workspace-head">
        <div><div className="nx-panel-kicker">STELLAR ASSET DIRECTORY</div><h2>Token Explorer</h2><p>Search assets, review issuer controls and keep a watchlist.</p></div>
      </div>
      <div className="nx-explorer-toolbar">
        <div className="nx-explorer-tabs" role="tablist" aria-label="Explorer asset categories">
          <button role="tab" aria-selected={explorerTab==="all"} className={explorerTab==="all"?"active":""} onClick={()=>setExplorerTab("all")}><Layers3 size={13}/>All assets</button>
          <button role="tab" aria-selected={explorerTab==="classic"} className={explorerTab==="classic"?"active":""} onClick={()=>setExplorerTab("classic")}><Landmark size={13}/>Classic</button>
          <button role="tab" aria-selected={explorerTab==="watchlist"} className={explorerTab==="watchlist"?"active":""} onClick={()=>setExplorerTab("watchlist")}><Star size={13}/>Watchlist <span>{watchlist.length}</span></button>
          <button role="tab" aria-selected={explorerTab==="rwa"} className={explorerTab==="rwa"?"active":""} onClick={()=>setExplorerTab("rwa")}><Globe2 size={13}/>RWA references</button>
        </div>
        {explorerTab!=="rwa"&&<div className="nx-explorer-filter">
          <label><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search asset code…"/></label>
          <select value={sort} onChange={e=>setSort(e.target.value as "holders"|"code")} aria-label="Sort results"><option value="holders">Most holders</option><option value="code">Asset code</option></select>
          <div className="nx-explorer-view-switch">
            <button type="button" className={assetView==="table"?"active":""} onClick={()=>setAssetView("table")} aria-label="Table view"><Layers3 size={13}/></button>
            <button type="button" className={assetView==="cards"?"active":""} onClick={()=>setAssetView("cards")} aria-label="Card view"><LayoutGrid size={13}/></button>
          </div>
          <button type="button" className={filtersOpen?"nx-explorer-filter-toggle active":"nx-explorer-filter-toggle"} onClick={()=>setFiltersOpen(v=>!v)}><Filter size={13}/> Filters</button>
        </div>}
      </div>
      {filtersOpen&&explorerTab!=="rwa"&&<div className="nx-explorer-advanced-filters">
        <label>Issuer authorization<select value={authorizationFilter} onChange={e=>setAuthorizationFilter(e.target.value as "all"|"required"|"not_required")}><option value="all">All issuer settings</option><option value="required">Authorization required</option><option value="not_required">No authorization required</option></select></label>
        <label>Minimum holders<select value={minimumHolders} onChange={e=>setMinimumHolders(e.target.value as "0"|"100"|"1000"|"10000")}><option value="0">Any reported count</option><option value="100">100+ holders</option><option value="1000">1,000+ holders</option><option value="10000">10,000+ holders</option></select></label>
        <label>Revocability<select value={revocabilityFilter} onChange={e=>setRevocabilityFilter(e.target.value as "all"|"revocable"|"non_revocable")}><option value="all">All reported settings</option><option value="revocable">Revocable authorization</option><option value="non_revocable">Non-revocable authorization</option></select></label>
        <div className="nx-explorer-filter-summary"><span>{activeFilterCount?activeFilterCount+" active filter(s)":"No filters applied"}</span><button type="button" disabled={activeFilterCount===0} onClick={()=>{setAuthorizationFilter("all");setMinimumHolders("0");setRevocabilityFilter("all");}}>Reset filters</button></div>
      </div>}
      {explorerTab==="rwa"?<div className="nx-overview-rwa-grid">{RWA.map(item=><RwaCard key={item.name} item={item}/>)}</div>:<div className="nx-explorer-results">
        <div className="nx-explorer-results-heading"><span>{visibleAssets.length} matching record(s)</span><span>{loading?"Searching…":searched?"":"Search an asset code to begin"}</span></div>
        {assetView==="table"?<>
          <div className="nx-explorer-table-head"><span>ASSET</span><span>ISSUER ACCOUNT</span><span>HOLDERS</span><span>AUTH</span><span>WATCH</span></div>
          {loading?<div className="nx-explorer-result-empty">Searching…</div>:assetsError?<div className="nx-explorer-result-empty error">{assetsError}</div>:visibleAssets.length?visibleAssets.map(asset=><div className="nx-explorer-table-row" key={keyOf(asset)}>
            <button type="button" className="nx-explorer-asset-name" onClick={()=>setSelected(asset)}><span>{asset.asset_code.slice(0,1)}</span><b>{asset.asset_code}<small>Classic Stellar asset</small></b></button>
            <button type="button" className="nx-explorer-issuer" onClick={()=>setSelected(asset)} title={asset.asset_issuer}>{short(asset.asset_issuer)}</button>
            <span>{asset.num_accounts??"—"}</span><span className="nx-record-badge">{asset.auth_required===undefined?"Not reported":asset.auth_required?"Required":"Not required"}</span>
            <button type="button" className={watchlist.includes(keyOf(asset))?"nx-watch-toggle active":"nx-watch-toggle"} onClick={()=>toggleWatch(asset)} aria-label="Toggle watchlist"><Star size={15} fill={watchlist.includes(keyOf(asset))?"currentColor":"none"}/></button>
          </div>):<div className="nx-explorer-result-empty">{explorerTab==="watchlist"?"No searched assets in your watchlist. Search by code, then tap the star to save one.":searched?"No assets matched “"+query+"”.":"Search an asset code to begin."}</div>}
        </>:<div className="nx-explorer-card-grid">
          {loading?<div className="nx-explorer-result-empty">Searching…</div>:assetsError?<div className="nx-explorer-result-empty error">{assetsError}</div>:visibleAssets.length?visibleAssets.map(asset=><article className="nx-explorer-asset-card" key={keyOf(asset)}>
            <button type="button" className="nx-explorer-card-open" onClick={()=>setSelected(asset)}><span>{asset.asset_code.slice(0,1)}</span><div><strong>{asset.asset_code}</strong><small>{short(asset.asset_issuer)}</small></div></button>
            <button type="button" className={watchlist.includes(keyOf(asset))?"nx-watch-toggle active":"nx-watch-toggle"} onClick={()=>toggleWatch(asset)} aria-label="Toggle watchlist"><Star size={15} fill={watchlist.includes(keyOf(asset))?"currentColor":"none"}/></button>
            <div className="nx-explorer-card-meta"><span>Holders <b>{asset.num_accounts??"—"}</b></span><span>Auth <b>{asset.auth_required===undefined?"—":asset.auth_required?"Required":"Open"}</b></span></div>
          </article>):<div className="nx-explorer-result-empty">{explorerTab==="watchlist"?"No assets in your watchlist.":searched?"No assets matched “"+query+"”.":"Search an asset code to begin."}</div>}
        </div>}
      </div>}
    </section>

    {selected&&<div className="nx-asset-quickview-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
      <aside ref={quickViewRef} className="nx-asset-quickview" role="dialog" aria-modal="true" aria-label={selected.asset_code+" details"} tabIndex={-1}>
        <div className="nx-quickview-head"><div><div className="nx-panel-kicker">ASSET QUICK VIEW</div><h2>{selected.asset_code}</h2></div><button ref={quickViewCloseRef} type="button" onClick={()=>setSelected(null)} aria-label="Close asset details"><X size={17}/></button></div>
        <div className="nx-quickview-token"><span>{selected.asset_code.slice(0,1)}</span><div><strong>{selected.asset_code}</strong><small>{short(selected.asset_issuer)}</small></div></div>
        <div className="nx-quickview-tabs" role="tablist" aria-label="Asset detail sections">
          <button type="button" role="tab" aria-selected={quickViewTab==="overview"} className={quickViewTab==="overview"?"active":""} onClick={()=>setQuickViewTab("overview")}><Info size={13}/> Overview</button>
          <button type="button" role="tab" aria-selected={quickViewTab==="market"} className={quickViewTab==="market"?"active":""} onClick={()=>setQuickViewTab("market")}><Activity size={13}/> Market</button>
          <button type="button" role="tab" aria-selected={quickViewTab==="swap"} className={quickViewTab==="swap"?"active":""} onClick={()=>setQuickViewTab("swap")}><ArrowDownUp size={13}/> Quick Swap</button>
        </div>
        {quickViewTab==="overview"&&<div className="nx-quickview-pane">
          <div className="nx-quickview-stats"><div><small>Reported holders</small><strong>{selected.num_accounts??"—"}</strong></div><div><small>Supply</small><strong>{selectedSupplyLoading?"Loading…":selectedSupply?.supply??(selectedSupplyError?"Unavailable":"—")}</strong></div></div>
          <div className="nx-quickview-section"><small>FULL ASSET IDENTIFIER · CODE + ISSUER</small><code>{selected.asset_code}:{selected.asset_issuer}</code><button type="button" onClick={()=>void navigator.clipboard.writeText(selected.asset_issuer)}><Check size={13}/> Copy issuer account</button></div>
          <div className="nx-quickview-controls"><strong>Issuer / asset controls</strong><span>Authorization required <b>{selected.auth_required===undefined?"Not reported":selected.auth_required?"Yes":"No"}</b></span><span>Authorization revocable <b>{selected.auth_revocable===undefined?"Not reported":selected.auth_revocable?"Yes":"No"}</b></span><span>Authorization immutable <b>{selected.auth_immutable===undefined?"Not reported":selected.auth_immutable?"Yes":"No"}</b></span></div>
          <section className="nx-asset-evidence">
            <div className="nx-asset-evidence-heading"><strong>Asset record</strong></div>
            {([
              ["Asset identity",true,"Asset code + issuer"],
              ["Holder count",selected.num_accounts!==undefined,selected.num_accounts!==undefined?"Holder count reported":"Not reported"],
              ["Supply field",selected.amount!==undefined,selected.amount!==undefined?"Supply reported":"Not reported"],
              ["Authorization required",selected.auth_required!==undefined,selected.auth_required!==undefined?"Flag reported":"Not reported"],
              ["Authorization revocable",selected.auth_revocable!==undefined,selected.auth_revocable!==undefined?"Flag reported":"Not reported"],
              ["Authorization immutable",selected.auth_immutable!==undefined,selected.auth_immutable!==undefined?"Flag reported":"Not reported"]
            ] as [string,boolean,string][]).map(([label,available,detail])=><div className="nx-asset-evidence-row" key={label}><span className={available?"available":"missing"}>{available?"Reported":"Unavailable"}</span><div><b>{label}</b><small>{detail}</small></div></div>)}
          </section>
        </div>}
        {quickViewTab==="market"&&<div className="nx-quickview-pane">
          <div className="nx-quickview-market-state"><span><Activity size={17}/></span><strong>No market data for this asset</strong><p>Open Swap to check available liquidity and pricing.</p></div>
          <Link className="nx-quickview-market-link" href={`/swap?buyCode=${encodeURIComponent(selected.asset_code)}&buyIssuer=${encodeURIComponent(selected.asset_issuer)}`}>Inspect in Swap <ArrowRight size={13}/></Link>
        </div>}
        {quickViewTab==="swap"&&<div className="nx-quickview-pane">
          <div className="nx-quickview-swap-pair">
            <div><small>YOU PAY</small><strong>XLM</strong><span>Native Stellar asset</span></div>
            <span><ArrowDownUp size={16}/></span>
            <div><small>YOU RECEIVE</small><strong>{selected.asset_code}</strong><span>{short(selected.asset_issuer)}</span></div>
          </div>
          <div className="nx-quickview-market-state"><span><ShieldCheck size={17}/></span><strong>Get a quote in Swap</strong><p>Route, price impact and minimum received are shown in Swap before you confirm.</p></div>
          <Link className="nx-quickview-market-link" href={`/swap?buyCode=${encodeURIComponent(selected.asset_code)}&buyIssuer=${encodeURIComponent(selected.asset_issuer)}`}>Open Swap terminal <ArrowRight size={13}/></Link>
        </div>}
        <div className="nx-quickview-actions"><Link href={`/swap?buyCode=${encodeURIComponent(selected.asset_code)}&buyIssuer=${encodeURIComponent(selected.asset_issuer)}`}>Open in Swap <ArrowRight size={13}/></Link></div>
      </aside>
    </div>}
  </div>;
}

function Signal({icon,title,value,note,tone="neutral"}:{icon:ReactNode;title:string;value:string;note:string;tone?:"neutral"|"positive"|"negative"}) {
  return <article className="nx-overview-signal-card"><span>{icon}</span><small>{title}</small><strong className={tone}>{value}</strong><p>{note}</p></article>;
}
function RwaCard({item}:{item:{name:string;issuer:string;text:string;href:string}}) {
  return <a href={item.href} target="_blank" rel="noreferrer" className="nx-overview-rwa-card"><span><Landmark size={16}/></span><strong>{item.name}</strong><small>{item.issuer}</small><p>{item.text}</p><em>Issuer research reference <ExternalLink size={12}/></em></a>;
}
