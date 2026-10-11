import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { isValidChallenge, verifyPkce } from "./pkce";

const challengeFor = (v: string) => crypto.createHash("sha256").update(v).digest("base64url");

test("RFC 7636 appendix B vector", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(challengeFor(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), true);
});

test("wrong verifier fails", () => {
  assert.equal(verifyPkce("x".repeat(43), challengeFor("y".repeat(43))), false);
});

test("verifier length bounds enforced (43-128)", () => {
  assert.equal(verifyPkce("short", challengeFor("short")), false);
  assert.equal(verifyPkce("a".repeat(129), challengeFor("a".repeat(129))), false);
});

test("challenge shape validation", () => {
  assert.equal(isValidChallenge(challengeFor("z".repeat(43))), true);
  assert.equal(isValidChallenge("too short"), false);
  assert.equal(isValidChallenge(42), false);
  assert.equal(isValidChallenge("!".repeat(43)), false);
});
