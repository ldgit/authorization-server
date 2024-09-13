import { createHash } from "node:crypto";
import cryptoRandomString from "crypto-random-string";
import { differenceInMilliseconds } from "date-fns";
import { describe, expect, it } from "vitest";
import { DUMMY_CLIENT_ID } from "../../database/createDummyData.js";
import { query } from "../../database/database.js";
import {
	type AuthorizationTokenData,
	createAuthorizationToken,
	getAuthorizationTokenByCode,
} from "./authorizationToken.js";

describe("fetching authorization token from database by code", () => {
	it("if token with specified code is not found, return null", async () => {
		const token = await getAuthorizationTokenByCode("this code does not exist in the database");
		expect(token).toBeNull();
	});

	it("if token with specified code is found, return its data", async () => {
		const userId = (await query("SELECT id FROM users WHERE username = $1", ["HellyR"])).rows[0].id;
		const codeChallenge = createHash("sha256").update(generateCodeVerifier()).digest("base64url");
		const code = await createAuthorizationToken(
			DUMMY_CLIENT_ID,
			userId,
			"openid",
			codeChallenge,
			"S256",
		);
		const actualTokenCreationDate = new Date();

		const token = (await getAuthorizationTokenByCode(code)) as AuthorizationTokenData;

		expect(token?.id).not.toBeFalsy();
		expect(token?.clientId).toEqual(DUMMY_CLIENT_ID);
		expect(token?.userId).toEqual(userId);
		expect(token?.value).toEqual(code);
		expect(token?.scope).toEqual("openid");
		expect(token?.codeChallenge).toEqual(codeChallenge);
		expect(token?.codeChallengeMethod).toEqual("S256");
		expect(differenceInMilliseconds(token.createdAt, actualTokenCreationDate)).toBeLessThan(2);
	});
});

function generateCodeVerifier() {
	return cryptoRandomString({
		length: 64,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});
}
