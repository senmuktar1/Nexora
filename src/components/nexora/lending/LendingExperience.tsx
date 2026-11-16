/* eslint-disable react-hooks/set-state-in-effect -- Effects coordinate asynchronous network and wallet reads with request state. */
"use client";
import LendFlow from "./LendFlow";
import DefindexActions from "./DefindexActions";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity, ArrowDownUp, ArrowRight, ArrowUpRight, ArrowLeftRight,
  ChevronRight, Clock3, ExternalLink,
  Landmark, Layers3, LockKeyhole, RefreshCw, Search, ShieldAlert,
  ShieldCheck, SlidersHorizontal, Sparkles, Wallet, X
} from "lucide-react";

type Network = "testnet" | "mainnet";
type View = "assets" | "vaults" | "finder" | "compare";
type LendingAction = "lend" | "borrow" | "stake";
type AssetRecord = {
  asset_code: string;
  asset_issuer: string;
  num_accounts?: string;
  amount?: string;
  auth_required?: boolean;
  auth_revocable?: boolean;
  auth_immutable?: boolean;
};
type AccountData = {
  balances: {asset_code:string;asset_type:string;asset_issuer?:string;balance:string}[];
};
type BlendReserve = { assetContract:string;symbol:string|null;name:string|null;decimals:number;tokenDecimals:number|null;decimalsMatch:boolean|null;oraclePrice:number|null;oracleValueSupplied:number|null;oracleValueBorrowed:number|null;oracleLedger:number|null;enabled:boolean;supplyApr:number|null;borrowApr:number|null;estimatedSupplyApy:number|null;estimatedBorrowApy:number|null;utilization:number|null;supplied:number|null;borrowed:number|null;collateralFactor:number|null;liabilityFactor:number|null;latestLedger:number };
type BlendPoolRecord = { id:string;label:string;name:string;version:string;status:number;admin:string;backstop:string;oracle:string;oracleLedger:number|null;oracleReadAvailable:boolean;oracleReadError:string|null;wasmHash:string;latestLedger:number;reserves:BlendReserve[] };
type BlendSnapshot = { network:Network;ledger:number;retrievedAt:string;pools:BlendPoolRecord[];unavailable:{id:string;label:string;reason:string}[] };
type BlendPositionRow = { assetContract:string;symbol:string|null;name:string|null;supply:number|null;collateral:number|null;borrowed:number|null;effectiveCollateral:number|null;effectiveLiability:number|null;oraclePrice:number|null;oracleValue:number|null;latestLedger:number };
type BlendPositionEstimate = { totalBorrowed:number|null;totalSupplied:number|null;totalEffectiveLiabilities:number|null;totalEffectiveCollateral:number|null;borrowCap:number|null;borrowLimit:number|null;netApy:number|null;supplyApy:number|null;borrowApy:number|null };
type BlendUserPool = { id:string;label:string;name:string;version:string;hasPosition:boolean;positions:BlendPositionRow[];estimate:BlendPositionEstimate|null;oracleLedger:number|null;oracleLedgerAge?:number|null;latestReserveLedger?:number|null;rpcLedger?:number|null;oracleBehindRpcHead?:boolean;oracleBehindReserveState?:boolean };
type BlendPositionsSnapshot = { network:Network;address:string;ledger:number;retrievedAt:string;pools:BlendUserPool[];unavailable:{id:string;label:string;reason:string}[] };
type DefindexVault = { address?:string;name?:string;symbol?:string;apy?:number;totalManagedFunds?:{asset?:string;total_amount?:string}[];assets?:{address?:string;symbol?:string}[] };
type DefindexSnapshot = { network:Network;source:string;retrievedAt:string;totalVaults:number;vaults:DefindexVault[];strategies:Record<string,unknown>[];errors:{vaults:string|null;strategies:string|null} };
type DefindexVaultMetadata = { name?:string;symbol?:string;apy?:number;assets?:{address?:string;name?:string;symbol?:string;strategies?:{address?:string;name?:string;paused?:boolean}[]}[];totalManagedFunds?:{asset?:string;idle_amount?:string;invested_amount?:string;total_amount?:string;strategy_allocations?:{amount?:string;paused?:boolean;strategy_address?:string}[]}[];feesBps?:{vaultFee?:number;defindexFee?:number};roles?:{manager?:string;emergencyManager?:string;rebalanceManager?:string;feeReceiver?:string} };
type DefindexVaultInspection = { network:Network;address:string;addressFormatValid:boolean;source?:string;retrievedAt?:string;metadata:DefindexVaultMetadata|null;error:string|null;authRequired:boolean };
type DefindexOnChainVerification = {network:Network;address:string;source:string;ledger?:number;retrievedAt:string;contractExists:boolean;methods?:string[];methodGroups?:{shareAccounting:string[];deposits:string[];withdrawals:string[];permissions:string[]};missingRequiredMethods?:string[];checks?:Record<string,boolean>;onChain?:{name:unknown;symbol:unknown;assets:{address:string|null;name:string|null;symbol:string|null;decimals:number|null;decimalsVerified:boolean;decimalsError:string|null;strategies:{address:string|null;name:string|null;paused:boolean|null}[]}[];managedFunds:{asset:string|null;idleAmount:unknown;investedAmount:unknown;totalAmount:unknown;strategyAllocations:{amount:unknown;paused:boolean|null;strategyAddress:string|null}[]}[];reconciliation:{asset:string|null;rawUnits:boolean;idleAmount:string|null;investedAmount:string|null;totalAmount:string|null;allocationCount:number;allocationSum:string|null;idlePlusInvested:string|null;allocationVsInvestedDelta:string|null;totalVsIdlePlusInvestedDelta:string|null;allocationStatus:"unverifiable"|"matches"|"mismatch";totalStatus:"unverifiable"|"matches"|"mismatch"}[];fees:unknown;shareAccounting:{method:string;available:boolean;value:unknown;error:string|null}[];roles:{method:string;available:boolean;value:unknown;error?:string}[];errors?:{name:string|null;symbol:string|null;assets:string|null;managedFunds:string|null;fees:string|null}};error:string|null};





type Protocol = {
  id:string; name:string; category:string; url:string;
  description:string; type:"yield"|"lending"|"staking";
};

const PROTOCOLS:Protocol[] = [
  {id:"defindex",name:"DeFindex",category:"Vault strategies",url:"https://docs.defindex.io/",description:"Vault strategies with share accounting and underlying asset allocations.",type:"yield"},
  {id:"blend",name:"Blend",category:"Lending pools",url:"https://docs.blend.capital/",description:"Supply and borrow markets with utilization, collateral parameters and backstop protection.",type:"lending"},
  {id:"soroswap",name:"Soroswap",category:"DEX liquidity",url:"https://docs.soroswap.finance/",description:"AMM liquidity and swap routing on Stellar.",type:"staking"}
];
const assetKey = (a:Pick<AssetRecord,"asset_code"|"asset_issuer">) => a.asset_code + ":" + a.asset_issuer;
const short = (s:string) => s.length > 22 ? s.slice(0,8) + "…" + s.slice(-7) : s;

