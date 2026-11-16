import { ensureVerifiedMainnetRpc, verifiedMainnetRpcUrl } from "@/lib/server/soroban";
import { UNAVAILABLE } from "@/lib/server/errors";
import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";
import { Networks, rpc } from "@stellar/stellar-sdk";

export const dynamic = "force-dynamic";
// Soroban reads + simulation can exceed short serverless defaults; hosts that honour this get 30 s.
export const maxDuration = 30;
export const revalidate = 0;

type Network = "testnet" | "mainnet";
type JsonRecord = Record<string, unknown>;

const RPC: Record<Network, { url:string; passphrase:string }> = {
  testnet: { url:"https://soroban-testnet.stellar.org", passphrase:Networks.TESTNET },
  mainnet: { get url() { return verifiedMainnetRpcUrl(); }, passphrase:Networks.PUBLIC }
};

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    if (typeof (value as {toString?:unknown}).toString === "function" && value.constructor?.name === "Address") {
      return String(value);
    }
    return Object.fromEntries(Object.entries(value as JsonRecord).map(([key,item])=>[key,normalize(item)]));
  }
  return value;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item):item is JsonRecord=>Boolean(item)&&typeof item==="object") : [];
}

function textField(value: unknown, keys: string[]): string|null {
  if (!value || typeof value!=="object") return null;
  for (const key of keys) {
    const item=(value as JsonRecord)[key];
    if (typeof item==="string" && item.length>0) return item;
    if (item && typeof item==="object" && typeof (item as {toString?:unknown}).toString==="function") return String(item);
  }
  return null;
}

