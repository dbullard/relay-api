import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { verifyHmacHex, safeEqual } from "./signature";

const sign = (b: string, s: string) => crypto.createHmac("sha256", s).update(b).digest("hex");

test("valid signature passes", () => assert.equal(verifyHmacHex("{}", sign("{}", "s"), "s"), true));
test("wrong secret fails", () => assert.equal(verifyHmacHex("{}", sign("{}", "s"), "t"), false));
test("tampered body fails", () => assert.equal(verifyHmacHex("{x}", sign("{}", "s"), "s"), false));
test("wrong-length signature returns false instead of throwing", () => {
  assert.equal(verifyHmacHex("{}", "abc", "s"), false);
  assert.equal(verifyHmacHex("{}", "", "s"), false);
});
test("safeEqual handles different lengths", () => {
  assert.equal(safeEqual("a", "ab"), false);
  assert.equal(safeEqual("same", "same"), true);
});
