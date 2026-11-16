import { beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { decryptSecret, encryptSecret, fromBase64, toBase64, WalletCryptoError } from "@/lib/wallet/crypto";
import { generateWallet, publicKeyFromSecret, rawSecretFromSecret } from "@/lib/wallet/keys";
import { destroyVault, loadVault } from "@/lib/wallet/storage";
import * as session from "@/lib/wallet/session";

const PASSWORD = "correct horse battery";
const ITER = 100_000;

describe("wallet crypto", () => {
  it("round-trips a secret with AES-GCM + PBKDF2", async () => {
    const kp = Keypair.random();
    const raw = rawSecretFromSecret(kp.secret());
    const vault = await encryptSecret(raw, kp.publicKey(), PASSWORD, ITER);
    expect(vault.ciphertext).not.toContain(kp.secret());
    expect(JSON.stringify(vault)).not.toContain(kp.secret());
    const out = await decryptSecret(vault, PASSWORD);
    expect(Buffer.from(out).equals(Buffer.from(raw))).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const kp = Keypair.random();
    const vault = await encryptSecret(rawSecretFromSecret(kp.secret()), kp.publicKey(), PASSWORD, ITER);
    await expect(decryptSecret(vault, "wrong password!!")).rejects.toMatchObject({ code: "bad_password" });
  });

  it("rejects a vault whose public key label was swapped (AAD binding)", async () => {
    const kp = Keypair.random();
    const vault = await encryptSecret(rawSecretFromSecret(kp.secret()), kp.publicKey(), PASSWORD, ITER);
    await expect(decryptSecret({ ...vault, publicKey: Keypair.random().publicKey() }, PASSWORD)).rejects.toBeInstanceOf(WalletCryptoError);
  });

  it("rejects tampered ciphertext", async () => {
    const kp = Keypair.random();
    const vault = await encryptSecret(rawSecretFromSecret(kp.secret()), kp.publicKey(), PASSWORD, ITER);
    const bytes = fromBase64(vault.ciphertext);
    bytes[0] ^= 0xff;
    await expect(decryptSecret({ ...vault, ciphertext: toBase64(bytes) }, PASSWORD)).rejects.toMatchObject({ code: "bad_password" });
  });

  it("refuses weak passwords", async () => {
    const kp = Keypair.random();
    await expect(encryptSecret(rawSecretFromSecret(kp.secret()), kp.publicKey(), "short", ITER)).rejects.toMatchObject({ code: "weak_password" });
  });
});

describe("keys", () => {
  it("generates a valid keypair", () => {
    const w = generateWallet();
    expect(w.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(publicKeyFromSecret(w.secret)).toBe(w.publicKey);
  });
  it("validates and normalises imported secrets", () => {
    const kp = Keypair.random();
    expect(publicKeyFromSecret(`  ${kp.secret().toLowerCase()} `)).toBe(kp.publicKey());
    expect(publicKeyFromSecret("SNOTAREALKEY")).toBeNull();
    expect(publicKeyFromSecret(kp.publicKey())).toBeNull();
  });
});

describe("wallet session lifecycle", () => {
  beforeEach(async () => {
    session.__setKdfIterationsForTests(ITER);
    await session.deleteLocalWallet();
  });

  it("create → lock → unlock → delete → re-import restores the same address", async () => {
    const { secret, publicKey } = generateWallet();
    await session.saveWallet(secret, PASSWORD);
    expect(session.getSnapshot()).toEqual({ status: "unlocked", publicKey });

    const stored = await loadVault();
    expect(stored?.publicKey).toBe(publicKey);
    expect(JSON.stringify(stored)).not.toContain(secret);

    session.lock();
    expect(session.getSnapshot().status).toBe("locked");
    expect(session.isUnlocked()).toBe(false);

    expect(await session.unlock("not the password")).toEqual({ ok: false, reason: "bad_password" });
    expect(await session.unlock(PASSWORD)).toEqual({ ok: true });
    expect(session.isUnlocked()).toBe(true);

    await session.deleteLocalWallet();
    expect(session.getSnapshot()).toEqual({ status: "none", publicKey: null });
    expect(await loadVault()).toBeNull();
    expect(await session.unlock(PASSWORD)).toEqual({ ok: false, reason: "no_wallet" });

    await session.saveWallet(secret, PASSWORD);
    expect(session.getSnapshot().publicKey).toBe(publicKey);
  });

  it("throttles repeated wrong passwords", async () => {
    const { secret } = generateWallet();
    await session.saveWallet(secret, PASSWORD);
    session.lock();
    for (let i = 0; i < 5; i++) await session.unlock("wrong password " + i);
    expect(await session.unlock(PASSWORD)).toEqual({ ok: false, reason: "throttled" });
  });

  it("refuses to sign while locked", async () => {
    const { secret } = generateWallet();
    await session.saveWallet(secret, PASSWORD);
    session.lock();
    expect(() => session.signWithIntent("AAAA", { networkPassphrase: "x", operations: [], maxFeeStroops: 100 })).toThrow("wallet_locked");
  });

  it("destroyVault is idempotent", async () => {
    await destroyVault();
    await destroyVault();
    expect(await loadVault()).toBeNull();
  });
});

describe("sealed records", () => {
  beforeEach(async () => {
    session.__setKdfIterationsForTests(ITER);
    await session.deleteLocalWallet();
  });

  it("encrypts per-wallet records, requires unlock, and is erased on delete", async () => {
    const { secret } = generateWallet();
    await session.saveWallet(secret, PASSWORD);
    const voucherSecret = Keypair.random().secret();
    await session.saveSealedRecord("voucher:abc", { secret: voucherSecret });
    const { listRecords } = await import("@/lib/wallet/storage");
    const raw = await listRecords("voucher:");
    expect(raw).toHaveLength(1);
    expect(raw[0].sealed).not.toContain(voucherSecret);
    expect(await session.loadSealedRecords("voucher:")).toEqual([{ key: "voucher:abc", value: { secret: voucherSecret } }]);
    session.lock();
    await expect(session.loadSealedRecords("voucher:")).rejects.toThrow("wallet_locked");
    await session.deleteLocalWallet();
    await session.saveWallet(generateWallet().secret, PASSWORD);
    expect(await session.loadSealedRecords("voucher:")).toEqual([]);
  });
});
