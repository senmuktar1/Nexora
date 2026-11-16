import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { Account, Asset, Claimant, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describeTransaction } from "@/lib/stellar/describe";

const me = Keypair.random().publicKey();
const USDC = new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");

function tx(...ops: ReturnType<typeof Operation.payment>[]) {
  const b = new TransactionBuilder(new Account(me, "7"), { fee: "250", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 2_000_000_000 } });
  ops.forEach(o => b.addOperation(o));
  return b.build();
}

describe("describeTransaction (approval sheet content)", () => {
  it("decodes swaps from the transaction itself", () => {
    const t = tx(
      Operation.changeTrust({ asset: USDC }) as never,
      Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: "10", destination: me, destAsset: USDC, destMin: "2.4875", path: [] }) as never
    );
    const d = describeTransaction(t);
    expect(d.operations.map(o => o.title)).toEqual(["Add trustline", "Swap"]);
    expect(d.operations[1].rows).toEqual([["You pay", "10 XLM"], ["Minimum received", "2.4875 USDC · GA5ZSE…K4KZVN"], ["Recipient", "Your account"]]);
    expect(d.fee).toBe("0.00005");
    expect(d.hash).toBe(Buffer.from(t.hash()).toString("hex"));
  });

  it("shows claimants and their time conditions", () => {
    const friend = Keypair.random().publicKey();
    const t = tx(Operation.createClaimableBalance({ asset: USDC, amount: "5", claimants: [
      new Claimant(friend, Claimant.predicateBeforeAbsoluteTime("1900000000")),
      new Claimant(me, Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime("1900000000")))
    ] }) as never);
    const rows = describeTransaction(t).operations[0].rows;
    expect(rows[0]).toEqual(["Amount", "5 USDC · GA5ZSE…K4KZVN"]);
    expect(rows[1][1]).toMatch(/^GA|^G.{5}…/);
    expect(rows[1][1]).toMatch(/Before/);
    expect(rows[2][1]).toMatch(/^You · Not \(Before/);
  });

  it("flags operations sourced from another account", () => {
    const other = Keypair.random().publicKey();
    const d = describeTransaction(tx(Operation.payment({ destination: other, asset: Asset.native(), amount: "1", source: other })));
    expect(d.operations[0].rows[0][0]).toBe("From account");
  });
});

describe("signing access control", () => {
  it("lint forbids importing the wallet session outside the wallet layer", () => {
    const probe = "src/components/nexora/__probe.tsx";
    writeFileSync(probe, 'import * as s from "@/lib/wallet/session";\nexport const x = s;\n');
    try {
      let out = "";
      try { execFileSync("npx", ["eslint", probe], { encoding: "utf8" }); } catch (e) { out = String((e as { stdout?: string }).stdout); }
      expect(out).toMatch(/no-restricted-imports/);
    } finally {
      unlinkSync(probe);
    }
  }, 60_000);
});
