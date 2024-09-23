import cryptoRandomString from "crypto-random-string";
import { addSeconds, isFuture } from "date-fns";
import { query } from "../../database/database.js";
import { findAuthorizationTokenByCode, revokeAuthorizationToken } from "./authorizationToken.js";

export interface AccessTokenData {
	id: number;
	createdAt: Date;
	/** In seconds. */
	expiresIn: number;
	value: string;
	scope: string;
	clientId: string;
	userId: string;
	authorizationTokenId: number;
}

/**
 * Generates an access token that lasts for 24 hours.
 */
export async function createAccessTokenForAuthorizationToken(
	authorizationToken: string,
): Promise<AccessTokenData> {
	const value = cryptoRandomString({
		length: 64,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});

	const authorizationTokenData = await findAuthorizationTokenByCode(authorizationToken);
	if (!authorizationTokenData) {
		throw new Error("Authorization code not found.");
	}

	const queryResult = await query(
		"SELECT id FROM access_tokens WHERE authorization_token_id = $1",
		[authorizationTokenData.id.toString()],
	);
	if (queryResult.rowCount !== null && queryResult.rowCount > 0) {
		throw new Error("Authorization code already has an access token.");
	}

	const insertResult = await query(
		"INSERT INTO access_tokens(value, scope, client_id, user_id, authorization_token_id, expires_in) VALUES($1, $2, $3, $4, $5, $6) RETURNING *",
		[
			value,
			authorizationTokenData?.scope,
			authorizationTokenData?.clientId,
			authorizationTokenData?.userId,
			authorizationTokenData?.id.toString(),
			"86400",
		],
	);

	return {
		value,
		expiresIn: 86400,
		scope: authorizationTokenData?.scope,
		authorizationTokenId: authorizationTokenData.id,
		clientId: authorizationTokenData.clientId,
		createdAt: insertResult.rows[0].created_at,
		id: insertResult.rows[0].id,
		userId: authorizationTokenData?.userId,
	};
}

export async function findAccessTokenByValue(accessToken: string): Promise<AccessTokenData | null> {
	const result = await query(
		"SELECT id, value, scope, created_at, client_id, user_id, authorization_token_id, expires_in FROM access_tokens WHERE value = $1",
		[accessToken],
	);

	if (result.rowCount !== 1) {
		return null;
	}

	const tokenData = result.rows[0];

	return {
		id: tokenData.id,
		clientId: tokenData.client_id,
		userId: tokenData.user_id,
		value: tokenData.value,
		scope: tokenData.scope,
		expiresIn: tokenData.expires_in,
		authorizationTokenId: tokenData.authorization_token_id,
		createdAt: tokenData.created_at,
	};
}

export function extractAccessTokenFromHeader(authorizationHeader: string): string {
	if (!authorizationHeader.startsWith("Bearer ")) {
		return "";
	}
	const encodedAccessToken = authorizationHeader.split(" ")[1];
	const accessToken = Buffer.from(encodedAccessToken, "base64").toString();

	return accessToken;
}

export function hasTokenExpired(accessTokenData: AccessTokenData): boolean {
	return !isFuture(addSeconds(accessTokenData.createdAt, accessTokenData.expiresIn));
}

export async function revokeAccessTokenIssuedByAuthorizationToken(authorizationToken: string) {
	const authorizationCodeData = await findAuthorizationTokenByCode(authorizationToken);

	if (authorizationCodeData === null) {
		console.warn("Revocation error: authorization token does not exist");
		return;
	}

	await revokeAuthorizationToken(authorizationToken);
	await query("DELETE FROM access_tokens WHERE authorization_token_id = $1", [
		authorizationCodeData.id.toString(),
	]);
}
