import cryptoRandomString from "crypto-random-string";
import { differenceInSeconds, isAfter } from "date-fns";
import { query } from "../../database/database.js";

export interface AuthorizationTokenData {
	id: string;
	value: string;
	scope: string;
	createdAt: Date;
	clientId: string;
	userId: string;
	codeChallenge: string;
	codeChallengeMethod: string;
	revoked: boolean;
}

interface CreateAuthorizationTokenArguments {
	clientId: string;
	userId: string;
	/** Defaults to "openid". */
	scope?: string;
	codeChallenge: string;
	/** Defaults to "S256". */
	codeChallengeMethod?: string;
}

export async function createAuthorizationToken({
	clientId,
	userId,
	scope = "openid",
	codeChallenge,
	codeChallengeMethod = "S256",
}: CreateAuthorizationTokenArguments): Promise<string> {
	const authorizationCode = cryptoRandomString({
		length: 64,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});

	await query(
		"INSERT INTO authorization_tokens(value, scope, client_id, user_id, code_challenge, code_challenge_method) VALUES($1, $2, $3, $4, $5, $6)",
		[authorizationCode, scope, clientId, userId, codeChallenge, codeChallengeMethod],
	);

	return authorizationCode;
}

export async function findAuthorizationTokenByCode(
	code: string,
): Promise<AuthorizationTokenData | null> {
	const result = await query(
		"SELECT id, value, scope, created_at, client_id, user_id, revoked, code_challenge, code_challenge_method FROM authorization_tokens WHERE value = $1",
		[code],
	);

	if (result.rowCount !== 1) {
		return null;
	}

	const tokenData = result.rows[0];

	return {
		id: tokenData.id,
		createdAt: tokenData.created_at,
		clientId: tokenData.client_id,
		userId: tokenData.user_id,
		value: tokenData.value,
		scope: tokenData.scope,
		revoked: tokenData.revoked,
		codeChallenge: tokenData.code_challenge,
		codeChallengeMethod: tokenData.code_challenge_method,
	};
}

export async function revokeAuthorizationToken(authorizationToken: string) {
	await query("UPDATE authorization_tokens SET revoked = true WHERE value = $1", [
		authorizationToken,
	]);
}

export function hasAuthorizationTokenExpired(authorizationToken: AuthorizationTokenData): boolean {
	if (isAfter(authorizationToken.createdAt, new Date())) {
		return true;
	}

	return differenceInSeconds(new Date(), authorizationToken.createdAt) > 120;
}
