import StaticServer from "@fastify/static";
import path from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { query } from "../database/adapter.ts";
import * as argon2 from "argon2";
import {
	getSignedInUser,
	isUserSignedIn,
	createNewAccount,
	signInUser,
	type SetCookieHandler,
} from "../library/authentication.ts";
import { validateNewUser } from "../library/validation.ts";

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
	fastify.post<{ Body: UserLoginType }>(
		"/login",
		{ schema: { body: UserLogin } },
		async function (request, reply) {
			const { username, password } = request.body;
			if (!username || !password) {
				return reply.redirect("/login?error=1");
			}

			const result = await query("SELECT id, username, password FROM users WHERE username = $1", [
				username,
			]);
			if (result.rowCount !== 1) {
				return reply.redirect("/login?error=1");
			}

			const user = result.rows[0];

			const passwordMatches = await argon2.verify(user.password as string, password);

			if (!passwordMatches) {
				return reply.redirect("/login?error=1");
			}

			if (user.username !== username) {
				return reply.redirect("/login?error=1");
			}

			await signInUser(user.id, reply.setCookie.bind(reply) as SetCookieHandler);

			return reply.redirect("/");
		},
	);

	fastify.get("/logout", async function (request, reply) {
		if (!(await isUserSignedIn(request))) {
			return reply.redirect("/");
		}

		const sessionId = request.cookies.session as string;
		await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
		reply.clearCookie("session");

		return reply.redirect("/");
	});
}
