import { createHash } from "node:crypto";
import cryptoRandomString from "crypto-random-string";
import { addSeconds, differenceInSeconds, subSeconds } from "date-fns";
import { describe, expect, it } from "vitest";
import { DUMMY_CLIENT_ID } from "../../database/createDummyData.js";
import { query } from "../../database/database.js";
import { findUserByUsername } from "../user.js";
import {
	type AuthorizationTokenData,
	createAuthorizationToken,
	getAuthorizationTokenByCode,
	hasAuthorizationTokenExpired,
} from "./authorizationToken.js";

describe("fetching authorization token from database by code", () => {
	it("if token with specified code is not found, return null", async () => {
		const token = await getAuthorizationTokenByCode("this code does not exist in the database");
		expect(token).toBeNull();
	});

	it("if token with specified code is found, return its data", async () => {
		const userId = (await findUserByUsername("HellyR"))?.id as string;
		const codeChallenge = createHash("sha256").update(generateCodeVerifier()).digest("base64url");
		const code = await createAuthorizationToken(
			DUMMY_CLIENT_ID,
			userId,
			"openid",
			codeChallenge,
			"S256",
		);
		const expectedTokenCreationDate = new Date();

		const token = (await getAuthorizationTokenByCode(code)) as AuthorizationTokenData;

		expect(token?.id).not.toBeFalsy();
		expect(token?.clientId).toEqual(DUMMY_CLIENT_ID);
		expect(token?.userId).toEqual(userId);
		expect(token?.value).toEqual(code);
		expect(token?.scope).toEqual("openid");
		expect(token?.codeChallenge).toEqual(codeChallenge);
		expect(token?.codeChallengeMethod).toEqual("S256");
		expect(differenceInSeconds(token.createdAt, expectedTokenCreationDate)).toBeLessThan(2);
	});
});

describe("checking if authorization token has expired", () => {
	[118, 54, 5, 0].forEach((seconds) => {
		it(`should return false if token was created within ${seconds} from now`, async () => {
			const userId = (await findUserByUsername("HellyR"))?.id as string;
			const codeChallenge = createHash("sha256").update(generateCodeVerifier()).digest("base64url");
			const authorizationCode = cryptoRandomString({
				length: 64,
				characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
			});

			await query(
				"INSERT INTO authorization_tokens(created_at, value, scope, client_id, user_id, code_challenge, code_challenge_method) VALUES($1, $2, $3, $4, $5, $6, $7)",
				[
					subSeconds(new Date(), seconds),
					authorizationCode,
					"openid",
					DUMMY_CLIENT_ID,
					userId,
					codeChallenge,
					"S256",
				],
			);

			const codeData = (await getAuthorizationTokenByCode(
				authorizationCode,
			)) as AuthorizationTokenData;

			expect(hasAuthorizationTokenExpired(codeData)).toStrictEqual(false);
		});
	});

	it("should return true if token was created more than 2 minutes from now", async () => {
		const userId = (await findUserByUsername("HellyR"))?.id as string;
		const codeChallenge = createHash("sha256").update(generateCodeVerifier()).digest("base64url");
		const authorizationCode = cryptoRandomString({
			length: 64,
			characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
		});

		await query(
			"INSERT INTO authorization_tokens(created_at, value, scope, client_id, user_id, code_challenge, code_challenge_method) VALUES($1, $2, $3, $4, $5, $6, $7)",
			[
				subSeconds(new Date(), 121),
				authorizationCode,
				"openid",
				DUMMY_CLIENT_ID,
				userId,
				codeChallenge,
				"S256",
			],
		);

		const codeData = (await getAuthorizationTokenByCode(
			authorizationCode,
		)) as AuthorizationTokenData;

		expect(hasAuthorizationTokenExpired(codeData)).toStrictEqual(true);
	});

	[2, 15, 121, 10000000].forEach((seconds) => {
		it(`should return true if token was created ${seconds} seconds in the future (?)`, async () => {
			const userId = (await findUserByUsername("HellyR"))?.id as string;
			const codeChallenge = createHash("sha256").update(generateCodeVerifier()).digest("base64url");
			const authorizationCode = cryptoRandomString({
				length: 64,
				characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
			});

			await query(
				"INSERT INTO authorization_tokens(created_at, value, scope, client_id, user_id, code_challenge, code_challenge_method) VALUES($1, $2, $3, $4, $5, $6, $7)",
				[
					addSeconds(new Date(), seconds),
					authorizationCode,
					"openid",
					DUMMY_CLIENT_ID,
					userId,
					codeChallenge,
					"S256",
				],
			);

			const codeData = (await getAuthorizationTokenByCode(
				authorizationCode,
			)) as AuthorizationTokenData;

			expect(hasAuthorizationTokenExpired(codeData)).toStrictEqual(true);
		});
	});
});

function generateCodeVerifier() {
	return cryptoRandomString({
		length: 64,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});
}