export default function LendingExperience({network,address,onConnect}:{network:Network;address:string|null;onConnect:()=>void}) {
  const [view,setView] = useState<View>("assets");
  const [lendingAction,setLendingAction] = useState<LendingAction>("lend");
  const [query,setQuery] = useState("USDC");
  const [assets,setAssets] = useState<AssetRecord[]>([]);
  const [loading,setLoading] = useState(false);
  const [searched,setSearched] = useState(false);
  const [loadError,setLoadError] = useState<string|null>(null);
  const [refreshKey,setRefreshKey] = useState(0);
  const [account,setAccount] = useState<AccountData|null>(null);
  const [accountNetwork,setAccountNetwork] = useState<Network|null>(null);
  const [accountRetry,setAccountRetry] = useState(0);
  const [accountError,setAccountError] = useState<string|null>(null);
  const [accountLoading,setAccountLoading] = useState(false);
  const [assetFilter,setAssetFilter] = useState("all");
  const [protocolFilter,setProtocolFilter] = useState("all");
  const [categoryFilter,setCategoryFilter] = useState("all");
  const [showAll,setShowAll] = useState(false);
  const [sort,setSort] = useState("asset");
  const [selectedAsset,setSelectedAsset] = useState<AssetRecord|null>(null);
  const [selectedProtocol,setSelectedProtocol] = useState<Protocol|null>(null);
  const [selectedBlendReserve,setSelectedBlendReserve] = useState<{pool:BlendPoolRecord;reserve:BlendReserve}|null>(null);
  const [showRiskPreview,setShowRiskPreview] = useState(false);
  const [riskDrop,setRiskDrop] = useState(20);
  const [lastUpdated,setLastUpdated] = useState<string|null>(null);
  const [blendSnapshot,setBlendSnapshot] = useState<BlendSnapshot|null>(null);
  const [blendLoading,setBlendLoading] = useState(false);
  const [blendError,setBlendError] = useState<string|null>(null);
  const [blendRetry,setBlendRetry] = useState(0);
  const [blendPositions,setBlendPositions] = useState<BlendPositionsSnapshot|null>(null);
  const [blendPositionsLoading,setBlendPositionsLoading] = useState(false);
  const [blendPositionsError,setBlendPositionsError] = useState<string|null>(null);
  const [blendPositionsRetry,setBlendPositionsRetry] = useState(0);
  const [defindexSnapshot,setDefindexSnapshot] = useState<DefindexSnapshot|null>(null);
  const [defindexLoading,setDefindexLoading] = useState(false);
  const [defindexRetry,setDefindexRetry] = useState(0);
  const [comparedVaultAddresses,setComparedVaultAddresses] = useState<string[]>([]);
  const [inspectedVaultAddress,setInspectedVaultAddress] = useState<string|null>(null);
  const [vaultInspection,setVaultInspection] = useState<DefindexVaultInspection|null>(null);
  const [vaultInspectionLoading,setVaultInspectionLoading] = useState(false);
  const [vaultChainVerification,setVaultChainVerification] = useState<DefindexOnChainVerification|null>(null);
  const [vaultChainLoading,setVaultChainLoading] = useState(false);

  const [blendPreflightAction,setBlendPreflightAction] = useState<"supply"|"withdraw"|"borrow"|"repay">("supply");
  const [lendAction,setLendAction] = useState(false);
  const [blendPreflightAmount,setBlendPreflightAmount] = useState("1");
  const [blendPreflightLoading,setBlendPreflightLoading] = useState(false);
  const [blendPreflightError,setBlendPreflightError] = useState<string|null>(null);
  const [blendPreflightResult,setBlendPreflightResult] = useState<{
    canPrepareTransaction:boolean;canSubmitTransaction:boolean;latestLedger:number;reserveDecimals?:number;poolStatusLabel?:string;
    walletBalanceRaw:string|null;userSupplyRaw:string;userCollateralRaw:string;userLiabilityRaw:string;availableLiquidityRaw:string;
    borrowHeadroomOracleUnits:number|null;requestedBorrowOracleUnits:number|null;
    gates:{id:string;label:string;passed:boolean;detail:string}[]
  }|null>(null);





  useEffect(()=>{
    let cancelled=false;
    const controller=new AbortController();
    const trimmed=query.trim();
    if(trimmed.length<2){
      const frame=window.requestAnimationFrame(()=>{
        if(!cancelled){setAssets([]);setSearched(false);setLoading(false);setLoadError(null);}
      });
      return ()=>{cancelled=true;window.cancelAnimationFrame(frame);controller.abort();};
    }
    setLoading(true);
    setLoadError(null);
    const timer=window.setTimeout(()=>{
      fetch("/api/stellar/assets?code="+encodeURIComponent(trimmed)+"&network="+network,{cache:"no-store",signal:controller.signal})
        .then(async response=>{
          const data=await response.json();
          if(!response.ok)throw new Error("Assets are temporarily unavailable.");
          return data;
        })
        .then(data=>{
          if(!cancelled){
            setAssets(Array.isArray(data.assets)?data.assets:[]);
            setSearched(true);
            setLastUpdated(new Date().toISOString());
          }
        })
        .catch((error:unknown)=>{
          if(!cancelled&&!controller.signal.aborted){
            setAssets([]);
            setSearched(true);
            setLoadError(error instanceof Error?error.message:"Assets are temporarily unavailable.");
          }
        })
        .finally(()=>{if(!cancelled)setLoading(false);});
    },250);
    return ()=>{cancelled=true;window.clearTimeout(timer);controller.abort();};
  },[query,network,refreshKey]);

  useEffect(()=>{
    let cancelled=false;
    const controller=new AbortController();
    setBlendLoading(true);
    setBlendError(null);
    setBlendSnapshot(null);
    fetch("/api/stellar/blend?network="+network,{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error("Markets are temporarily unavailable.");
        return data as BlendSnapshot;
      })
      .then(data=>{if(!cancelled){setBlendSnapshot(data);setLastUpdated(data.retrievedAt);}})
      .catch((error:unknown)=>{if(!cancelled&&!controller.signal.aborted){setBlendSnapshot(null);setBlendError(error instanceof Error?error.message:"Markets are temporarily unavailable.");}})
      .finally(()=>{if(!cancelled)setBlendLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[network,blendRetry]);

  useEffect(()=>{
    let cancelled=false;
    const controller=new AbortController();
    setDefindexLoading(true);
    setDefindexSnapshot(null);
    fetch("/api/stellar/defindex?network="+network,{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error("Vaults are temporarily unavailable.");
        return data as DefindexSnapshot;
      })
      .then(data=>{if(!cancelled){setDefindexSnapshot(data);setLastUpdated(data.retrievedAt);}})
      .catch((error:unknown)=>{if(!cancelled&&!controller.signal.aborted){setDefindexSnapshot({network,source:"DeFindex public REST discovery endpoints",retrievedAt:new Date().toISOString(),totalVaults:0,vaults:[],strategies:[],errors:{vaults:error instanceof Error?error.message:"Vaults are temporarily unavailable.",strategies:null}});}})
      .finally(()=>{if(!cancelled)setDefindexLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[network,defindexRetry]);

  useEffect(()=>{
    if(!inspectedVaultAddress){setVaultInspection(null);setVaultInspectionLoading(false);return;}
    let cancelled=false;
    const controller=new AbortController();
    setVaultInspection(null);
    setVaultInspectionLoading(true);
    fetch("/api/stellar/defindex/vault?network="+network+"&address="+encodeURIComponent(inspectedVaultAddress),{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error("Vault details are temporarily unavailable.");
        return data as DefindexVaultInspection;
      })
      .then(data=>{if(!cancelled)setVaultInspection(data);})
      .catch((error:unknown)=>{if(!cancelled&&!controller.signal.aborted)setVaultInspection({network,address:inspectedVaultAddress,addressFormatValid:true,metadata:null,error:error instanceof Error?error.message:"Vault details are temporarily unavailable.",authRequired:false});})
      .finally(()=>{if(!cancelled)setVaultInspectionLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[network,inspectedVaultAddress]);

  useEffect(()=>{
    if(!inspectedVaultAddress){setVaultChainVerification(null);setVaultChainLoading(false);return;}
    let cancelled=false;
    const controller=new AbortController();
    setVaultChainVerification(null);
    setVaultChainLoading(true);
    fetch("/api/stellar/defindex/verify?network="+network+"&address="+encodeURIComponent(inspectedVaultAddress),{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok&&!data.contractExists)throw new Error("Verification is temporarily unavailable.");
        return data as DefindexOnChainVerification;
      })
      .then(data=>{if(!cancelled)setVaultChainVerification(data);})
      .catch((error:unknown)=>{if(!cancelled&&!controller.signal.aborted)setVaultChainVerification({network,address:inspectedVaultAddress,source:"Stellar Soroban RPC",retrievedAt:new Date().toISOString(),contractExists:false,error:error instanceof Error?error.message:"Verification is temporarily unavailable."});})
      .finally(()=>{if(!cancelled)setVaultChainLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[network,inspectedVaultAddress]);

  useEffect(()=>{
    if(!address){
      const frame=window.requestAnimationFrame(()=>{setBlendPositions(null);setBlendPositionsError(null);setBlendPositionsLoading(false);});
      return ()=>window.cancelAnimationFrame(frame);
    }
    let cancelled=false;
    const controller=new AbortController();
    setBlendPositions(null);
    setBlendPositionsError(null);
    setBlendPositionsLoading(true);
    fetch("/api/stellar/blend/positions?network="+network+"&address="+encodeURIComponent(address),{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error("Couldn't load positions.");
        return data as BlendPositionsSnapshot;
      })
      .then(data=>{if(!cancelled){setBlendPositions(data);setLastUpdated(data.retrievedAt);}})
      .catch((error:unknown)=>{if(!cancelled&&!controller.signal.aborted){setBlendPositions(null);setBlendPositionsError(error instanceof Error?error.message:"Couldn't load positions.");}})
      .finally(()=>{if(!cancelled)setBlendPositionsLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[address,network,blendPositionsRetry]);

  useEffect(()=>{
    if(!address){
      const frame=window.requestAnimationFrame(()=>{
        setAccount(null);setAccountNetwork(null);setAccountError(null);setAccountLoading(false);
      });
      return ()=>window.cancelAnimationFrame(frame);
    }
    let cancelled=false;
    const controller=new AbortController();
    setAccount(null);
    setAccountNetwork(null);
    setAccountError(null);
    setAccountLoading(true);
    fetch("/api/stellar/account?address="+encodeURIComponent(address)+"&network="+network,{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error("Couldn't load balances.");
        return data as AccountData;
      })
      .then(data=>{if(!cancelled){setAccount(data);setAccountNetwork(network);setAccountError(null);}})
      .catch((error:unknown)=>{if(!cancelled&&!controller.signal.aborted){setAccount(null);setAccountError(error instanceof Error?error.message:"Couldn't load balances.");}})
      .finally(()=>{if(!cancelled)setAccountLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[address,network,accountRetry]);

  const visibleAssets=useMemo(()=>{
    let rows=[...assets];
    if(assetFilter==="authorized")rows=rows.filter(row=>row.auth_required===true);
    if(assetFilter==="open")rows=rows.filter(row=>row.auth_required===false);
    if(sort==="holders")rows.sort((a,b)=>Number(b.num_accounts||0)-Number(a.num_accounts||0));
    else rows.sort((a,b)=>a.asset_code.localeCompare(b.asset_code));
    return showAll?rows:rows.slice(0,8);
  },[assets,assetFilter,sort,showAll]);

  const accountReady=Boolean(address&&!accountLoading&&!accountError&&accountNetwork===network&&account);
  const comparedVaults=defindexSnapshot?.vaults.filter(vault=>vault.address&&comparedVaultAddresses.includes(vault.address))??[];
  useEffect(()=>{
    if(!selectedAsset&&!selectedProtocol)return;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    const frame=window.requestAnimationFrame(()=>{
      const drawer=document.querySelector<HTMLElement>(".nx-lending-drawer");
      drawer?.focus();
    });
    document.body.style.overflow="hidden";
    function handleKeyDown(event:KeyboardEvent){
      if(event.key==="Escape"){
        setSelectedAsset(null);
        setSelectedProtocol(null);
        return;
      }
      if(event.key!=="Tab")return;
      const drawer=document.querySelector<HTMLElement>(".nx-lending-drawer");
      if(!drawer)return;
      const items=Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(item=>item.offsetParent!==null);
      if(!items.length){event.preventDefault();drawer.focus();return;}
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===drawer)){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&document.activeElement===last){
        event.preventDefault();first.focus();
      }
    }
    document.addEventListener("keydown",handleKeyDown);
    return ()=>{
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown",handleKeyDown);
      document.body.style.overflow=previousOverflow;
      previousFocus?.focus();
    };
  },[selectedAsset,selectedProtocol]);

  const balanceCount=accountReady?account?.balances?.length??0:0;
  const activeBlendPositions=blendPositions?.pools.filter(pool=>pool.hasPosition)??[];
  const hasBlendPosition=activeBlendPositions.length>0;
  const positionEstimates=activeBlendPositions.map(pool=>pool.estimate).filter((value):value is BlendPositionEstimate=>Boolean(value));
  const positionBorrowLimit=positionEstimates.length?Math.max(...positionEstimates.map(value=>value.borrowLimit??0)):null;
  const positionTotalSupplied=positionEstimates.length?positionEstimates.reduce((sum,value)=>sum+(value.totalSupplied??0),0):null;
  const positionTotalBorrowed=positionEstimates.length?positionEstimates.reduce((sum,value)=>sum+(value.totalBorrowed??0),0):null;
  const positionValue=(value:number|null|undefined)=>value===null||value===undefined||!Number.isFinite(value)?"—":value.toLocaleString("en-US",{maximumFractionDigits:4});
  const positionPercent=(value:number|null|undefined)=>value===null||value===undefined||!Number.isFinite(value)?"—":(value*100).toFixed(2)+"%";
  const positionOracleLag=activeBlendPositions.length?Math.max(...activeBlendPositions.map(pool=>pool.oracleLedgerAge??0)):null;
  const positionOracleBehind=activeBlendPositions.some(pool=>pool.oracleBehindRpcHead||pool.oracleBehindReserveState);
  const topSupplyApy=blendSnapshot?.pools.flatMap(pool=>pool.reserves).filter(reserve=>reserve.enabled&&reserve.estimatedSupplyApy!==null).map(reserve=>reserve.estimatedSupplyApy as number).sort((a,b)=>b-a)[0]?.toLocaleString("en-US",{style:"percent",maximumFractionDigits:2})??"—";
  const activeMarketCount=blendSnapshot?String(blendSnapshot.pools.filter(pool=>pool.reserves.some(reserve=>reserve.enabled)).length):"—";
  const explorerContract=(id:string)=>"https://stellar.expert/explorer/public/contract/"+id;

  const stressFactor=1-riskDrop/100;
  const stressPools=activeBlendPositions.map(pool=>{
    const estimate=pool.estimate;
    if(!estimate||!pool.positions.length)return {pool,valid:false,collateral:0,liabilities:0,ratio:null as number|null,capacity:null as number|null};
    const collateral=pool.positions.reduce((sum,row)=>sum+(row.effectiveCollateral!==null&&row.effectiveCollateral!==undefined&&row.oraclePrice!==null?row.effectiveCollateral*row.oraclePrice:0),0);
    const liabilities=pool.positions.reduce((sum,row)=>sum+(row.effectiveLiability!==null&&row.effectiveLiability!==undefined&&row.oraclePrice!==null?row.effectiveLiability*row.oraclePrice:0),0);
    const hasMissing=pool.positions.some(row=>(row.effectiveCollateral===null||row.effectiveLiability===null||row.oraclePrice===null)&&((row.collateral??0)>0||(row.borrowed??0)>0));
    if(hasMissing)return {pool,valid:false,collateral,liabilities,ratio:null as number|null,capacity:null as number|null};
    const stressedCollateral=collateral*stressFactor;
    return {pool,valid:true,collateral:stressedCollateral,liabilities,ratio:stressedCollateral>0?liabilities/stressedCollateral:null,capacity:stressedCollateral-liabilities};
  });
  const stressHasPosition=stressPools.length>0;
  const stressUnavailable=stressPools.some(item=>!item.valid);


  const filteredProtocols=(protocolFilter==="all"?PROTOCOLS:PROTOCOLS.filter(p=>p.id===protocolFilter))
    .filter(p=>categoryFilter==="all"||p.type===categoryFilter);


  async function runBlendPreflight(){
    if(!selectedBlendReserve||!address)return;
    setBlendPreflightLoading(true);
    setBlendPreflightError(null);
    setBlendPreflightResult(null);
    try{
      const response=await fetch("/api/stellar/blend/preflight",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          network,action:blendPreflightAction,poolId:selectedBlendReserve.pool.id,
          asset:selectedBlendReserve.reserve.assetContract,wallet:address,amount:blendPreflightAmount
        })
      });
      const data=await response.json();
      if(!response.ok)throw new Error("Couldn't complete the check.");
      setBlendPreflightResult(data);
    }catch(error){
      setBlendPreflightError(error instanceof Error?error.message:"Couldn't complete the check.");
    }finally{
      setBlendPreflightLoading(false);
    }
  }

  function selectView(next:View){setView(next);setSelectedAsset(null);setSelectedProtocol(null);}
  function refresh(){setRefreshKey(v=>v+1);}
  function openAsset(asset:AssetRecord){setSelectedAsset(asset);setSelectedProtocol(null);}
  function openProtocol(protocol:Protocol){setSelectedProtocol(protocol);setSelectedAsset(null);}
  function assetBalance(asset:AssetRecord){
    return accountReady?account?.balances?.find(item=>item.asset_type!=="native"&&item.asset_code===asset.asset_code&&item.asset_issuer===asset.asset_issuer)?.balance??null:null;
  }

  return <div className="nx-lending-experience">
    <section className="nx-lending-header">
      <div className="nx-lending-title-row">
        <div>
          <div className="nx-lending-eyebrow"><span/> STELLAR DEFI WORKSPACE</div>
          <div className="nx-lending-title"><h1>Lend, Borrow &amp; Stake</h1></div>
          <p>Compare Stellar lending markets, vault yields and your positions in one place.</p>
        </div>
        <div className="nx-lending-freshness"><span><i/>{blendError&&!blendSnapshot?"Unavailable":blendLoading&&!blendSnapshot?"Loading…":blendSnapshot&&lastUpdated?"Live · updated "+new Date(lastUpdated).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—"}</span><button type="button" onClick={refresh} disabled={loading} aria-label="Refresh"><RefreshCw size={14}/></button></div>
      </div>
      <div className="nx-lending-kpis">
        <Kpi icon={<ArrowUpRight size={16}/>} label="Top Supply APY" value={topSupplyApy} note={blendSnapshot?"Blend · estimated":blendError?"Unavailable":"Loading…"}/>
        <Kpi icon={<Activity size={16}/>} label="Lowest Borrow APR" value={blendSnapshot?.pools.flatMap(pool=>pool.reserves).filter(reserve=>reserve.enabled&&reserve.borrowApr!==null).map(reserve=>reserve.borrowApr as number).sort((a,b)=>a-b)[0]?.toLocaleString("en-US",{style:"percent",maximumFractionDigits:2})??"—"} note={blendSnapshot?"Blend · variable":blendError?"Unavailable":"Loading…"}/>
        <Kpi icon={<Layers3 size={16}/>} label="Total Liquidity" value="—" note="Not available"/>
        <Kpi icon={<ShieldCheck size={16}/>} label="Active Markets" value={activeMarketCount} note={blendSnapshot?"Blend pools":blendError?"Unavailable":"Loading…"}/>
      </div>
      <p className="nx-lending-disclaimer">Rates are variable estimates, not guaranteed returns. Borrowing carries liquidation risk. Not financial advice.</p>
    </section>

    <div className="nx-lending-navigation">
      <div className="nx-lending-viewbar">
        <div className="nx-lending-tabs nx-lending-market-tabs" role="tablist" aria-label="Market categories">
          <button role="tab" aria-selected={view==="assets"} className={view==="assets"?"active":""} onClick={()=>selectView("assets")}><Sparkles size={14}/>Stellar Assets <span>{assets.length||"—"}</span></button>
          <button role="tab" aria-selected={view==="compare"} className={view==="compare"?"active":""} onClick={()=>selectView("compare")}><ArrowDownUp size={14}/>Compare Protocols <i>3 Protocols</i></button>
          <button role="tab" aria-selected={view==="finder"||view==="vaults"} className={view==="finder"||view==="vaults"?"active":""} onClick={()=>selectView("finder")}><Layers3 size={14}/>Yield Scanner</button>
        </div>
      </div>
      <div className="nx-lending-viewbar nx-lending-actionbar">
        <div className="nx-lending-tabs nx-lending-action-tabs" role="tablist" aria-label="Lending actions">
          <button role="tab" aria-selected={lendingAction==="lend"} className={lendingAction==="lend"?"active":""} onClick={()=>setLendingAction("lend")}><ArrowUpRight size={13}/>Lend &amp; Supply</button>
          <button role="tab" aria-selected={lendingAction==="borrow"} className={lendingAction==="borrow"?"active":""} onClick={()=>setLendingAction("borrow")}><LockKeyhole size={13}/>Borrow</button>
          <button role="tab" aria-selected={lendingAction==="stake"} className={lendingAction==="stake"?"active":""} onClick={()=>setLendingAction("stake")}><Activity size={13}/>Stake &amp; Vaults <i>Blend / DeFindex</i></button>
        </div>
      </div>
    </div>
    {lendingAction==="lend"&&<div className="nx-lending-action-notice"><ArrowUpRight size={14}/><div><strong>Supply markets</strong><span>Compare live supply rates across Blend lending pools.</span></div><button type="button" onClick={()=>selectView("compare")}>View markets <ChevronRight size={12}/></button></div>}
    {lendingAction==="borrow"&&<div className="nx-lending-action-notice"><LockKeyhole size={14}/><div><strong>Borrow markets</strong><span>Review borrow rates, utilization and collateral factors.</span></div><button type="button" onClick={()=>selectView("compare")}>View markets <ChevronRight size={12}/></button></div>}
    {lendingAction==="stake"&&<div className="nx-lending-action-notice"><Layers3 size={14}/><div><strong>Staking &amp; vaults</strong><span>Browse DeFindex vaults and their reported yields.</span></div><button type="button" onClick={()=>selectView("vaults")}>View vaults <ChevronRight size={12}/></button></div>}

    <section className="nx-lending-positions">
      <div className="nx-lending-position-head">
        <div className="nx-lending-position-icon"><Wallet size={17}/></div>
        <div className="nx-lending-position-copy"><strong>Your Positions &amp; Health</strong><small>{address?"Your Stellar account":"Set up a wallet to view your balances and positions."}</small></div>
        {address?<span className="nx-lending-account-chip">{short(address)}</span>:<button type="button" className="nx-lending-connect" onClick={onConnect}>Set Up Wallet <Wallet size={13}/></button>}
      </div>
      <div className="nx-lending-health">
        <div className="nx-lending-health-icon"><ShieldAlert size={16}/></div>
        <div className="nx-lending-health-copy">
          <div><strong>Liquidation Guard</strong><span className="nx-lending-status-chip">{hasBlendPosition?"Position open":blendPositionsLoading?"Loading":blendPositionsError?"Unavailable":address?"No open positions":"—"}</span></div>
          <p>{!address?"Set up a wallet to view collateral, debt and health.":blendPositionsLoading?"Loading positions…":blendPositionsError?"Couldn't load positions.":hasBlendPosition?"Borrow limit ratio is liabilities divided by effective collateral.":"You have no open positions in Blend pools."}</p>
          {hasBlendPosition&&<small>{activeBlendPositions.length} Blend pool position(s) · Supplied {positionValue(positionTotalSupplied)} · Borrowed {positionValue(positionTotalBorrowed)}</small>}
          {hasBlendPosition&&positionBorrowLimit!==null&&<small>Highest borrow limit ratio: {positionPercent(positionBorrowLimit)} · {positionBorrowLimit>=0.9?"High utilization of collateral capacity":positionBorrowLimit>=0.7?"Monitor collateral headroom":"Within current collateral headroom"}</small>}
          {hasBlendPosition&&<small className={positionOracleBehind?"nx-lending-oracle-lag":"nx-lending-oracle-current"}>Price feed: {positionOracleBehind?(positionOracleLag?positionOracleLag+" ledger(s) behind":"delayed")+" · estimates may be stale":"current"}</small>}
          {address&&accountReady&&<small>{balanceCount} wallet balance(s)</small>}{address&&accountError&&<button type="button" className="nx-lending-retry" onClick={()=>setAccountRetry(value=>value+1)}>Retry balances</button>}
          {address&&blendPositionsError&&<button type="button" className="nx-lending-retry" onClick={()=>setBlendPositionsRetry(value=>value+1)}>Retry positions</button>}{address&&Boolean(blendPositions&&blendPositions.unavailable.length>0)&&<small>Temporarily unavailable: {blendPositions?.unavailable.map(pool=>pool.label).join(", ")}</small>}
        </div>
        <div className="nx-lending-health-actions">
          <button type="button" onClick={()=>setShowRiskPreview(v=>!v)}><SlidersHorizontal size={12}/>{showRiskPreview?"Hide What-If":"Simulate Drop"}</button>
          <button type="button" disabled><Activity size={12}/>Set Alert</button>
        </div>
      </div>
      {showRiskPreview&&<div className="nx-lending-risk-preview"><div><strong>Collateral stress test</strong><small>{hasBlendPosition?"Collateral values fall by the selected percentage; liabilities stay unchanged.":"Requires an open Blend position."}</small></div><label>Collateral drop <b>{riskDrop}%</b><input type="range" min="5" max="90" step="5" value={riskDrop} onChange={event=>setRiskDrop(Number(event.target.value))}/></label>{!stressHasPosition?<span>No open position to simulate.</span>:stressUnavailable?<span>Some position values are unavailable.</span>:<div className="nx-lending-stress-results">{stressPools.map(item=><div key={item.pool.id}><strong>{item.pool.name||item.pool.label}</strong><span>Stressed effective collateral <b>{positionValue(item.collateral)}</b></span><span>Effective liabilities <b>{positionValue(item.liabilities)}</b></span><span>Stressed borrow-limit ratio <b>{positionPercent(item.ratio)}</b></span><span>Remaining collateral capacity <b>{positionValue(item.capacity)}</b></span><em>{item.ratio===null?"No collateral capacity":item.ratio>=1?"Above 100%: liabilities exceed stressed collateral":item.ratio>=0.9?"Critical: less than 10% collateral headroom":item.ratio>=0.7?"Elevated: monitor collateral headroom":"Within modeled collateral headroom"}</em></div>)}</div>}</div>}
      {hasBlendPosition&&<div className="nx-lending-user-position-list">
        <div className="nx-lending-user-position-head"><strong>Blend positions</strong><span>Ledger {blendPositions?.ledger??"—"}</span></div>
        {activeBlendPositions.map(pool=><article className="nx-lending-user-position" key={pool.id}>
          <div className="nx-lending-user-position-title"><strong>{pool.name||pool.label}</strong><small>{pool.version}</small></div>
          <div className="nx-lending-user-position-metrics">
            <div><small>SUPPLIED VALUE</small><b>{positionValue(pool.estimate?.totalSupplied)}</b></div>
            <div><small>BORROWED VALUE</small><b>{positionValue(pool.estimate?.totalBorrowed)}</b></div>
            <div><small>COLLATERAL VALUE</small><b>{positionValue(pool.estimate?.totalEffectiveCollateral)}</b></div>
            <div><small>LIABILITY VALUE</small><b>{positionValue(pool.estimate?.totalEffectiveLiabilities)}</b></div>
            <div><small>BORROW LIMIT RATIO</small><b>{positionPercent(pool.estimate?.borrowLimit)}</b></div>
            <div><small>NET APY ESTIMATE</small><b>{positionPercent(pool.estimate?.netApy)}</b></div>
          </div>
          <div className="nx-lending-user-position-assets">{pool.positions.map(position=><div key={position.assetContract}><span><b>{position.symbol||"Unknown asset"}</b><small>{short(position.assetContract)}</small></span><span>Supply {positionValue(position.supply)} · Collateral {positionValue(position.collateral)} · Borrow {positionValue(position.borrowed)}</span><span>Price {positionValue(position.oraclePrice)} · Value {positionValue(position.oracleValue)}</span></div>)}</div>
        </article>)}
      </div>}
    </section>

    <section className="nx-lending-spotlight">
      <div className="nx-lending-spotlight-copy">
        <div className="nx-lending-spotlight-badges"><span><Sparkles size={11}/> TOP YIELD SPOTLIGHT</span></div>
        <h2>Find a yield opportunity on Stellar.</h2>
        <p>Compare live lending rates and vault yields across Stellar protocols.</p>
      </div>
      <div className="nx-lending-spotlight-metrics"><div><small>TOP SUPPLY APY</small><strong>{topSupplyApy}</strong></div><div><small>VAULTS</small><strong>{defindexSnapshot&&!defindexSnapshot.errors.vaults?defindexSnapshot.totalVaults:"—"}</strong></div><button type="button" onClick={()=>selectView("vaults")}>Explore vaults <ArrowRight size={13}/></button></div>
    </section>

    {view==="assets"&&<section className="nx-lending-market-workspace">
      <div className="nx-lending-table-toolbar">
        <div className="nx-lending-table-search"><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search by asset, ticker or issuer…"/><kbd>⌕</kbd></div>
        <div className="nx-lending-table-toolbar-actions"><label><select value={sort} onChange={event=>setSort(event.target.value)} aria-label="Sort assets"><option value="asset">Asset code</option><option value="holders">Most holders</option></select></label><label><input type="checkbox" checked={showAll} onChange={event=>setShowAll(event.target.checked)}/> Show all assets</label><span><Clock3 size={12}/> {lastUpdated?"Updated "+new Date(lastUpdated).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"Awaiting source"}</span></div>
      </div>
      <div className="nx-lending-filter-block">
        <div className="nx-lending-filter-summary"><span><SlidersHorizontal size={12}/> Filters <b>{Number(assetFilter!=="all")+Number(protocolFilter!=="all")+Number(categoryFilter!=="all")}</b></span><button type="button" disabled={assetFilter==="all"&&protocolFilter==="all"&&categoryFilter==="all"} onClick={()=>{setAssetFilter("all");setProtocolFilter("all");setCategoryFilter("all");}}>Reset filters <X size={11}/></button></div>
        <div className="nx-lending-filter-line"><small>MARKET TYPE</small>{[["all","All Assets"],["authorized","Authorization Required"],["open","Open Trustlines"]].map(([id,label])=><button type="button" key={id} className={assetFilter===id?"active":""} onClick={()=>setAssetFilter(id)}>{label}</button>)}</div>
        <div className="nx-lending-filter-line"><small>PROTOCOL</small>{[["all","All Protocols"],...PROTOCOLS.map(p=>[p.id,p.name])].map(([id,label])=><button type="button" key={id} className={protocolFilter===id?"active":""} onClick={()=>{setProtocolFilter(id);setView("finder");}}>{label}</button>)}</div>
        <div className="nx-lending-filter-line"><small>CATEGORY</small>{[["all","All Categories"],["yield","Yield"],["lending","Lending"],["staking","Staking / Liquidity"]].map(([id,label])=><button type="button" key={id} className={categoryFilter===id?"active":""} onClick={()=>{setCategoryFilter(id);setView("finder");}}>{label}</button>)}</div>
      </div>
      <div className="nx-lending-table-wrap">
        <div className="nx-lending-table-head"><span>ASSET ↕</span><span>PRICE</span><span>BEST SUPPLY APY</span><span>BEST BORROW APR</span><span>TOTAL LIQUIDITY</span><span>LISTED ON</span><span>YOUR BALANCE</span><span>ACTION</span></div>
        {loading?<div className="nx-lending-table-empty"><span className="nx-lending-spinner"/><strong>Searching assets</strong><p>Looking up {query.trim().toUpperCase()}…</p></div>:
          loadError?<div className="nx-lending-table-empty"><strong>Assets are temporarily unavailable.</strong><button type="button" onClick={refresh}>Try again</button></div>:
          visibleAssets.length?visibleAssets.map(asset=><div className="nx-lending-table-row" key={assetKey(asset)}>
            <button type="button" className="nx-lending-asset-cell" onClick={()=>openAsset(asset)}><span className="nx-lending-asset-mark">{asset.asset_code.slice(0,1)}</span><span><strong>{asset.asset_code}</strong><small>{short(asset.asset_issuer)}</small></span></button>
            <strong className="nx-lending-unavailable" data-label="Price">—</strong><strong className="nx-lending-unavailable" data-label="Best supply APY">—</strong><strong className="nx-lending-unavailable" data-label="Best borrow APR">—</strong><strong className="nx-lending-unavailable" data-label="Total liquidity">—</strong>
            <span className="nx-lending-listed" data-label="Protocol listing">—</span><span className="nx-lending-balance" data-label="Your balance">{address?(assetBalance(asset)??"—"):"—"}</span>
            <button type="button" className="nx-lending-compare-button" onClick={()=>openAsset(asset)}>Details <ChevronRight size={12}/></button>
          </div>):<div className="nx-lending-table-empty"><span><Search size={20}/></span><strong>{searched?"No assets found":"Search Stellar assets"}</strong><p>{searched?"No assets match “"+query+"”. Try a different asset code.":"Search an asset code such as USDC."}</p></div>}
      </div>
    </section>}

    {view==="vaults"&&<section className="nx-lending-protocol-workspace">
      <WorkspaceHeading title="Explore yield infrastructure" description="Browse DeFindex vaults and their reported yields." eyebrow="STELLAR VAULTS & STAKING" count={defindexLoading?"Loading…":defindexSnapshot&&!defindexSnapshot.errors.vaults?String(defindexSnapshot.totalVaults)+" vaults":"—"}/>
      <section className="nx-lending-defindex-live">
        <div className="nx-lending-defindex-head"><div><div className="nx-panel-kicker">DEFINDEX</div><h3>DeFindex vaults</h3></div><button type="button" onClick={()=>setDefindexRetry(value=>value+1)} disabled={defindexLoading}><RefreshCw size={13}/> Refresh</button></div>
        {defindexLoading?<div className="nx-lending-blend-state"><span className="nx-lending-spinner"/> Loading vaults…</div>:defindexSnapshot?.errors.vaults?<div className="nx-lending-blend-state error"><strong>Vaults are temporarily unavailable.</strong></div>:defindexSnapshot?.vaults.length?<div className="nx-lending-defindex-grid">{defindexSnapshot.vaults.map((vault,index)=><article key={vault.address||String(index)}>
          <div className="nx-lending-defindex-card-top"><span><Layers3 size={16}/></span><small>DEFINDEX VAULT</small></div>
          <h4>{vault.name||vault.symbol||"DeFindex vault"}</h4>
          <code>{vault.address||"—"}</code>
          <div className="nx-lending-defindex-stats"><div><small>REPORTED APY</small><strong>{typeof vault.apy==="number"&&Number.isFinite(vault.apy)?vault.apy.toFixed(2)+"%":"—"}</strong></div><div><small>UNDERLYING ASSETS</small><strong>{vault.totalManagedFunds?.length??vault.assets?.length??"—"}</strong></div></div>
          <div className="nx-lending-defindex-assets">{vault.totalManagedFunds?.length?vault.totalManagedFunds.map((fund,i)=><span key={fund.asset||String(i)}>{fund.asset?short(fund.asset):"—"} · raw units {fund.total_amount??"—"}</span>):<span>—</span>}</div>
          <button type="button" className="nx-lending-defindex-inspect" onClick={()=>setInspectedVaultAddress(vault.address||null)} disabled={!vault.address}>{inspectedVaultAddress===vault.address?"Selected":"View details"} <ArrowUpRight size={12}/></button>
          <button type="button" className="nx-lending-defindex-compare" onClick={()=>{const address=vault.address;if(!address)return;setComparedVaultAddresses(current=>current.includes(address)?current.filter(item=>item!==address):current.length<2?[...current,address]:[current[1],address]);}} disabled={!vault.address}>{vault.address&&comparedVaultAddresses.includes(vault.address)?"Remove from comparison":comparedVaultAddresses.length>=2&&!!vault.address&&!comparedVaultAddresses.includes(vault.address)?"Replace oldest comparison":"Add to comparison"} <ArrowLeftRight size={11}/></button>
        </article>)}</div>:<div className="nx-lending-blend-state"><strong>No vaults available</strong></div>}
        {comparedVaults.length>0&&<section className="nx-lending-vault-compare">
          <div className="nx-lending-vault-compare-head"><div><div className="nx-panel-kicker">SIDE-BY-SIDE REVIEW</div><strong>Compare selected vaults</strong><small>{comparedVaults.length}/2 selected</small></div><button type="button" onClick={()=>setComparedVaultAddresses([])}>Clear comparison <X size={11}/></button></div>
          <div className="nx-lending-vault-compare-grid">
            {comparedVaults.map(vault=><article key={vault.address}>
              <div><strong>{vault.name||vault.symbol||"DeFindex vault"}</strong><small>{vault.symbol||"—"}</small></div>
              <code>{vault.address?short(vault.address):"—"}</code>
              <dl>
                <div><dt>Reported APY</dt><dd>{typeof vault.apy==="number"&&Number.isFinite(vault.apy)?vault.apy.toFixed(2)+"%":"Not reported"}</dd></div>
                <div><dt>Underlying asset records</dt><dd>{vault.totalManagedFunds?.length??vault.assets?.length??"Not reported"}</dd></div>
                <div><dt>Managed-fund raw entries</dt><dd>{vault.totalManagedFunds?.length??"Not reported"}</dd></div>
              </dl>
              <div className="nx-lending-vault-compare-assets"><strong>Reported underlying records</strong>{vault.totalManagedFunds?.length?vault.totalManagedFunds.map((fund,index)=><span key={fund.asset||String(index)}>{fund.asset?short(fund.asset):"—"} · raw amount {fund.total_amount??"—"}</span>):vault.assets?.length?vault.assets.map((asset,index)=><span key={asset.address||String(index)}>{asset.symbol||"Asset"} · {asset.address?short(asset.address):"—"}</span>):<span>—</span>}</div>
              <button type="button" onClick={()=>setInspectedVaultAddress(vault.address||null)} disabled={!vault.address}>View details <ArrowUpRight size={11}/></button>
            </article>)}
          </div>
        </section>}
        {inspectedVaultAddress&&<section className="nx-lending-vault-inspection">
          <div className="nx-lending-vault-inspection-head"><div><div className="nx-panel-kicker">VAULT DETAILS</div><strong>Vault overview</strong><a href={explorerContract(inspectedVaultAddress)} target="_blank" rel="noreferrer"><code>{short(inspectedVaultAddress)}</code></a></div><button type="button" onClick={()=>setInspectedVaultAddress(null)}>Close <X size={12}/></button></div>
          <DefindexActions key={inspectedVaultAddress} vault={inspectedVaultAddress}/>
          {vaultInspectionLoading?<div className="nx-lending-blend-state"><span className="nx-lending-spinner"/> Loading vault details…</div>:vaultInspection?.error?<div className="nx-lending-blend-state"><strong>Vault details are temporarily unavailable.</strong></div>:vaultInspection?.metadata?<div className="nx-lending-vault-inspection-body">
            <div className="nx-lending-vault-meta-grid"><div><small>VAULT NAME</small><strong>{vaultInspection.metadata.name||"—"}</strong></div><div><small>SHARE SYMBOL</small><strong>{vaultInspection.metadata.symbol||"—"}</strong></div><div><small>REPORTED APY</small><strong>{typeof vaultInspection.metadata.apy==="number"?vaultInspection.metadata.apy.toFixed(2)+"%":"—"}</strong></div><div><small>VAULT FEE</small><strong>{typeof vaultInspection.metadata.feesBps?.vaultFee==="number"?(vaultInspection.metadata.feesBps.vaultFee/100).toFixed(2)+"%":"—"}</strong></div></div>
            <div><strong>Underlying assets and strategies</strong>{vaultInspection.metadata.assets?.length?vaultInspection.metadata.assets.map(asset=><div className="nx-lending-vault-meta-asset" key={asset.address||asset.symbol}><span>{asset.symbol||asset.name||"Asset"}</span><code>{asset.address?short(asset.address):"—"}</code><small>{asset.strategies?.length?asset.strategies.map(strategy=>(strategy.name||"Strategy")+" · "+(strategy.paused===true?"Paused":strategy.paused===false?"Active":"—")).join(" / "):"—"}</small></div>):<p>—</p>}</div>
            <div><strong>Vault roles</strong><div className="nx-lending-vault-meta-roles">{(["manager","emergencyManager","rebalanceManager","feeReceiver"] as const).map(role=><span key={role}>{role}<code>{vaultInspection.metadata?.roles?.[role]?short(vaultInspection.metadata.roles[role]!):"—"}</code></span>)}</div></div>
            <small>Source: DeFindex{vaultInspection.retrievedAt?" · "+new Date(vaultInspection.retrievedAt).toLocaleString():""}</small>
          </div>:null}
          <div className="nx-lending-chain-verify">
            <div className="nx-lending-chain-verify-head"><div><strong>On-chain verification</strong><small>Read directly from the vault contract</small></div><span className={vaultChainVerification?.contractExists&&vaultChainVerification.checks?.requiredVaultMethods?"verified":vaultChainVerification&&!vaultChainVerification.contractExists?"failed":"pending"}>{vaultChainLoading?"CHECKING":vaultChainVerification?.contractExists&&vaultChainVerification.checks?.requiredVaultMethods?"CONTRACT VERIFIED":vaultChainVerification?.error?"UNAVAILABLE":vaultChainVerification&&!vaultChainVerification.contractExists?"NOT VERIFIED":"PENDING"}</span></div>
            {vaultChainLoading?<div className="nx-lending-blend-state"><span className="nx-lending-spinner"/> Verifying contract…</div>:vaultChainVerification?.error?<div className="nx-lending-blend-state error"><strong>Verification is temporarily unavailable.</strong></div>:vaultChainVerification?.contractExists?<div className="nx-lending-chain-verify-body">
              <div className="nx-lending-chain-checks">{Object.entries(vaultChainVerification.checks||{}).map(([key,passed])=><span key={key}><i className={passed?"pass":"fail"}/>{key.replace(/([A-Z])/g," $1").replace(/^./,letter=>letter.toUpperCase())}</span>)}</div>
              <div className="nx-lending-chain-method-groups">
                <strong>Contract capabilities</strong>
                {([
                  ["Share accounting",vaultChainVerification.methodGroups?.shareAccounting??[]],
                  ["Deposit interface",vaultChainVerification.methodGroups?.deposits??[]],
                  ["Withdrawal interface",vaultChainVerification.methodGroups?.withdrawals??[]],
                  ["Permission / role interface",vaultChainVerification.methodGroups?.permissions??[]]
                ] as [string,string[]][]).map(([label,methods])=><div key={label}><span>{label}</span><b>{methods.length?methods.join(", "):"—"}</b></div>)}
              </div>
              {vaultChainVerification.missingRequiredMethods?.length?<p>Missing methods: {vaultChainVerification.missingRequiredMethods.join(", ")}</p>:null}
              <div className="nx-lending-chain-asset-list"><strong>Underlying assets</strong>{vaultChainVerification.onChain?.assets.map((asset,index)=><div className="nx-lending-chain-asset" key={asset.address||String(index)}><div><span>{asset.symbol||asset.name||"Unknown asset"}</span><code>{asset.address?short(asset.address):"—"}</code></div><strong>{asset.decimalsVerified?asset.decimals+" decimals":"—"}</strong>{asset.strategies.map((strategy,i)=><small key={strategy.address||String(i)}>{strategy.name||"Strategy"} · {strategy.paused===true?"Paused":strategy.paused===false?"Active":"—"}</small>)}</div>)}</div>
              <div className="nx-lending-chain-asset-list"><strong>Managed funds (raw units)</strong>{vaultChainVerification.onChain?.managedFunds.map((fund,index)=><div className="nx-lending-chain-fund" key={fund.asset||String(index)}><code>{fund.asset?short(fund.asset):"—"}</code><span>Idle: {String(fund.idleAmount??"—")}</span><span>Invested: {String(fund.investedAmount??"—")}</span><strong>Total: {String(fund.totalAmount??"—")}</strong></div>)}</div>
              <section className="nx-lending-chain-accounting">
                <strong>Share accounting</strong>
                {(vaultChainVerification.onChain?.shareAccounting??[]).map(item=><div key={item.method}><span>{item.method}</span><b>{!item.available?"—":item.error?"Unavailable":typeof item.value==="object"?JSON.stringify(item.value):String(item.value??"—")}</b></div>)}
              </section>
              <section className="nx-lending-chain-fees">
                <strong>Vault fees</strong>
                {vaultChainVerification.onChain?.fees===null||vaultChainVerification.onChain?.fees===undefined?<p>—</p>:<pre>{JSON.stringify(vaultChainVerification.onChain.fees,null,2)}</pre>}
              </section>
              {(vaultChainVerification.onChain?.reconciliation?.length??0)>0&&<section className="nx-lending-chain-reconciliation">
                <strong>Managed-fund reconciliation</strong>
                {vaultChainVerification.onChain!.reconciliation.map((item,index)=><article key={item.asset||String(index)}>
                  <div className="nx-lending-chain-reconciliation-head"><b>{item.asset?short(item.asset):"—"}</b><span className={item.allocationStatus==="matches"&&item.totalStatus==="matches"?"match":item.allocationStatus==="mismatch"||item.totalStatus==="mismatch"?"mismatch":"unknown"}>{item.allocationStatus==="mismatch"||item.totalStatus==="mismatch"?"Discrepancy":item.allocationStatus==="matches"&&item.totalStatus==="matches"?"Matches":"Incomplete"}</span></div>
                  <div className="nx-lending-chain-reconciliation-grid">
                    <span>Idle raw units <b>{item.idleAmount??"—"}</b></span><span>Invested raw units <b>{item.investedAmount??"—"}</b></span>
                    <span>Reported total raw units <b>{item.totalAmount??"—"}</b></span><span>Strategy allocation sum <b>{item.allocationSum??"—"}</b></span>
                    <span>Allocation − invested <b>{item.allocationVsInvestedDelta??"—"}</b></span><span>Total − (idle + invested) <b>{item.totalVsIdlePlusInvestedDelta??"—"}</b></span>
                  </div>
                  <small>{item.allocationCount} strategy allocation(s) · raw units</small>
                </article>)}
              </section>}
              {Object.entries(vaultChainVerification.onChain?.errors||{}).filter(([,error])=>Boolean(error)).length>0&&<div className="nx-lending-blend-state"><strong>Some contract values are temporarily unavailable.</strong></div>}
              <small>Ledger {vaultChainVerification.ledger??"—"} · {new Date(vaultChainVerification.retrievedAt).toLocaleString()}</small>
            </div>:<div className="nx-lending-blend-state">Verification pending.</div>}
          </div>
        </section>}
        {defindexSnapshot?.errors.strategies&&<div className="nx-lending-blend-state"><strong>Strategy data is temporarily unavailable.</strong></div>}
        <small className="nx-lending-blend-source">Source: DeFindex · Updated {defindexSnapshot?new Date(defindexSnapshot.retrievedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—"} · {defindexSnapshot&&!defindexSnapshot.errors.strategies?defindexSnapshot.strategies.length:"—"} strategies</small>
      </section>
      <div className="nx-lending-protocol-grid">{PROTOCOLS.filter(p=>p.type!=="lending"&&p.id!=="defindex").map(protocol=><ProtocolCard key={protocol.id} protocol={protocol} onSelect={()=>openProtocol(protocol)}/>)}</div>
    </section>}

    {view==="finder"&&<section className="nx-lending-protocol-workspace">
      <WorkspaceHeading title="Find and filter opportunities" description="Filter Stellar protocols by type and category." eyebrow="MULTI-PROTOCOL YIELD SCANNER" count={filteredProtocols.length+" protocols"}/>
      <div className="nx-lending-finder-controls"><label><Search size={14}/><input placeholder="Search asset or protocol…" value={query} onChange={event=>setQuery(event.target.value)}/></label><select value={protocolFilter} onChange={event=>setProtocolFilter(event.target.value)}><option value="all">All protocols</option>{PROTOCOLS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><select value={categoryFilter} onChange={event=>setCategoryFilter(event.target.value)}><option value="all">All categories</option><option value="yield">Yield</option><option value="lending">Lending</option><option value="staking">Staking / liquidity</option></select></div>
      <div className="nx-lending-finder-summary"><div><small>LENDING POOLS</small><strong>{blendSnapshot?blendSnapshot.pools.length:"—"}</strong></div><div><small>TOP SUPPLY APY</small><strong>{topSupplyApy}</strong></div><div><small>VAULTS</small><strong>{defindexSnapshot&&!defindexSnapshot.errors.vaults?defindexSnapshot.totalVaults:"—"}</strong></div><div><small>PROTOCOLS</small><strong>{filteredProtocols.length}</strong></div></div>
      <div className="nx-lending-protocol-grid">{filteredProtocols.map(protocol=><ProtocolCard key={protocol.id} protocol={protocol} onSelect={()=>openProtocol(protocol)}/>)}</div>
    </section>}

    {view==="compare"&&<section className="nx-lending-compare-workspace">
      <section className="nx-lending-blend-live">
        <div className="nx-lending-blend-head"><div><div className="nx-panel-kicker">BLEND V2</div><h2>Lending markets</h2><p>Live supply and borrow rates from Blend pools.</p></div><button type="button" onClick={()=>setBlendRetry(value=>value+1)} disabled={blendLoading}><RefreshCw size={13}/> Refresh</button></div>
        {blendLoading?<div className="nx-lending-blend-state"><span className="nx-lending-spinner"/> Loading markets…</div>:blendError?<div className="nx-lending-blend-state error" role="alert"><strong>Markets are temporarily unavailable.</strong><button type="button" onClick={()=>setBlendRetry(value=>value+1)}>Retry</button></div>:blendSnapshot&&blendSnapshot.pools.length?blendSnapshot.pools.map(pool=><article className="nx-lending-blend-pool" key={pool.id}>
          <div className="nx-lending-blend-pool-head"><div><strong>{pool.name||pool.label}</strong><small>{pool.version} · Ledger {pool.latestLedger}</small></div><span><a href={explorerContract(pool.id)} target="_blank" rel="noreferrer">{short(pool.id)} <ExternalLink size={11}/></a></span></div>
          <div className="nx-lending-blend-reserves"><div className="nx-lending-blend-reserve-head"><span>RESERVE</span><span>SUPPLY APY</span><span>BORROW APR</span><span>UTILIZATION</span><span>SUPPLIED</span><span>BORROWED</span></div>
            {pool.reserves.map(reserve=><div className="nx-lending-blend-reserve" key={reserve.assetContract}><div><strong>{reserve.symbol||"Unknown token"}</strong><small>{short(reserve.assetContract)}</small><small>{reserve.enabled?"Enabled":"Disabled"}</small></div><b>{reserve.estimatedSupplyApy===null?"—":(reserve.estimatedSupplyApy*100).toFixed(2)+"%"}</b><b>{reserve.borrowApr===null?"—":(reserve.borrowApr*100).toFixed(2)+"%"}</b><b>{reserve.utilization===null?"—":(reserve.utilization*100).toFixed(2)+"%"}</b><span>{reserve.supplied===null?"—":reserve.supplied.toLocaleString("en-US",{maximumFractionDigits:4})}</span><span>{reserve.borrowed===null?"—":reserve.borrowed.toLocaleString("en-US",{maximumFractionDigits:4})}</span><div className="nx-lending-blend-reserve-risk"><span>Collateral factor <b>{reserve.collateralFactor===null?"—":(reserve.collateralFactor*100).toFixed(2)+"%"}</b></span><span>Liability factor <b>{reserve.liabilityFactor===null?"—":reserve.liabilityFactor.toFixed(4)}</b></span><span>Oracle price <b>{reserve.oraclePrice===null?"—":reserve.oraclePrice.toLocaleString("en-US",{maximumFractionDigits:8})}</b></span><span>Supplied value <b>{reserve.oracleValueSupplied===null?"—":reserve.oracleValueSupplied.toLocaleString("en-US",{maximumFractionDigits:4})}</b></span><span>Borrowed value <b>{reserve.oracleValueBorrowed===null?"—":reserve.oracleValueBorrowed.toLocaleString("en-US",{maximumFractionDigits:4})}</b></span><button type="button" className="nx-lending-reserve-inspect" onClick={()=>setSelectedBlendReserve({pool,reserve})}>Details <ChevronRight size={11}/></button></div></div>)}
          </div>
          <div className="nx-lending-blend-pool-foot"><span>Oracle <b>{short(pool.oracle)}</b></span><span>Prices <b>{pool.oracleReadAvailable?"Live":"Unavailable"}</b></span><span>Backstop <b>{short(pool.backstop)}</b></span></div>
        </article>):<div className="nx-lending-blend-state"><strong>No markets available</strong></div>}
        {blendSnapshot?.unavailable.length? <div className="nx-lending-blend-state"><strong>Some pools are temporarily unavailable</strong><p>{blendSnapshot.unavailable.map(item=>item.label).join(", ")}</p></div>:null}
        <small className="nx-lending-blend-source">Source: Blend · Ledger {blendSnapshot?.ledger??"—"} · Updated {blendSnapshot?new Date(blendSnapshot.retrievedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—"}</small>
      </section>
      <WorkspaceHeading title="Compare Stellar protocols" description="How Stellar lending, vault and liquidity protocols compare." eyebrow="PROTOCOL COMPARISON" count="3 protocols"/>
      <div className="nx-lending-compare-grid">{PROTOCOLS.map(protocol=>{
        const isBlend=protocol.id==="blend";
        const isDefindex=protocol.id==="defindex";
        const enabledBlendReserves=blendSnapshot?.pools.reduce((total,pool)=>total+pool.reserves.filter(reserve=>reserve.enabled).length,0)??0;
        const blendStatus=blendLoading?"Loading":blendError?"Unavailable":blendSnapshot?.pools.length?"Live":"No markets";
        const defindexStatus=defindexLoading?"Loading":defindexSnapshot&&!defindexSnapshot.errors.vaults?"Live":"Unavailable";
        const blendOracleReserves=blendSnapshot?.pools.reduce((total,pool)=>total+pool.reserves.filter(reserve=>reserve.oraclePrice!==null).length,0)??0;
        const blendTotalReserves=blendSnapshot?.pools.reduce((total,pool)=>total+pool.reserves.length,0)??0;
        const facts=isBlend?[
          ["Pools",blendSnapshot?String(blendSnapshot.pools.length):"—"],
          ["Enabled reserves",blendSnapshot?String(enabledBlendReserves):"—"],
          ["Priced reserves",blendSnapshot?blendOracleReserves+"/"+blendTotalReserves:"—"],
          ["Ledger",blendSnapshot?String(blendSnapshot.ledger):"—"],
          ["Rates","Variable, estimated"]
        ]:isDefindex?[
          ["Vaults",defindexSnapshot&&!defindexSnapshot.errors.vaults?String(defindexSnapshot.totalVaults):"—"],
          ["Strategies",defindexSnapshot&&!defindexSnapshot.errors.strategies?String(defindexSnapshot.strategies.length):"—"],
          ["Yield","Reported per vault"],
          ["Deposits / withdrawals","Not available"]
        ]:[
          ["Type","AMM / routing"],
          ["Liquidity","—"],
          ["Swaps","Not available"]
        ];
        return <article key={protocol.id} className="nx-lending-compare-card">
          <div className="nx-lending-compare-card-top"><div className="nx-lending-protocol-logo"><Landmark size={18}/></div><span className={"nx-lending-compare-status "+((isBlend&&blendSnapshot?.pools.length)||(isDefindex&&defindexSnapshot)?"available":"")}>{isBlend?blendStatus:isDefindex?defindexStatus:"Not available"}</span></div>
          <small>{protocol.category}</small><h3>{protocol.name}</h3><p>{protocol.description}</p>
          <div className="nx-lending-compare-facts">{facts.map(([label,value])=><div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
          {(isBlend&&blendSnapshot)&&<small className="nx-lending-compare-source">Updated {new Date(blendSnapshot.retrievedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</small>}
          {(isDefindex&&defindexSnapshot)&&<small className="nx-lending-compare-source">Updated {new Date(defindexSnapshot.retrievedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</small>}
          <button type="button" onClick={()=>openProtocol(protocol)}>Details <ArrowRight size={13}/></button>
        </article>;
      })}</div>
    </section>}

    {selectedAsset&&<div className="nx-lending-drawer-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedAsset(null);}}>
      <aside className="nx-lending-drawer" role="dialog" aria-modal="true" tabIndex={-1} aria-label={selectedAsset.asset_code+" details"}>
        <DrawerHead eyebrow="ASSET" title={selectedAsset.asset_code} onClose={()=>setSelectedAsset(null)}/>
        <div className="nx-lending-drawer-asset"><span>{selectedAsset.asset_code.slice(0,1)}</span><div><strong>{selectedAsset.asset_code}</strong><small>{selectedAsset.asset_issuer}</small></div></div>
        <div className="nx-lending-drawer-stats"><div><small>Price</small><strong>—</strong></div><div><small>Supply APY</small><strong>—</strong></div><div><small>Borrow APR</small><strong>—</strong></div><div><small>Liquidity</small><strong>—</strong></div></div>
        <Link href={"https://stellar.expert/explorer/public/asset/"+selectedAsset.asset_code+"-"+selectedAsset.asset_issuer} target="_blank">View on Stellar Expert <ExternalLink size={13}/></Link>
      </aside>
    </div>}

    {selectedBlendReserve&&<div className="nx-lending-drawer-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedBlendReserve(null);}}>
      <aside className="nx-lending-drawer" role="dialog" aria-modal="true" tabIndex={-1} aria-label={(selectedBlendReserve.reserve.symbol||"Blend reserve")+" details"}>
        <DrawerHead eyebrow="BLEND RESERVE" title={selectedBlendReserve.reserve.symbol||"Unknown reserve"} onClose={()=>setSelectedBlendReserve(null)}/>
        <div className="nx-lending-drawer-asset"><span>{(selectedBlendReserve.reserve.symbol||"?").slice(0,1)}</span><div><strong>{selectedBlendReserve.reserve.name||selectedBlendReserve.reserve.symbol||"Unknown asset"}</strong><small>{selectedBlendReserve.pool.name||selectedBlendReserve.pool.label} · {selectedBlendReserve.pool.version}</small></div></div>
        <h3>Market parameters</h3>
        <div className="nx-lending-drawer-stats">
          <div><small>Supply APY estimate</small><strong>{selectedBlendReserve.reserve.estimatedSupplyApy===null?"—":(selectedBlendReserve.reserve.estimatedSupplyApy*100).toFixed(3)+"%"}</strong></div>
          <div><small>Borrow APR</small><strong>{selectedBlendReserve.reserve.borrowApr===null?"—":(selectedBlendReserve.reserve.borrowApr*100).toFixed(3)+"%"}</strong></div>
          <div><small>Utilization</small><strong>{selectedBlendReserve.reserve.utilization===null?"—":(selectedBlendReserve.reserve.utilization*100).toFixed(2)+"%"}</strong></div>
          <div><small>Reserve status</small><strong>{selectedBlendReserve.reserve.enabled?"Enabled":"Disabled"}</strong></div>
          <div><small>Supplied</small><strong>{selectedBlendReserve.reserve.supplied===null?"—":selectedBlendReserve.reserve.supplied.toLocaleString("en-US",{maximumFractionDigits:6})}</strong></div>
          <div><small>Borrowed</small><strong>{selectedBlendReserve.reserve.borrowed===null?"—":selectedBlendReserve.reserve.borrowed.toLocaleString("en-US",{maximumFractionDigits:6})}</strong></div>
          <div><small>Collateral factor</small><strong>{selectedBlendReserve.reserve.collateralFactor===null?"—":(selectedBlendReserve.reserve.collateralFactor*100).toFixed(2)+"%"}</strong></div>
          <div><small>Liability factor</small><strong>{selectedBlendReserve.reserve.liabilityFactor===null?"—":selectedBlendReserve.reserve.liabilityFactor.toFixed(5)}</strong></div>
        </div>
        <h3>Price and asset</h3>
        <div className="nx-lending-protocol-meta">
          <span>ORACLE PRICE <b>{selectedBlendReserve.reserve.oraclePrice===null?"—":selectedBlendReserve.reserve.oraclePrice.toLocaleString("en-US",{maximumFractionDigits:10})}</b></span>
          <span>PRICE LEDGER <b>{selectedBlendReserve.reserve.oracleLedger??"—"}</b></span>
          <span>RESERVE LEDGER <b>{selectedBlendReserve.reserve.latestLedger}</b></span>
          <span>DECIMALS <b>{selectedBlendReserve.reserve.decimals}</b></span>
        </div>
        <div className="nx-lending-review-next"><strong>Contracts</strong><p>{selectedBlendReserve.reserve.assetContract}</p><small>Pool <a href={explorerContract(selectedBlendReserve.pool.id)} target="_blank" rel="noreferrer">{short(selectedBlendReserve.pool.id)}</a> · Oracle {short(selectedBlendReserve.pool.oracle)}</small></div>

        <section className="nx-blend-preflight">
          <div className="nx-blend-preflight-heading"><strong>Supply, borrow &amp; repay</strong></div>
          <label>Action
            <select value={blendPreflightAction} onChange={event=>{setBlendPreflightAction(event.target.value as "supply"|"withdraw"|"borrow"|"repay");setBlendPreflightResult(null);}}>
              <option value="supply">Supply</option><option value="withdraw">Withdraw</option><option value="borrow">Borrow</option><option value="repay">Repay</option>
            </select>
          </label>
          <label>Amount
            <input value={blendPreflightAmount} onChange={event=>{setBlendPreflightAmount(event.target.value);setBlendPreflightResult(null);}} inputMode="decimal" placeholder="0.00"/>
          </label>
          <button type="button" onClick={()=>void runBlendPreflight()} disabled={!address||blendPreflightLoading||!blendPreflightAmount.trim()}>
            {blendPreflightLoading?"Checking…":"Check eligibility"}
          </button>
          <button type="button" className="nx-lending-action-primary" disabled={!blendPreflightAmount.trim()||!selectedBlendReserve} onClick={()=>setLendAction(true)}>{blendPreflightAction.charAt(0).toUpperCase()+blendPreflightAction.slice(1)}</button>
          {lendAction&&selectedBlendReserve&&<LendFlow poolId={selectedBlendReserve.pool.id} asset={selectedBlendReserve.reserve.assetContract} decimals={selectedBlendReserve.reserve.decimals} symbol={selectedBlendReserve.reserve.symbol??"tokens"} action={blendPreflightAction} amount={blendPreflightAmount.trim()} onClose={changed=>{setLendAction(false);if(changed){setBlendRetry(v=>v+1);setBlendPositionsRetry(v=>v+1);}}}/>}
          {!address&&<small>Set up a wallet to check this action.</small>}
          {blendPreflightError&&<p role="alert">Couldn&apos;t complete the check.</p>}
          {blendPreflightResult&&<div className="nx-blend-preflight-results">
            <b>Pool {blendPreflightResult.poolStatusLabel??"—"} · Ledger {blendPreflightResult.latestLedger}</b>
            <div className="nx-blend-preflight-balances">
              <span>Wallet token balance <b>{blendPreflightResult.walletBalanceRaw??"—"} raw units</b></span>
              <span>Non-collateral supply <b>{blendPreflightResult.userSupplyRaw} raw units</b></span>
              <span>Collateral supplied <b>{blendPreflightResult.userCollateralRaw} raw units</b></span>
              <span>Outstanding liability <b>{blendPreflightResult.userLiabilityRaw} raw units</b></span>
              <span>Pool available liquidity <b>{blendPreflightResult.availableLiquidityRaw} raw units</b></span>
              {blendPreflightResult.borrowHeadroomOracleUnits!==null&&<span>Borrow headroom <b>{blendPreflightResult.borrowHeadroomOracleUnits.toFixed(6)}</b></span>}
              {blendPreflightResult.requestedBorrowOracleUnits!==null&&<span>Requested debt <b>{blendPreflightResult.requestedBorrowOracleUnits.toFixed(6)}</b></span>}
            </div>
            {blendPreflightResult.gates.map(gate=><div key={gate.id}><span className={gate.passed?"pass":"blocked"}>{gate.passed?"Pass":"Not met"}</span><span><b>{gate.label}</b></span></div>)}
          </div>}
        </section>
      </aside>
    </div>}

    {selectedProtocol&&<div className="nx-lending-drawer-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedProtocol(null);}}>
      <aside className="nx-lending-drawer" role="dialog" aria-modal="true" tabIndex={-1} aria-label={selectedProtocol.name+" details"}>
        <DrawerHead eyebrow="PROTOCOL" title={selectedProtocol.name} onClose={()=>setSelectedProtocol(null)}/>
        <div className="nx-lending-protocol-logo large"><Landmark size={22}/></div><p>{selectedProtocol.description}</p>
        <div className="nx-lending-protocol-meta"><span>CATEGORY <b>{selectedProtocol.category}</b></span></div>
        {selectedProtocol.id==="blend"&&<section className="nx-lending-protocol-evidence"><strong>Blend markets</strong>{blendLoading?<p>Loading markets…</p>:blendError?<p>Markets are temporarily unavailable.</p>:blendSnapshot?.pools.length?blendSnapshot.pools.map(pool=><div key={pool.id}><span><b>{pool.name||pool.label}</b><small>{pool.version} · Ledger {pool.latestLedger}</small></span><span>{pool.reserves.filter(reserve=>reserve.enabled).length} enabled reserves · {pool.reserves.filter(reserve=>reserve.oraclePrice!==null).length}/{pool.reserves.length} priced</span></div>):<p>No markets available.</p>}</section>}
        {selectedProtocol.id==="defindex"&&<section className="nx-lending-protocol-evidence"><strong>DeFindex vaults</strong>{defindexLoading?<p>Loading vaults…</p>:defindexSnapshot?.vaults.length?defindexSnapshot.vaults.slice(0,8).map((vault,index)=><div key={vault.address||vault.symbol||String(index)}><span><b>{vault.name||vault.symbol||"Unnamed vault"}</b><small>{vault.symbol||"—"}</small></span><code>{vault.address?short(vault.address):"—"}</code></div>):<p>{defindexSnapshot?.errors.vaults?"Vaults are temporarily unavailable.":"No vaults available."}</p>}</section>}
        <a href={selectedProtocol.url} target="_blank" rel="noreferrer">Protocol documentation <ExternalLink size={13}/></a>
      </aside>
    </div>}
  </div>;
}

function Kpi({icon,label,value,note}:{icon:ReactNode;label:string;value:string;note:string}) {
  return <div className="nx-lending-kpi"><span>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></div>;
}
function WorkspaceHeading({title,description,eyebrow,count}:{title:string;description:string;eyebrow:string;count:string}) {
  return <div className="nx-lending-workspace-heading"><div><div className="nx-panel-kicker">{eyebrow}</div><h2>{title}</h2><p>{description}</p></div><span>{count}</span></div>;
}
function ProtocolCard({protocol,onSelect}:{protocol:Protocol;onSelect:()=>void}) {
  return <article className="nx-lending-protocol-card"><div className="nx-lending-protocol-card-head"><span><Landmark size={17}/></span><small>{protocol.category}</small></div><h3>{protocol.name}</h3><p>{protocol.description}</p><button type="button" onClick={onSelect}>Details <ArrowRight size={13}/></button></article>;
}
function DrawerHead({eyebrow,title,onClose}:{eyebrow:string;title:string;onClose:()=>void}) {
  return <div className="nx-lending-drawer-head"><div><div className="nx-panel-kicker">{eyebrow}</div><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={17}/></button></div>;
}
