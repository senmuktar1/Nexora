export type StellarNetwork = "testnet" | "mainnet";
export type StellarAssetSelector =
  | { asset_type: "native" }
  | { asset_type: "credit_alphanum4" | "credit_alphanum12"; asset_code: string; asset_issuer: string };

/** NEXORA is Mainnet-only: a missing value means Mainnet; anything else is rejected. */
export function parseNetwork(value: string | null): StellarNetwork | null {
  if (value === null || value === "mainnet") return "mainnet";
  return null;
}

export function parseAssetSelector(
  params: URLSearchParams,
  prefix: "base" | "counter"
): StellarAssetSelector | null {
  const code = (params.get(`${prefix}Code`) ?? "").trim().toUpperCase();
  const issuer = (params.get(`${prefix}Issuer`) ?? "").trim().toUpperCase();

  if (!code && !issuer) return { asset_type: "native" };
  if (code === "XLM" && !issuer) return { asset_type: "native" };

  if (!/^[A-Z0-9._-]{1,12}$/.test(code) || !/^G[A-Z2-7]{55}$/.test(issuer)) {
    return null;
  }

  return {
    asset_type: code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
    asset_code: code,
    asset_issuer: issuer
  };
}

export function addAssetSelector(
  url: URL,
  prefix: "base" | "counter",
  asset: StellarAssetSelector
) {
  url.searchParams.set(`${prefix}_asset_type`, asset.asset_type);
  if (asset.asset_type !== "native") {
    url.searchParams.set(`${prefix}_asset_code`, asset.asset_code);
    url.searchParams.set(`${prefix}_asset_issuer`, asset.asset_issuer);
  }
}

export function readLimit(value: string | null, fallback = 20, max = 200) {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

export function isValidAssetPair(base: StellarAssetSelector, counter: StellarAssetSelector) {
  if (base.asset_type === "native" && counter.asset_type === "native") return false;
  if (base.asset_type === "native" || counter.asset_type === "native") return true;
  return base.asset_code !== counter.asset_code || base.asset_issuer !== counter.asset_issuer;
}

export function addOrderBookSelectors(
  url: URL,
  base: StellarAssetSelector,
  counter: StellarAssetSelector
) {
  const addSide = (prefix: "selling" | "buying", asset: StellarAssetSelector) => {
    url.searchParams.set(`${prefix}_asset_type`, asset.asset_type);
    if (asset.asset_type !== "native") {
      url.searchParams.set(`${prefix}_asset_code`, asset.asset_code);
      url.searchParams.set(`${prefix}_asset_issuer`, asset.asset_issuer);
    }
  };
  addSide("selling", base);
  addSide("buying", counter);
}
