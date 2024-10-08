import path from "node:path";
import querystring from "node:querystring";
import type { ParsedUrlQueryInput } from "node:querystring";
import StaticServer from "@fastify/static";
import { type Static, Type } from "@sinclair/typebox";
import * as argon2 from "argon2";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { query } from "../database/database.js";
import {
	type SetCookieHandler,
	type User,
	createNewAccount,
	getSignedInUser,
	isUserSignedIn,
	signInUser,
	signOut,
} from "../library/authentication.js";
import { createAuthorizationToken } from "../library/oauth2/authorizationToken.js";
import {
	attachErrorInformationToRedirectUri,
	clientExists,
	isRedirectUriValid,
} from "../library/oauth2/client.js";
import { findUserByUsername } from "../library/user.js";
import { validateNewUser } from "../library/validation.js";

export interface AuthorizationRequestQueryParams extends ParsedUrlQueryInput {
	response_type: "code";
	redirect_uri: string;
	client_id: string;
	scope: string;
	state: string;
	code_challenge: string;
	code_challenge_method: "S256";
}

/**
 * Specifies possible `error` parameter values for /authorize response, per RFC 6749.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749.html#section-4.1.2.1
 */
export type AuthorizationResponseErrorType =
	| "invalid_request"
	| "unauthorized_client"
	| "access_denied"
	| "unsupported_response_type"
	| "invalid_scope"
	| "server_error"
	| "temporarily_unavailable";

const UserLogin = Type.Object({
	username: Type.String(),
	password: Type.String(),
});

const UserRegister = Type.Object({
	name: Type.String(),
	surname: Type.String(),
	username: Type.String(),
	password: Type.String(),
});

type UserLoginType = Static<typeof UserLogin>;
export type UserRegisterType = Static<typeof UserRegister>;

