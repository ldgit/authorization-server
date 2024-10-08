import { createHash } from "node:crypto";
import cryptoRandomString from "crypto-random-string";
import { differenceInSeconds, subHours } from "date-fns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DUMMY_CLIENT_ID } from "../../database/createDummyData.js";
import { query } from "../../database/database.js";
import { findUserByUsername } from "../user.js";
import {
	type AccessTokenData,
	createAccessTokenForAuthorizationToken,
	extractAccessTokenFromHeader,
	findAccessTokenByValue,
	hasTokenExpired,
	revokeAccessTokenIssuedByAuthorizationToken,
} from "./accessToken.js";
import { createAuthorizationToken, findAuthorizationTokenByCode } from "./authorizationToken.js";

describe("fetching access token from database by code", () => {
	it("if token with specified code is not found, return null", async () => {
		const token = await findAccessTokenByValue("this code does not exist in the database");
		expect(token).toBeNull();
	});

	it("if token with specified code is found, return its data", async () => {
		const userId = (await findUserByUsername("HellyR"))?.id as string;
		const codeChallenge = createHash("sha256")
			.update(generateRandomString({ length: 64 }))
			.digest("base64url");
		const authorizationToken = await createAuthorizationToken({
			clientId: DUMMY_CLIENT_ID,
			userId,
			codeChallenge,
		});
		const accessToken = await createAccessTokenForAuthorizationToken(authorizationToken);
		const expectedTokenCreationDate = new Date();

		const tokenData = (await findAccessTokenByValue(accessToken.value)) as AccessTokenData;

		expect(tokenData?.id).not.toBeFalsy();
		expect(tokenData?.clientId).toEqual(DUMMY_CLIENT_ID);
		expect(tokenData?.userId).toEqual(userId);
		expect(tokenData?.value).toEqual(accessToken.value);
		expect(tokenData?.scope).toEqual("openid");
		expect(tokenData?.expiresIn).toStrictEqual(86400);
		expect(differenceInSeconds(tokenData.createdAt, expectedTokenCreationDate)).toBeLessThan(2);
		const queryResult = query("SELECT id FROM authorization_tokens WHERE id = $1", [
			tokenData.authorizationTokenId.toString(),
		]);
		expect((await queryResult).rowCount).toEqual(1);
	});
});

describe("generating access token", () => {
	it("generating access token should return freshly created token value, expiration info and scope", async () => {
		const userId = (await findUserByUsername("HellyR"))?.id as string;
		const codeChallenge = createHash("sha256")
			.update(generateRandomString({ length: 64 }))
			.digest("base64url");
		const authorizationToken = await createAuthorizationToken({
			clientId: DUMMY_CLIENT_ID,
			userId,
			codeChallenge,
		});
		const expectedCreationDate = new Date();

		const {
			id,
			value,
			scope,
			expiresIn,
			authorizationTokenId,
			clientId,
			userId: actualUserId,
			createdAt,
		} = await createAccessTokenForAuthorizationToken(authorizationToken);

		expect(value.length).toEqual(64);
		expect(scope).toEqual("openid");
		expect(expiresIn).toStrictEqual(86400);
		expect(clientId).toEqual(DUMMY_CLIENT_ID);
		expect(actualUserId).toEqual(userId);
		expect(differenceInSeconds(createdAt, expectedCreationDate)).toBeLessThan(2);
		expect(id).toEqual((await findAccessTokenByValue(value))?.id);
		expect(authorizationTokenId).toStrictEqual(
			(await findAuthorizationTokenByCode(authorizationToken))?.id,
		);
	});

	it("generating access token should throw error if provided authorization token does not exist", async () => {
		await expect(
			async () => await createAccessTokenForAuthorizationToken("this auth code does not exist"),
		).rejects.toThrowError("Authorization code not found.");
	});

	it("generating access token should throw error if provided authorization token is already tied to an access token", async () => {
		const userId = (await findUserByUsername("HellyR"))?.id as string;
		const codeChallenge = createHash("sha256")
			.update(generateRandomString({ length: 64 }))
			.digest("base64url");
		const authorizationToken = await createAuthorizationToken({
			clientId: DUMMY_CLIENT_ID,
			userId,
			codeChallenge,
		});

		await createAccessTokenForAuthorizationToken(authorizationToken);

		await expect(
			async () => await createAccessTokenForAuthorizationToken(authorizationToken),
		).rejects.toThrowError("Authorization code already has an access token.");
	});
});

