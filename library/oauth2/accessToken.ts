import cryptoRandomString from "crypto-random-string";
import { query } from "../../database/database.js";
import { getAuthorizationTokenByCode } from "./authorizationToken.js";

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
export async function createAccessTokenForAuthorizationCode(
	authorizationToken: string,
): Promise<{ value: string; expiresIn: number; scope: string }> {
	const value = cryptoRandomString({
		length: 64,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});

	const authorizationTokenData = await getAuthorizationTokenByCode(authorizationToken);
	if (!authorizationTokenData) {
		throw new Error("Authorization code not found.");
	}

	const queryResult = await query(
		"SELECT id FROM access_tokens WHERE authorization_token_id = $1",
		[authorizationTokenData.id],
	);
	if (queryResult.rowCount !== null && queryResult.rowCount > 0) {
		throw new Error("Authorization code already has an access token.");
	}

	await query(
		"INSERT INTO access_tokens(value, scope, client_id, user_id, authorization_token_id, expires_in) VALUES($1, $2, $3, $4, $5, $6)",
		[
			value,
			authorizationTokenData?.scope,
			authorizationTokenData?.clientId,
			authorizationTokenData?.userId,
			authorizationTokenData?.id,
			"86400",
		],
	);

	return { value, expiresIn: 86400, scope: authorizationTokenData?.scope };
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
