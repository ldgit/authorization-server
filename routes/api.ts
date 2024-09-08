import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { extractClientCredentials, getClientById } from "../library/oauth2/client.js";

export interface AccessTokenRequestQueryParams {
	grant_type: "authorization_code";
	code: string;
	redirect_uri: string;
	code_verifier: string;
}

export default async function frontend(fastify: FastifyInstance) {
	fastify.post<{ Body: AccessTokenRequestQueryParams }>("/token", async function (request, reply) {
		// TODO validation of request.body params
		// TODO validation of extractClientCredentials(request.headers.authorization)
		const { code, code_verifier, grant_type, redirect_uri } = request.body;
		const { clientId, clientSecret } = extractClientCredentials(request.headers.authorization);

		reply.header("cache-control", "no-store").header("pragma", "no-cache");
		const client = await getClientById(clientId);

		if (!client || !(await argon2.verify(client.secret, clientSecret))) {
			return reply.code(401).header("www-authenticate", "Basic").send({ error: "invalid_client" });
		}

		if (!code || !code_verifier || !grant_type || !redirect_uri) {
			return reply.code(400).send({ error: "invalid_request" });
		}

		if (client.redirectUri !== redirect_uri) {
			return reply.code(400).send({ error: "invalid_grant" });
		}

		return reply.send({
			access_token: "TODO GENERATE ME RANDOMLY",
			token_type: "Bearer",
			// 24 hours.
			expires_in: 86400,
			scope: "basic_info",
		});
	});

	fastify.post("/userinfo", function (request, reply) {
		// TODO get actual userinfo using the provided access token
		return reply.send({ username: "MarkS", name: "Mark", surname: "Scout" });
	});
}
