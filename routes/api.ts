import querystring, { type ParsedUrlQueryInput } from "node:querystring";
import type { FastifyInstance } from "fastify";

export interface AuthorizationQueryParams extends ParsedUrlQueryInput {
	response_type: "code";
	redirect_uri: string;
	client_id: string;
	scope: string;
	state: string;
	code_challenge: string;
	code_challenge_method: "S256";
}

export default async function frontend(fastify: FastifyInstance) {
	fastify.get<{ Querystring: AuthorizationQueryParams }>("/authorize", function (request, reply) {
		// TODO check that query params are valid
		return reply.redirect(`/login?${querystring.stringify(request.query)}`);
	});
}
