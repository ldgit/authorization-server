import type { ParsedUrlQueryInput } from "node:querystring";
import type { FastifyInstance } from "fastify";
import { type User, getSignedInUser } from "../library/authentication.js";

export interface AccessTokenRequestQueryParams extends ParsedUrlQueryInput {
	response_type: "code";
	redirect_uri: string;
	client_id: string;
	scope: string;
	state: string;
	code_challenge: string;
	code_challenge_method: "S256";
}

export default async function frontend(fastify: FastifyInstance) {
	fastify.post<{ Querystring: AccessTokenRequestQueryParams }>("/token", function (request, reply) {
		// TODO validation of request.body params
		// TODO validation of extractClientCredentials(request.headers.authorization)

		return reply.header("cache-control", "no-store").header("pragma", "no-cache").send({
			access_token: "TODO GENERATE ME RANDOMLY",
			token_type: "Bearer",
			// 24 hours.
			expires_in: 86400,
			scope: "basic_info",
		});
	});

	fastify.post("/resource/basic-info", async function (request, reply) {
		const { username, name, surname } = (await getSignedInUser(request)) as User;
		return reply.send({ username, name, surname });
	});
}
