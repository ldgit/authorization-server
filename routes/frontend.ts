import StaticServer from "@fastify/static";
import path from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { query } from "../database/adapter.ts";
import * as argon2 from "argon2";
import { getSignedInUser, isUserSignedIn } from "../library/authentication.ts";

const User = Type.Object({
	username: Type.String(),
	password: Type.String(),
});

type UserType = Static<typeof User>;

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

	fastify.get("/", async function (request, reply) {
		if (!(await isUserSignedIn(request))) {
			return reply.redirect("/login");
		}
		return reply.view("homePage.ejs");
	});

	/**
	 * Login page.
	 */
	fastify.get("/login", async function (request, reply) {
		if (await isUserSignedIn(request)) {
			return reply.redirect("/");
		}

		return reply.view("loginPage.ejs");
	});

	/**
	 * Handles login page submit action.
	 */
	fastify.post<{ Body: UserType }>(
		"/login",
		{ schema: { body: User } },
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

			const sessionId = (
				await query("INSERT INTO sessions(user_id) VALUES($1) RETURNING id", [user.id])
			).rows[0].id as string;

			reply.setCookie("session", sessionId, {
				httpOnly: true,
				// Expires after one week.
				maxAge: 604800,
				sameSite: "strict",
				secure: "auto",
			});

			return reply.redirect("/");
		},
	);
}