export async function GET(request: NextRequest) {
  const network=request.nextUrl.searchParams.get("network")?? "mainnet";
  const address=(request.nextUrl.searchParams.get("address")??"").trim();
  if(network!=="testnet"&&network!=="mainnet") return NextResponse.json({error:"Unsupported Stellar network."},{status:400});
  if(!/^C[A-Z2-7]{55}$/.test(address)) return NextResponse.json({error:"Enter a valid contract address."},{status:400});

  if (network !== "mainnet" || !(await ensureVerifiedMainnetRpc())) {
    return NextResponse.json({ error: UNAVAILABLE, status: "soroban_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const config=RPC[network];
  const server=new rpc.Server(config.url);
  let discoveredMethods:string[]=[];
  try {
    const [ledger,methods]=await Promise.all([
      server.getLatestLedger(),
      server.getContractMethods(address,config.passphrase)
    ]);
    discoveredMethods=methods.map(method=>method.name);
    const methodNames=new Set(discoveredMethods);
    const methodGroups={
      shareAccounting:discoveredMethods.filter(name=>["total_supply","get_total_supply","decimals","convert_to_assets","convert_to_shares","preview_deposit","preview_mint","preview_withdraw","preview_redeem"].includes(name)),
      deposits:discoveredMethods.filter(name=>["deposit","mint","max_deposit","max_mint","preview_deposit","preview_mint"].includes(name)),
      withdrawals:discoveredMethods.filter(name=>["withdraw","redeem","max_withdraw","max_redeem","preview_withdraw","preview_redeem"].includes(name)),
      permissions:discoveredMethods.filter(name=>["get_manager","get_emergency_manager","get_rebalance_manager","get_fee_receiver","get_roles","get_access_control"].includes(name))
    };
    const required=["name","symbol","get_assets","fetch_total_managed_funds","get_fees"];
    const missing=required.filter(name=>!methodNames.has(name));
    if(missing.length) {
      return NextResponse.json({
        network,address,source:"Stellar Soroban RPC contract specification",
        ledger:ledger.sequence,retrievedAt:new Date().toISOString(),
        contractExists:true,methods:methods.map(method=>method.name),
        missingRequiredMethods:missing,
        checks:{contractSpec:true,requiredVaultMethods:false},
        error:"This contract is not a recognised vault."
      },{headers:{"Cache-Control":"no-store"}});
    }

    const query=async<T>(method:string):Promise<T>=>{
      const result=await server.queryContract<T>(address,method,{},config.passphrase);
      if(!result.isReadCall) throw new Error("Soroban did not classify "+method+" as a read-only call.");
      return result.result;
    };
    const safeRead=async<T>(method:string):Promise<{value:T|null;error:string|null}>=>{
      try { return {value:await query<T>(method),error:null}; }
      catch(error) { return {value:null,error:safeError(error, "stellar/defindex/verify")}; }
    };
    const optionalShareReads=await Promise.all(["total_supply","get_total_supply","decimals"].map(async method=>{
      if(!methodNames.has(method)) return {method,available:false,value:null,error:null};
      const result=await safeRead<unknown>(method);
      return {method,available:true,value:normalize(result.value),error:result.error};
    }));
    const [nameRead,symbolRead,assetsRead,fundsRead,feesRead,roles]=await Promise.all([
      safeRead<unknown>("name"),
      safeRead<unknown>("symbol"),
      safeRead<unknown>("get_assets"),
      safeRead<unknown>("fetch_total_managed_funds"),
      safeRead<unknown>("get_fees"),
      Promise.all(["get_manager","get_emergency_manager","get_rebalance_manager","get_fee_receiver"].map(async method=>{
        if(!methodNames.has(method)) return {method,available:false,value:null};
        const result=await safeRead<unknown>(method);
        return {method,available:true,value:normalize(result.value),error:result.error??undefined};
      }))
    ]);
    const name=nameRead.value;
    const symbol=symbolRead.value;
    const assetsRaw=assetsRead.value;
    const fundsRaw=fundsRead.value;
    const feesRaw=feesRead.value;

    const assets=records(assetsRaw).map(asset=>({
      address:textField(asset,["address","asset","contract","token"]),
      name:textField(asset,["name"]),
      symbol:textField(asset,["symbol"]),
      strategies:records(asset.strategies).map(strategy=>({
        address:textField(strategy,["address","strategy_address"]),
        name:textField(strategy,["name"]),
        paused:typeof strategy.paused==="boolean"?strategy.paused:null
      }))
    }));
    const managedFunds=records(fundsRaw).map(fund=>({
      asset:textField(fund,["asset","address"]),
      idleAmount:normalize(fund.idle_amount),
      investedAmount:normalize(fund.invested_amount),
      totalAmount:normalize(fund.total_amount),
      strategyAllocations:records(fund.strategy_allocations).map(allocation=>({
        amount:normalize(allocation.amount),
        paused:typeof allocation.paused==="boolean"?allocation.paused:null,
        strategyAddress:textField(allocation,["strategy_address","address"])
      }))
    }));

    const toRawInteger=(value:unknown):bigint|null=>{
      if(typeof value==="bigint") return value;
      if(typeof value==="number"&&Number.isSafeInteger(value)) return BigInt(value);
      if(typeof value==="string"&&/^-?\d+$/.test(value.trim())) {
        try { return BigInt(value.trim()); } catch { return null; }
      }
      return null;
    };
    const reconciliation=managedFunds.map(fund=>{
      const idle=toRawInteger(fund.idleAmount);
      const invested=toRawInteger(fund.investedAmount);
      const total=toRawInteger(fund.totalAmount);
      const allocationValues=fund.strategyAllocations.map(item=>toRawInteger(item.amount));
      const allocationsComplete=allocationValues.every(value=>value!==null);
      const allocationSum=allocationsComplete?allocationValues.reduce<bigint>((sum,value)=>sum+(value??BigInt(0)),BigInt(0)):null;
      const idlePlusInvested=idle!==null&&invested!==null?idle+invested:null;
      return {
        asset:fund.asset,
        rawUnits:true,
        idleAmount:idle?.toString()??null,
        investedAmount:invested?.toString()??null,
        totalAmount:total?.toString()??null,
        allocationCount:fund.strategyAllocations.length,
        allocationSum:allocationSum?.toString()??null,
        idlePlusInvested:idlePlusInvested?.toString()??null,
        allocationVsInvestedDelta:allocationSum!==null&&invested!==null?(allocationSum-invested).toString():null,
        totalVsIdlePlusInvestedDelta:total!==null&&idlePlusInvested!==null?(total-idlePlusInvested).toString():null,
        allocationStatus:allocationSum===null||invested===null?"unverifiable":allocationSum===invested?"matches":"mismatch",
        totalStatus:total===null||idlePlusInvested===null?"unverifiable":total===idlePlusInvested?"matches":"mismatch"
      };
    });

    const assetDecimals=await Promise.all(assets.map(async asset=>{
      if(!asset.address||!/^C[A-Z2-7]{55}$/.test(asset.address)) return {...asset,decimals:null,decimalsVerified:false,decimalsError:"Underlying asset address was not a valid contract address."};
      try {
        const decimals=await server.queryContract<number>(asset.address,"decimals",{},config.passphrase);
        if(!decimals.isReadCall) throw new Error("Soroban did not classify the underlying decimals query as read-only.");
        const parsedDecimals=typeof decimals.result==="number"?decimals.result:Number(decimals.result);
        const decimalsVerified=Number.isInteger(parsedDecimals)&&parsedDecimals>=0&&parsedDecimals<=18;
        return {...asset,decimals:decimalsVerified?parsedDecimals:null,decimalsVerified,decimalsError:decimalsVerified?null:"Underlying decimals response was not a valid integer from 0 to 18."};
      } catch(error) {
        return {...asset,decimals:null,decimalsVerified:false,decimalsError:safeError(error, "stellar/defindex/verify")};
      }
    }));

    return NextResponse.json({
      network,address,source:"Live Stellar Soroban RPC read-only contract calls",
      ledger:ledger.sequence,retrievedAt:new Date().toISOString(),
      contractExists:true,methods:methods.map(method=>method.name),methodGroups,
      checks:{
        shareAccountingMethodsDiscovered:methodGroups.shareAccounting.length>0,
        totalSupplyRead:optionalShareReads.some(item=>item.available&&item.error===null&&(item.method==="total_supply"||item.method==="get_total_supply")),
        vaultShareDecimalsRead:optionalShareReads.some(item=>item.available&&item.error===null&&item.method==="decimals"),
        withdrawalMethodsDiscovered:methodGroups.withdrawals.some(method=>["withdraw","redeem"].includes(method)),
        permissionMethodsDiscovered:methodGroups.permissions.length>0,
        contractSpec:true,
        requiredVaultMethods:true,
        vaultNameRead:nameRead.error===null,
        vaultSymbolRead:symbolRead.error===null,
        underlyingAssetsRead:assetsRead.error===null,
        managedFundsRead:fundsRead.error===null,
        feesRead:feesRead.error===null,
        allUnderlyingDecimalsVerified:assetDecimals.length>0&&assetDecimals.every(asset=>asset.decimalsVerified)
      },
      onChain:{
        name:normalize(name),symbol:normalize(symbol),
        assets:assetDecimals,
        managedFunds,
        reconciliation,
        fees:normalize(feesRaw),
        shareAccounting:optionalShareReads,
        roles,
        errors:{name:nameRead.error,symbol:symbolRead.error,assets:assetsRead.error,managedFunds:fundsRead.error,fees:feesRead.error}
      },
      error:null
    },{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    return NextResponse.json({
      network,address,source:"Stellar Soroban RPC",
      retrievedAt:new Date().toISOString(),
      contractExists:false,
      error:safeError(error, "stellar/defindex/verify")
    },{status:502,headers:{"Cache-Control":"no-store"}});
  }
}
