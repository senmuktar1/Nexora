import { HORIZON } from "@/lib/server/horizon";
import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";


export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const address = (request.nextUrl.searchParams.get("address") ?? "").trim();
  const requested = request.nextUrl.searchParams.get("network") ?? "mainnet";
  if (requested !== "mainnet") {
    return NextResponse.json({ error: "Unsupported Stellar network." }, { status: 400 });
  }
  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    return NextResponse.json({ error: "A valid public Stellar G-address is required." }, { status: 400 });
  }

  const base = HORIZON;
  try {
    const [accountResponse, txResponse, offersResponse] = await Promise.all([
      fetch(base + "/accounts/" + encodeURIComponent(address), { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      fetch(base + "/accounts/" + encodeURIComponent(address) + "/transactions?order=desc&limit=10", { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      fetch(base + "/accounts/" + encodeURIComponent(address) + "/offers?order=desc&limit=100", { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null)
    ]);
    if (accountResponse.status === 404) return NextResponse.json({ error: "This account isn't active yet. Fund it with at least 1 XLM to activate it." }, { status: 404 });
    if (!accountResponse.ok) return NextResponse.json({ error: "Could not load the Stellar account." }, { status: 502 });
    const account = await accountResponse.json();
    const txData = txResponse.ok ? await txResponse.json() : null;
    const offersData = offersResponse?.ok ? await offersResponse.json() : null;

    const balances = (account?.balances ?? []).map((balance: Record<string, unknown>) => ({
      asset_type: typeof balance.asset_type === "string" ? balance.asset_type : "unknown",
      asset_code: typeof balance.asset_code === "string" ? balance.asset_code : "XLM",
      asset_issuer: typeof balance.asset_issuer === "string" ? balance.asset_issuer : undefined,
      balance: typeof balance.balance === "string" ? balance.balance : "0",
      limit: typeof balance.limit === "string" ? balance.limit : undefined,
      selling_liabilities: typeof balance.selling_liabilities === "string" ? balance.selling_liabilities : "0",
      buying_liabilities: typeof balance.buying_liabilities === "string" ? balance.buying_liabilities : "0",
      is_authorized: typeof balance.is_authorized === "boolean" ? balance.is_authorized : undefined
    }));
    const transactions = (txData?._embedded?.records ?? []).map((tx: Record<string, unknown>) => ({
      hash: typeof tx.hash === "string" ? tx.hash : "",
      created_at: typeof tx.created_at === "string" ? tx.created_at : "",
      successful: typeof tx.successful === "boolean" ? tx.successful : false,
      operation_count: typeof tx.operation_count === "number" ? tx.operation_count : 0,
      fee_charged: typeof tx.fee_charged === "string" ? tx.fee_charged : "0",
      memo: typeof tx.memo === "string" ? tx.memo : undefined
    })).filter((tx: {hash:string}) => tx.hash);
    const offers = (offersData?._embedded?.records ?? []).map((offer: Record<string, unknown>) => {
      const asset = (value: unknown) => {
        const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const native = item.asset_type === "native";
        return {
          type: typeof item.asset_type === "string" ? item.asset_type : "unknown",
          code: native ? "XLM" : typeof item.asset_code === "string" ? item.asset_code : null,
          issuer: typeof item.asset_issuer === "string" ? item.asset_issuer : null
        };
      };
      const price = offer.price_r && typeof offer.price_r === "object" ? offer.price_r as Record<string, unknown> : null;
      return {
        id: typeof offer.id === "string" ? offer.id : String(offer.id ?? ""),
        pagingToken: typeof offer.paging_token === "string" ? offer.paging_token : null,
        seller: typeof offer.seller === "string" ? offer.seller : address,
        selling: asset(offer.selling),
        buying: asset(offer.buying),
        amount: typeof offer.amount === "string" ? offer.amount : "0",
        price: typeof offer.price === "string" ? offer.price : null,
        priceNumerator: typeof price?.n === "number" ? price.n : null,
        priceDenominator: typeof price?.d === "number" ? price.d : null,
        lastModifiedLedger: typeof offer.last_modified_ledger === "number" ? offer.last_modified_ledger : null,
        lastModifiedTime: typeof offer.last_modified_time === "string" ? offer.last_modified_time : typeof offer.last_modified === "string" ? offer.last_modified : null
      };
    }).filter((offer: {id:string}) => offer.id);

    return NextResponse.json({
      network: requested,
      account: {
        account_id: account.account_id,
        sequence: account.sequence,
        subentry_count: account.subentry_count,
        num_sponsoring: typeof account.num_sponsoring === "number" ? account.num_sponsoring : 0,
        num_sponsored: typeof account.num_sponsored === "number" ? account.num_sponsored : 0
      },
      balances,
      transactions,
      offers,
      offerReadError: offersResponse?.ok ? null : "Temporarily unavailable.",
      retrievedAt: new Date().toISOString()
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error, "stellar/account") }, { status: 502 });
  }
}
