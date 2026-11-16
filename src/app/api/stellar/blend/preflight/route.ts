import { ensureVerifiedMainnetRpc, verifiedMainnetRpcUrl } from "@/lib/server/soroban";
import { UNAVAILABLE } from "@/lib/server/errors";
import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";
import { Account, Address, Contract, Networks, rpc, scValToNative, TransactionBuilder } from "@stellar/stellar-sdk";
import { PoolMetadata, PoolOracle, PoolV2 } from "@blend-capital/blend-sdk";

export const dynamic = "force-dynamic";
// Soroban reads + simulation can exceed short serverless defaults; hosts that honour this get 30 s.
export const maxDuration = 30;
export const revalidate = 0;

const CONFIG = {
  testnet: {
    rpc: "https://soroban-testnet.stellar.org",
    passphrase: Networks.TESTNET,
    backstops: ["CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA", "CBGSFY6NR5TSCQJH5EGVMCFTHLZBCAO7YPIW426WSD46V3TESPA3U6DI"],
    pools: [{ id: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF", label: "Blend Testnet V2" }]
  },
  mainnet: {
    get rpc() { return verifiedMainnetRpcUrl(); },
    passphrase: Networks.PUBLIC,
    backstops: ["CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7", "CCS4AZ5ORM6VLLPJTJUFRNXWBMHOO3L5WHHRPL2ZMILE35ZDMQFHOQMJ"],
    pools: [
      { id: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD", label: "Fixed V2" },
      { id: "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS", label: "YieldBlox V2" },
      { id: "CBAKAZUEJBAFA2DCGBRS2WKJT3FNIMJBHTFL76AY7XMAVEINQNNIQWAO", label: "Fixed V2.1" }
    ]
  }
} as const;

const ALLOWED_POOL_HASHES = new Set([
  "a41fc53d6753b6c04eb15b021c55052366a4c8e0e21bc72700f461264ec1350e",
  "6a7c67449f6bad0d5f641cfbdf03f430ec718faa85107ecb0b97df93410d1c43"
]);

async function readTokenBalance(network:{rpc:string;passphrase:string},tokenId:string,wallet:string):Promise<bigint>{
  // Match Blend SDK's read-only SEP-41 balance simulation pattern. This does not sign or submit.
  const account=new Account("GANXGJV2RNOFMOSQ2DTI3RKDBAVERXUVFC27KW3RLVQCLB3RYNO3AAI4","123");
  const tx=new TransactionBuilder(account,{fee:"1000",timebounds:{minTime:0,maxTime:0},networkPassphrase:network.passphrase})
    .addOperation(new Contract(tokenId).call("balance",Address.fromString(wallet).toScVal()))
    .build();
  const server=new rpc.Server(network.rpc);
  const simulation=await server.simulateTransaction(tx);
  if(!rpc.Api.isSimulationSuccess(simulation)||!simulation.result)throw new Error("Soroban token balance simulation failed.");
  const value=scValToNative(simulation.result.retval);
  try{return typeof value==="bigint"?value:BigInt(String(value));}
  catch{throw new Error("Token contract returned an invalid balance value.");}
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 }); }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A request object is required." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const network = input.network;
  const action = input.action;
  const poolId = typeof input.poolId === "string" ? input.poolId.trim() : "";
  const asset = typeof input.asset === "string" ? input.asset.trim() : "";
  const wallet = typeof input.wallet === "string" ? input.wallet.trim() : "";
  const amount = typeof input.amount === "string" ? input.amount.trim() : "";

  if (network !== "mainnet") {
    return NextResponse.json({ error: "Unsupported Stellar network." }, { status: 400 });
  }
  if (action !== "supply" && action !== "withdraw" && action !== "borrow" && action !== "repay") {
    return NextResponse.json({ error: "Unsupported Blend action." }, { status: 400 });
  }
  if (!/^C[A-Z2-7]{55}$/.test(poolId) || !/^C[A-Z2-7]{55}$/.test(asset) || !/^G[A-Z2-7]{55}$/.test(wallet)) {
    return NextResponse.json({ error: "A valid pool contract, asset contract and public G-address are required." }, { status: 400 });
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json({ error: "Amount must be a positive decimal string." }, { status: 400 });
  }

  if (network !== "mainnet" || !(await ensureVerifiedMainnetRpc())) {
    return NextResponse.json({ error: UNAVAILABLE, status: "soroban_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const config = CONFIG[network];
  const candidate = config.pools.find(pool => pool.id === poolId);
  if (!candidate) return NextResponse.json({ error: "Pool is not in NEXORA's verified deployment allowlist for this network." }, { status: 403 });

  try {
    const sdkNetwork = { rpc: config.rpc, passphrase: config.passphrase };
    const metadata = await PoolMetadata.load(sdkNetwork, poolId);
    if (!ALLOWED_POOL_HASHES.has(metadata.wasmHash) || !config.backstops.includes(metadata.backstop as never)) {
      return NextResponse.json({ error: "This market could not be verified." }, { status: 409 });
    }
    const pool = await PoolV2.loadWithMetadata(sdkNetwork, poolId, metadata);
    const reserve = Array.from(pool.reserves.values()).find(item => item.assetId === asset);
    if (!reserve) return NextResponse.json({ error: "Asset is not a reserve in the selected verified pool." }, { status: 404 });
    const decimals = reserve.config.decimals;
    const amountParts = amount.split(".");
    const precisionValid = (amountParts[1]?.length ?? 0) <= decimals;
    const amountRaw = precisionValid ? BigInt(amountParts[0]) * (BigInt(10) ** BigInt(decimals)) + BigInt((amountParts[1] ?? "").padEnd(decimals, "0") || "0") : null;
    const positiveRaw = amountRaw !== null && amountRaw > BigInt(0);


    const user = action==="supply" ? null : await pool.loadUser(wallet);
    const position = user?.positions;
    const reserveIndex = reserve.config.index;
    const zero = BigInt(0);
    const supplyRaw = position?.supply.get(reserveIndex) ?? zero;
    const collateralRaw = position?.collateral.get(reserveIndex) ?? zero;
    const liabilityRaw = position?.liabilities.get(reserveIndex) ?? zero;
    const userSupplyRaw = reserve.toAssetFromBToken(supplyRaw);
    const userCollateralRaw = reserve.toAssetFromBToken(collateralRaw);
    const userLiabilityRaw = reserve.toAssetFromDToken(liabilityRaw);
    const availableLiquidityRaw = reserve.totalSupply() > reserve.totalLiabilities()
      ? reserve.totalSupply() - reserve.totalLiabilities()
      : zero;
    const amountFloat = Number(amountRaw ?? zero) / (10 ** reserve.config.decimals);

    const poolStatus = metadata.status;
    const poolStatusLabels:Record<number,string>={0:"Admin Active",1:"Active",2:"Admin On-Ice",3:"On-Ice",4:"Admin Frozen",5:"Frozen",6:"Setup"};
    const poolStatusKnown=Number.isInteger(poolStatus)&&poolStatus>=0&&poolStatus<=6;
    const poolStatusLabel=poolStatusKnown?poolStatusLabels[poolStatus]:"Unknown";
    const reserveEnabled = "enabled" in reserve.config ? Boolean(reserve.config.enabled) : true;
    const reserveActionAllowed=(action==="withdraw"||action==="repay")||reserveEnabled;
    const poolAllowsAction=poolStatusKnown&&poolStatus!==6&&(
      action==="supply"?poolStatus<=3:
      action==="borrow"?poolStatus<=1:
      action==="withdraw"||action==="repay"?poolStatus<=5:false
    );
    const statusDetail=action==="supply"
      ?"Supply is permitted in Admin Active, Active and On-Ice states; Frozen and Setup are blocked."
      :action==="borrow"
      ?"Borrow is permitted only in Admin Active and Active states; On-Ice, Frozen and Setup are blocked."
      :action==="withdraw"
      ?"Withdraw is permitted in all configured states except Setup, subject to position, liquidity and contract constraints."
      :"Repay is permitted in all configured states except Setup, subject to balance and contract constraints.";
    let walletBalanceRaw:bigint|null=null;
    let walletBalanceError:string|null=null;
    if(action==="supply"||action==="repay"){
      try{walletBalanceRaw=await readTokenBalance(sdkNetwork,asset,wallet);}
      catch(error){walletBalanceError=safeError(error, "stellar/blend/preflight");}
    }

    let oracleGatePassed=true;
    let oracleGateDetail="Not required for this action.";
    let borrowCapacityRawValue:number|null=null;
    let requestedBorrowValue:number|null=null;
    if(action==="borrow"&&position){
      const activeReserves=Array.from(pool.reserves.values()).filter(item=>
        (position.collateral.get(item.config.index)??zero)>zero||
        (position.liabilities.get(item.config.index)??zero)>zero
      );
      const priceAssets=Array.from(new Set([...activeReserves.map(item=>item.assetId),asset]));
      const prices=new Map<string,{price:number;ledger:number}>();
      const priceErrors:string[]=[];
      await Promise.all(priceAssets.map(async assetId=>{
        try{
          const oracle=await PoolOracle.load(sdkNetwork,metadata.oracle,[assetId]);
          const price=oracle.getPriceFloat(assetId);
          if(price===undefined||!Number.isFinite(price))throw new Error("No usable oracle price.");
          prices.set(assetId,{price,ledger:oracle.latestLedger});
        }catch(error){priceErrors.push(assetId+": "+(safeError(error, "stellar/blend/preflight")));}
      }));
      let effectiveCollateralValue=0;
      let effectiveLiabilityValue=0;
      for(const item of activeReserves){
        const price=prices.get(item.assetId);
        if(!price)continue;
        effectiveCollateralValue+=item.toEffectiveAssetFromBTokenFloat(position.collateral.get(item.config.index)??zero)*price.price;
        effectiveLiabilityValue+=item.toEffectiveAssetFromDTokenFloat(position.liabilities.get(item.config.index)??zero)*price.price;
        if(price.ledger<item.latestLedger)priceErrors.push(item.assetId+": oracle ledger trails reserve ledger.");
      }
      const targetPrice=prices.get(asset);
      if(targetPrice&&targetPrice.ledger<reserve.latestLedger)priceErrors.push(asset+": borrow-asset oracle ledger trails reserve ledger.");
      if(targetPrice){
        const debtTokens=reserve.toDTokensFromAssetCeil(amountRaw??zero);
        requestedBorrowValue=reserve.toEffectiveAssetFromDTokenFloat(debtTokens)*targetPrice.price;
      }
      borrowCapacityRawValue=effectiveCollateralValue-effectiveLiabilityValue;
      oracleGatePassed=priceErrors.length===0&&targetPrice!==undefined&&requestedBorrowValue!==null;
      oracleGateDetail=oracleGatePassed
        ?"Required collateral, liability and borrow-asset oracle prices were read; each oracle ledger is at least as recent as its reserve ledger. Current effective borrow headroom: "+borrowCapacityRawValue.toFixed(6)+" oracle units; requested incremental effective liability: "+requestedBorrowValue!.toFixed(6)+"."
        :"Borrow risk check blocked: "+(priceErrors.join(" ")||"one or more required oracle prices are unavailable.");
    }

    let fundsPositionPassed=false;
    let fundsPositionDetail="";
    if(action==="supply"||action==="repay"){
      fundsPositionPassed=walletBalanceRaw!==null&&amountRaw!==null&&walletBalanceRaw>=amountRaw;
      fundsPositionDetail=walletBalanceError??(walletBalanceRaw===null?"Wallet token balance unavailable.":"Wallet token balance "+(Number(walletBalanceRaw)/10**decimals).toLocaleString("en-US",{maximumFractionDigits:decimals})+" "+(walletBalanceRaw>=amountRaw!?"covers":"does not cover")+" the requested amount.");
      if(action==="repay"&&userLiabilityRaw<amountRaw!){
        fundsPositionPassed=false;
        fundsPositionDetail+=" Outstanding Blend liability is "+(Number(userLiabilityRaw)/10**decimals).toLocaleString("en-US",{maximumFractionDigits:decimals})+"; requested repayment exceeds it.";
      }
    }else if(action==="withdraw"){
      // Blend RequestType.Withdraw consumes non-collateralized supply only.
      // Collateral has a distinct WithdrawCollateral request and requires a health-factor simulation.
      const positionCovers=amountRaw!==null&&userSupplyRaw>=amountRaw;
      const liquidityCovers=amountRaw!==null&&availableLiquidityRaw>=amountRaw;
      fundsPositionPassed=positionCovers&&liquidityCovers;
      fundsPositionDetail="Non-collateralized supply available to withdraw: "+(Number(userSupplyRaw)/10**decimals).toLocaleString("en-US",{maximumFractionDigits:decimals})+"; collateral is excluded until a separate health-factor-checked collateral-withdraw flow exists. Pool available liquidity: "+(Number(availableLiquidityRaw)/10**decimals).toLocaleString("en-US",{maximumFractionDigits:decimals})+". "+(!positionCovers?"Non-collateralized supply is insufficient. ":"")+(!liquidityCovers?"Pool liquidity is insufficient. ":"");
    }else{
      const liquidityCovers=amountRaw!==null&&availableLiquidityRaw>=amountRaw;
      const capacityCovers=borrowCapacityRawValue!==null&&requestedBorrowValue!==null&&requestedBorrowValue<=borrowCapacityRawValue;
      fundsPositionPassed=liquidityCovers&&capacityCovers&&oracleGatePassed;
      fundsPositionDetail="Pool available liquidity: "+(Number(availableLiquidityRaw)/10**decimals).toLocaleString("en-US",{maximumFractionDigits:decimals})+". "+(capacityCovers?"Estimated effective borrow headroom covers the request.":"Effective collateral headroom is insufficient or unavailable.");
    }

    const gates = [
      { id: "pool-identity", label: "Blend pool identity", passed: true, detail: "WASM hash and backstop match NEXORA's configured deployment manifest." },
      { id: "reserve-membership", label: "Reserve membership", passed: true, detail: "Asset contract is present in the selected pool." },
      { id: "reserve-enabled", label: "Reserve permits this action", passed: reserveActionAllowed, detail: reserveActionAllowed ? ((action==="withdraw"||action==="repay")?"Exit/repay actions are not blocked by the reserve's new-action enabled flag.":"Reserve is enabled in the loaded pool configuration.") : "Reserve is disabled; new supply and borrow actions are blocked." },
      { id: "amount-precision", label: "Amount precision", passed: precisionValid && positiveRaw, detail: precisionValid ? "Amount is representable at " + decimals + " reserve decimals." : "Amount has more fractional digits than the reserve supports." },
      { id: "pool-status", label: "Pool status permits this action", passed: poolAllowsAction, detail: "Current status: " + poolStatus + " (" + poolStatusLabel + "). " + statusDetail },
      { id: "wallet-funds-and-position", label: "Wallet balance and position constraints", passed: fundsPositionPassed, detail: fundsPositionDetail },
      ...(action==="borrow"?[{id:"oracle-risk",label:"Oracle and collateral headroom",passed:oracleGatePassed,detail:oracleGateDetail}]:[]),
      ...((action==="borrow"||action==="withdraw")?[{id:"pool-liquidity",label:"Pool liquidity",passed:availableLiquidityRaw>zero&&amountRaw!==null&&availableLiquidityRaw>=amountRaw,detail:"Available liquidity: "+(Number(availableLiquidityRaw)/10**decimals).toLocaleString("en-US",{maximumFractionDigits:decimals})+"; requested: "+amountFloat.toLocaleString("en-US",{maximumFractionDigits:decimals})+"."}]:[]),
      { id: "simulation", label: "Soroban transaction simulation", passed: false, detail: "No transaction has been built or simulated." },
      { id: "wallet-authorization", label: "Wallet authorization and signing", passed: false, detail: "No wallet authorization has been requested." },
      { id: "settlement", label: "On-chain settlement", passed: false, detail: "No transaction has been submitted." }
    ];
    return NextResponse.json({
      network, action, poolId, asset, wallet, amount, reserveDecimals: decimals,
      walletBalanceRaw:walletBalanceRaw?.toString()??null,
      userSupplyRaw:userSupplyRaw.toString(),userCollateralRaw:userCollateralRaw.toString(),userLiabilityRaw:userLiabilityRaw.toString(),
      availableLiquidityRaw:availableLiquidityRaw.toString(),
      borrowHeadroomOracleUnits:borrowCapacityRawValue,requestedBorrowOracleUnits:requestedBorrowValue,
      poolStatus, poolStatusLabel, reserveEnabled, latestLedger: metadata.latestLedger,
      preflightOnly: true,
      canPrepareTransaction: false,
      canSubmitTransaction: false,
      gates
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "stellar/blend/preflight"),
      preflightOnly: true
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
