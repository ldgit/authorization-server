import StaticServer from "@fastify/static";
import path from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { query } from "../database/adapter.ts";
import * as argon2 from "argon2";
import {
	getSignedInUser,
	isUserSignedIn,
	createNewAccount,
	signInUser,
	type SetCookieHandler,
} from "../library/authentication.ts";

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
		if (await isUserSignedIn(request)) {
			return reply.redirect("/");
		}

		return reply.view("registerPage.ejs");
	});

	fastify.post<{ Body: UserRegisterType }>("/register", async function (request, reply) {
		if (await isUserSignedIn(request)) {
			return reply.redirect("/");
		}

		const userId = await createNewAccount(request.body);
		await signInUser(userId, reply.setCookie.bind(reply) as SetCookieHandler);

		return reply.redirect("/");
	});

	fastify.get("/login", async function (request, reply) {
		if (await isUserSignedIn(request)) {
			return reply.redirect("/");
		}

		return reply.view("loginPage.ejs");
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

			if (user.username !== username) {
				return reply.redirect("/login?error=1");
			}

			const passwordMatches = await argon2.verify(user.password as string, password);

			if (!passwordMatches) {
				return reply.redirect("/login?error=1");
			}

			await signInUser(user.id, reply.setCookie.bind(reply) as SetCookieHandler);

			return reply.redirect("/");
		},
	);
}
