import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk";

vi.mock("server-only", () => ({}));
const { redact, safeError, UNAVAILABLE } = await import("@/lib/server/errors");

describe("server error handling", () => {
  it("redacts secret keys, tokens and query strings from logs", () => {
    const secret = Keypair.random().secret();
    const out = redact(`failed for ${secret} at https://rpc.example.com/x?apikey=abc123 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.zzzzzzzzzz`);
    expect(out).not.toContain(secret);
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("returns only a generic message to clients", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(safeError(new Error("relation \"users\" does not exist"), "test")).toBe(UNAVAILABLE);
    const logged = String(spy.mock.calls[0][0]);
    expect(JSON.parse(logged)).toMatchObject({ level: "error", scope: "test" });
    spy.mockRestore();
  });

  it("no API route forwards raw exception or upstream text to the client", () => {
    const files = globSync("src/app/api/**/route.ts");
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/error\.message|reason\.message|upstreamMessage|detail: body/);
    }
  });
});
