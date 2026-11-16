import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { verifyTransactionSignatures } from "@/lib/stellar/verify-signed";

vi.mock("server-only", () => ({}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const kp = Keypair.random(), other = Keypair.random(), stranger = Keypair.random();
function tx(withOpSource = false) {
  return new TransactionBuilder(new Account(kp.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 2_000_000_000 } })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1", source: withOpSource ? other.publicKey() : undefined })).build();
}

describe("signed transaction verification (server, before relay)", () => {
  it("accepts a valid source signature", () => { const t = tx(); t.sign(kp); expect(verifyTransactionSignatures(t)).toBe(true); });
  it("rejects unsigned, wrongly signed, or stranger-signed transactions", () => {
    expect(verifyTransactionSignatures(tx())).toBe(false);
    const a = tx(); a.sign(stranger); expect(verifyTransactionSignatures(a)).toBe(false);
    const b = tx(); b.sign(kp); b.sign(stranger); expect(verifyTransactionSignatures(b)).toBe(false);
  });
  it("accepts co-signatures from operation sources (vouchers, launches)", () => {
    const t = tx(true); t.sign(kp); t.sign(other); expect(verifyTransactionSignatures(t)).toBe(true);
    const u = tx(true); u.sign(other); expect(verifyTransactionSignatures(u)).toBe(false); // source must sign
  });
  it("rejects a signature over a different transaction (tampered after signing)", () => {
    const t = tx(); t.sign(kp);
    const forged = tx(); forged.signatures.push(t.signatures[0]);
    expect(verifyTransactionSignatures(forged)).toBe(false);
  });
});

describe("duplicate submission", () => {
  it("does not re-send a confirmed transaction; reports the known outcome", async () => {
    const { POST, __resetSubmissionsForTests } = await import("@/app/api/stellar/submit/route");
    __resetSubmissionsForTests();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const horizon = vi.fn(async () => Response.json({ successful: true, ledger: 9 }));
    vi.stubGlobal("fetch", horizon);
    const t = tx(); t.sign(kp);
    const body = JSON.stringify({ xdr: t.toEnvelope().toXDR("base64") });
    const req = () => new Request("http://x", { method: "POST", body, headers: { "x-forwarded-for": Math.random().toString() } }) as never;
    expect(await (await POST(req())).json()).toMatchObject({ status: "confirmed" });
    expect(await (await POST(req())).json()).toMatchObject({ status: "confirmed", duplicate: true });
    expect(horizon).toHaveBeenCalledTimes(1);
  });

  it("a retry rejected with tx_bad_seq is resolved against the ledger (no false failure)", async () => {
    const { submitSigned } = await import("@/lib/stellar/client");
    const t = tx(); t.sign(kp);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/stellar/submit")
      ? Response.json({ status: "failed", code: "tx_bad_seq", hash: Buffer.from(t.hash()).toString("hex") })
      : Response.json({ status: "confirmed" })));
    expect((await submitSigned(t.toEnvelope().toXDR("base64"), { pollMs: 1, maxPolls: 1 })).status).toBe("confirmed");
  });
});

describe("client IP for rate limiting", () => {
  it("uses only the header the platform sets", async () => {
    const { clientKey } = await import("@/lib/server/rate-limit");
    const req = (h: Record<string, string>) => ({ headers: new Headers(h) }) as never;
    const spoof = { "x-nf-client-connection-ip": "6.6.6.6", "x-forwarded-for": "1.1.1.1, 10.0.0.1" };
    expect(clientKey(req(spoof), {} as unknown as NodeJS.ProcessEnv)).toBe("1.1.1.1");
    expect(clientKey(req(spoof), { NETLIFY: "true" } as unknown as NodeJS.ProcessEnv)).toBe("6.6.6.6");
    expect(clientKey(req({ "cf-connecting-ip": "2.2.2.2" }), { TRUSTED_CLIENT_IP_HEADER: "CF-Connecting-IP" } as unknown as NodeJS.ProcessEnv)).toBe("2.2.2.2");
  });
});