export default async function frontend(fastify: FastifyInstance) {
	await fastify.register(StaticServer, {
		root: path.join(import.meta.dirname, "..", "public"),
		prefix: "/",
	});

	// Make `user` available in all view templates.
	fastify.addHook("preHandler", async function (request, reply) {
		// @ts-ignore
		reply.locals = {
			user: await getSignedInUser(request),
		};
	});

	fastify.get("/", function (request, reply) {
		return reply.view("homePage.ejs");
	});

	fastify.get("/register", async function (request, reply) {
		let validationErrors = null;
		if (request.cookies.newUserValidationErrors) {
			const unsignedCookie = fastify.unsignCookie(request.cookies.newUserValidationErrors);
			if (unsignedCookie.valid) {
				validationErrors = JSON.parse(unsignedCookie.value as string);
			}
			reply.clearCookie("newUserValidationErrors");
		}

		if (await isUserSignedIn(request)) {
			return reply.redirect("/");
		}

		return reply.view("registerPage.ejs", { validationErrors });
	});

	fastify.post<{ Body: UserRegisterType }>("/register", async function (request, reply) {
		if (await isUserSignedIn(request)) {
			return reply.redirect("/");
		}

		const user = request.body;

		const errors = await validateNewUser(user);
		if (errors !== null) {
			reply.setCookie("newUserValidationErrors", JSON.stringify(errors), {
				maxAge: 100,
				httpOnly: true,
				signed: true,
			});
			return reply.redirect("/register");
		}

		const userId = await createNewAccount(request.body);
		await signInUser(userId, reply.setCookie.bind(reply) as SetCookieHandler);

		return reply.redirect("/");
	});

	type LoginGetRequest = FastifyRequest<{
		Querystring: { error: 1 };
	}>;

	fastify.get("/login", async function (request: LoginGetRequest, reply) {
		if (await isUserSignedIn(request)) {
			return reply.redirect("/");
		}

		return reply.view("loginPage.ejs", { validationError: !!request.query.error });
	});

	/**
	 * Handles login page submit action.
	 */
	fastify.post<{ Body: UserLoginType; Querystring: AuthorizationRequestQueryParams }>(
		"/login",
		{ schema: { body: UserLogin } },
		async function (request, reply) {
			// In case of an validation error we want to preserve existing query string parameters
			const loginErrorRouteWithQueryParameters = `/login?error=1&${querystring.stringify(request.query)}`;
			const { username, password } = request.body;
			if (!username || !password) {
				return reply.redirect(loginErrorRouteWithQueryParameters);
			}

			const userData = await findUserByUsername(username);
			if (userData === null) {
				return reply.redirect(loginErrorRouteWithQueryParameters);
			}

			const passwordMatches = await argon2.verify(userData.password as string, password);

			if (!passwordMatches) {
				return reply.redirect(loginErrorRouteWithQueryParameters);
			}

			await signInUser(userData.id, reply.setCookie.bind(reply) as SetCookieHandler);

			// If there are Oauth2 parameters in the query string redirect user back to /authorize endpoint
			// so the user can approve or deny the authorization request.
			// We check that query string parameters are valid there.
			if (request.query.redirect_uri) {
				const { error, ...oauth2Params } = request.query; // Remove the error parameter if present.
				return reply.redirect(`/authorize?${querystring.stringify(oauth2Params)}`);
			}

			return reply.redirect("/");
		},
	);

	fastify.get("/logout", async function (request, reply) {
		await signOut(request, reply.clearCookie.bind(reply));
		return reply.redirect("/");
	});

	/**
	 * Follows rfc6749 standard for authorization request handling and response.
	 *
	 * @see https://datatracker.ietf.org/doc/html/rfc6749.html#section-4.1.1
	 */
	fastify.get<{ Querystring: AuthorizationRequestQueryParams }>(
		"/authorize",
		async function (request, reply) {
			if (!(await clientExists(request.query.client_id))) {
				return reply.redirect(`/error/client-id?${querystring.stringify(request.query)}`);
			}

			if (
				(await isRedirectUriValid(request.query.client_id, request.query.redirect_uri)) === false
			) {
				return reply.redirect(`/error/redirect-uri?${querystring.stringify(request.query)}`);
			}

			const errorType = validateAuthorizeQueryString(request);
			if (errorType !== "valid") {
				return reply.redirect(
					attachErrorInformationToRedirectUri(
						request.query.redirect_uri,
						request.query.state,
						errorType,
					),
				);
			}

			if (!(await isUserSignedIn(request))) {
				return reply.redirect(`/login?${querystring.stringify(request.query)}`);
			}

			const clientName = (
				await query("SELECT name FROM clients WHERE id = $1", [request.query.client_id])
			).rows[0].name;

			return reply.view("approvePage.ejs", { clientName });
		},
	);

	interface AuthorizeRequestBody {
		approved: "" | undefined;
		denied: "" | undefined;
	}

	/**
	 * Called when the user approves (or denies) the client's request for authorization.
	 */
	fastify.post<{ Querystring: AuthorizationRequestQueryParams; Body: AuthorizeRequestBody }>(
		"/authorize",
		async function (request, reply) {
			if (!(await isUserSignedIn(request))) {
				return reply.code(403).send("Forbidden");
			}

			const errorType = validateAuthorizeQueryString(request);
			if (errorType !== "valid") {
				return reply.redirect(
					attachErrorInformationToRedirectUri(
						request.query.redirect_uri,
						request.query.state,
						errorType,
					),
				);
			}

			// User denied the authorization request.
			if (request.body.denied !== undefined) {
				return reply.redirect(
					attachErrorInformationToRedirectUri(
						request.query.redirect_uri,
						request.query.state,
						"access_denied",
					),
				);
			}

			const user = (await getSignedInUser(request)) as User;
			const authorizationCode = await createAuthorizationToken({
				clientId: request.query.client_id,
				userId: user.id,
				scope: request.query.scope,
				codeChallenge: request.query.code_challenge,
				codeChallengeMethod: request.query.code_challenge_method,
			});

			return reply.redirect(
				`${request.query.redirect_uri}?code=${authorizationCode}&state=${request.query.state}`,
			);
		},
	);

	fastify.get<{ Querystring: AuthorizationRequestQueryParams; Params: { errorType: string } }>(
		"/error/:errorType",
		function (request, reply) {
			const { errorType } = request.params;
			if (errorType === "redirect-uri") {
				return reply.view("errorPage.ejs", { errorType });
			}

			return reply.view("errorPage.ejs", { errorType, clientId: request.query.client_id });
		},
	);
}

/**
 * @param request Fastify `/authorize` request.
 * @returns error type or 'valid'.
 */
function validateAuthorizeQueryString(
	request: FastifyRequest<{ Querystring: AuthorizationRequestQueryParams }>,
): AuthorizationResponseErrorType | "valid" {
	if (request.query.response_type !== "code") {
		return request.query.response_type === "token"
			? "unsupported_response_type"
			: "invalid_request";
	}

	if (request.query.scope !== "openid") {
		return !request.query.scope || typeof request.query.scope === "object"
			? "invalid_request"
			: "invalid_scope";
	}

	if (!request.query.code_challenge || typeof request.query.code_challenge === "object") {
		return "invalid_request";
	}

	if (request.query.code_challenge_method !== "S256") {
		return "invalid_request";
	}

	return "valid";
}
