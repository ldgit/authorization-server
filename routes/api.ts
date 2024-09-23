import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import {
	createAccessTokenForAuthorizationToken,
	extractAccessTokenFromHeader,
	findAccessTokenByValue,
	hasTokenExpired,
	revokeAccessTokenIssuedByAuthorizationToken,
} from "../library/oauth2/accessToken.js";
import {
	findAuthorizationTokenByCode,
	hasAuthorizationTokenExpired,
} from "../library/oauth2/authorizationToken.js";
import { extractClientCredentials, getClientById } from "../library/oauth2/client.js";
import { verifyPkceCodeAgainstCodeChallenge } from "../library/oauth2/pkce.js";
import { findUserById } from "../library/user.js";

export interface AccessTokenRequestQueryParams {
	grant_type: "authorization_code";
	code: string;
	redirect_uri: string;
	code_verifier: string;
}

// biome-ignore lint/suspicious/useAwait: Fastify requires this to return a Promise to run.
export default async function frontend(fastify: FastifyInstance) {
	fastify.post<{ Body: AccessTokenRequestQueryParams }>("/token", async function (request, reply) {
		const { code, code_verifier, grant_type, redirect_uri } = request.body;
		const { clientId, clientSecret } = extractClientCredentials(request.headers.authorization);

		reply.header("cache-control", "no-store").header("pragma", "no-cache");
		const client = await getClientById(clientId);

		if (!client || !(await argon2.verify(client.secret, clientSecret))) {
			return reply
				.code(401)
				.header("www-authenticate", 'Basic realm="Client authentication"')
				.send({ error: "invalid_client" });
		}

		if (
			!code ||
			!code_verifier ||
			!grant_type ||
			!redirect_uri ||
			Array.isArray(code) ||
			Array.isArray(grant_type) ||
			Array.isArray(code_verifier) ||
			Array.isArray(redirect_uri)
		) {
			return reply.code(400).send({ error: "invalid_request" });
		}

		if (grant_type !== "authorization_code") {
			return reply.code(400).send({ error: "unsupported_grant_type" });
		}

		if (client.redirectUri !== redirect_uri) {
			return reply.code(400).send({ error: "invalid_grant" });
		}

		const authorizationTokenData = await findAuthorizationTokenByCode(code);
		if (
			authorizationTokenData === null ||
			authorizationTokenData.clientId !== clientId ||
			authorizationTokenData.revoked === true ||
			hasAuthorizationTokenExpired(authorizationTokenData)
		) {
			return reply.code(400).send({ error: "invalid_grant" });
		}

		if (!verifyPkceCodeAgainstCodeChallenge(code_verifier, authorizationTokenData?.codeChallenge)) {
			return reply.code(400).send({ error: "invalid_request" });
		}

		let accessTokenData: {
			value: string;
			expiresIn: number;
			scope: string;
		};

		try {
			accessTokenData = await createAccessTokenForAuthorizationToken(code);
		} catch (error: any) {
			if (error.message === "Authorization code already has an access token.") {
				await revokeAccessTokenIssuedByAuthorizationToken(code);

				return reply.code(400).send({ error: "invalid_grant" });
			}

			throw error;
		}

		return reply.send({
			access_token: accessTokenData.value,
			token_type: "Bearer",
			expires_in: accessTokenData.expiresIn,
			scope: accessTokenData.scope,
		});
	});

	fastify.get("/userinfo", async function (request, reply) {
		if (!request.headers.authorization) {
			return reply.code(401).header("www-authenticate", "Bearer").send();
		}

		const accessToken = extractAccessTokenFromHeader(request.headers.authorization);
		const accessTokenData = await findAccessTokenByValue(accessToken);

		if (accessTokenData === null || hasTokenExpired(accessTokenData)) {
			return reply.code(401).header("www-authenticate", "Bearer").send({ error: "invalid_token" });
		}

		const userData = await findUserById(accessTokenData.userId);

		return reply.send({
			sub: userData?.id,
			given_name: userData?.firstname,
			family_name: userData?.lastname,
			preferred_username: userData?.username,
		});
	});
}
