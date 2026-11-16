import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { hashOf, submitSigned } from "@/lib/stellar/client";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllGlobals());

const kp = Keypair.random();
const tx = new TransactionBuilder(new Account(kp.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 2_000_000_000 } })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" })).build();
tx.sign(kp);
const signed = tx.toEnvelope().toXDR("base64");
const hash = hashOf(signed);

function mockFetch(submit: unknown, txStatuses: string[]) {
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("/api/stellar/submit")) return Response.json(submit);
    return Response.json({ status: txStatuses[Math.min(i++, txStatuses.length - 1)] });
  }));
}

describe("submitSigned", () => {
  it("confirmed by the relay", async () => {
    mockFetch({ status: "confirmed", hash }, []);
    expect(await submitSigned(signed, { pollMs: 1, maxPolls: 3 })).toEqual({ status: "confirmed", hash });
  });
  it("pending → confirmed only after a ledger lookup", async () => {
    mockFetch({ status: "pending", hash }, ["not_found", "not_found", "confirmed"]);
    expect(await submitSigned(signed, { pollMs: 1, maxPolls: 5 })).toEqual({ status: "confirmed", hash });
  });
  it("pending → stays pending when never confirmed (no false success)", async () => {
    mockFetch({ status: "pending", hash }, ["not_found"]);
    expect((await submitSigned(signed, { pollMs: 1, maxPolls: 3 })).status).toBe("pending");
  });
  it("rejects a response for a different hash", async () => {
    mockFetch({ status: "confirmed", hash: "f".repeat(64) }, []);
    expect((await submitSigned(signed, { pollMs: 1, maxPolls: 1 })).status).toBe("failed");
  });
});

describe("submit route", () => {
  it("returns quickly as pending when Horizon times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/stellar/submit/route");
    const req = new Request("http://x/api/stellar/submit", { method: "POST", body: JSON.stringify({ xdr: signed }), headers: { "x-forwarded-for": "1.2.3.4" } });
    const res = await POST(req as never);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "pending", hash });
  });
  it("rejects unsigned or non-Mainnet envelopes", async () => {
    const { POST } = await import("@/app/api/stellar/submit/route");
    const unsigned = new TransactionBuilder(new Account(kp.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 0 } })
      .addOperation(Operation.payment({ destination: kp.publicKey(), asset: Asset.native(), amount: "1" })).build().toEnvelope().toXDR("base64");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ xdr: unsigned }), headers: { "x-forwarded-for": "5.6.7.8" } }) as never);
    expect(res.status).toBe(400);
  });
});