describe("extractAccessTokenFromHeader should extract and base64 decode the header value to return a token", () => {
	it("should extract access token from authorization request header", () => {
		const expectedAccessToken = generateRandomString({ length: 64 });
		const accessToken = extractAccessTokenFromHeader(`Bearer ${base64encode(expectedAccessToken)}`);
		expect(accessToken).toEqual(expectedAccessToken);
	});

	[base64encode("an access token"), "Bearer", "", "Bearer "].forEach(
		(malformedAuthorizationHeader) => {
			it(`should return empty string if authorization header is malformed (${malformedAuthorizationHeader})`, () => {
				const accessToken = extractAccessTokenFromHeader(malformedAuthorizationHeader);
				expect(accessToken).toStrictEqual("");
			});
		},
	);
});

describe("hasTokenExpired", () => {
	const notRelevantData = {
		id: 1,
		authorizationTokenId: 2,
		clientId: DUMMY_CLIENT_ID,
		scope: "openid",
		userId: "cd913d98-49cd-44e6-b414-86971b6b6385",
		value: "not-important",
	};

	it("should return true if token has expired", () => {
		expect(
			hasTokenExpired({
				expiresIn: 86400,
				createdAt: subHours(new Date(), 24.01),
				...notRelevantData,
			}),
		).toStrictEqual(true);

		expect(
			hasTokenExpired({
				// 1 hour
				expiresIn: 3600,
				createdAt: subHours(new Date(), 1.01),
				...notRelevantData,
			}),
		).toStrictEqual(true);
	});

	it("should return false if token has not expired", () => {
		expect(
			hasTokenExpired({
				expiresIn: 86400,
				createdAt: subHours(new Date(), 23.99),
				...notRelevantData,
			}),
		).toStrictEqual(false);

		expect(
			hasTokenExpired({
				// 1 hour
				expiresIn: 3600,
				createdAt: subHours(new Date(), 0.99),
				...notRelevantData,
			}),
		).toStrictEqual(false);
	});
});

describe("revokeAccessTokenForCode", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should delete access token issued for the code and revoke the authorization code", async () => {
		const userId = (await findUserByUsername("HellyR"))?.id as string;
		const codeChallenge = createHash("sha256")
			.update(generateRandomString({ length: 64 }))
			.digest("base64url");
		const authorizationToken = await createAuthorizationToken({
			clientId: DUMMY_CLIENT_ID,
			userId,
			codeChallenge,
		});
		const accessToken = await createAccessTokenForAuthorizationToken(authorizationToken);

		await revokeAccessTokenIssuedByAuthorizationToken(authorizationToken);

		expect(await findAccessTokenByValue(accessToken.value)).toBeNull();
		expect((await findAuthorizationTokenByCode(authorizationToken))?.revoked).toStrictEqual(true);
	});

	it("should log a warning if authorization token does not exist", async () => {
		const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await revokeAccessTokenIssuedByAuthorizationToken("some_nonexistent_authorization_token");

		expect(consoleWarnSpy).toHaveBeenCalledOnce();
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			"Revocation error: authorization token does not exist",
		);
	});

	it("should do nothing if access token does not exist for authorization token", async () => {
		const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const userId = (await findUserByUsername("HellyR"))?.id as string;
		const codeChallenge = createHash("sha256")
			.update(generateRandomString({ length: 64 }))
			.digest("base64url");
		const authorizationToken = await createAuthorizationToken({
			clientId: DUMMY_CLIENT_ID,
			userId,
			codeChallenge,
		});

		await revokeAccessTokenIssuedByAuthorizationToken(authorizationToken);

		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});
});

function base64encode(text: string): string {
	return Buffer.from(text).toString("base64");
}

function generateRandomString({ length }: { length: number }) {
	return cryptoRandomString({
		length,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});
}
