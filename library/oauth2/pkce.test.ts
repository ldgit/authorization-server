import { createHash } from "node:crypto";
import cryptoRandomString from "crypto-random-string";
import { describe, expect, it } from "vitest";
import { verifyPkceCodeAgainstCodeChallenge } from "./pkce.js";

describe("verifyPkceCodeAgainstCodeChallenge", () => {
	it("should return false if PKCE verifier does not match the challenge", () => {
		const codeChallenge = createHash("sha256").update(generateCodeVerifier()).digest("base64url");
		const isValid = verifyPkceCodeAgainstCodeChallenge(generateCodeVerifier(), codeChallenge);
		expect(isValid).toStrictEqual(false);
	});

	it("should return true if PKCE verifier does matches the challenge", () => {
		const verifier = generateCodeVerifier();
		const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
		const isValid = verifyPkceCodeAgainstCodeChallenge(verifier, codeChallenge);
		expect(isValid).toStrictEqual(true);
	});
});

function generateCodeVerifier() {
	return cryptoRandomString({
		length: 64,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});
}
