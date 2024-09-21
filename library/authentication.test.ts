import * as argon2 from "argon2";
import type { FastifyRequest } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../database/database.js";
import {
	SESSION_COOKIE_NAME,
	createNewAccount,
	getSignedInUser,
	isUserSignedIn,
	signInUser,
	signOut,
} from "./authentication.js";

const passwordHash =
	"$argon2id$v=19$m=65536,t=3,p=4$P5wGfnyG6tNP2iwvWPp9SA$Gp3wgJZC1xe6fVzUTMmqgCGgFPyZeCt1aXjUtlwSMmo";

describe("user authentication", () => {
	const userIds: string[] = [];
	const sessionIds: string[] = [];

	afterEach(async function () {
		if (sessionIds.length) {
			await query(
				`DELETE FROM sessions WHERE id IN (${sessionIds.map((sessionId) => `'${sessionId}'`).join(", ")})`,
			);
		}
		if (userIds.length) {
			await query(
				`DELETE FROM users WHERE id IN (${userIds.map((userId) => `'${userId}'`).join(", ")})`,
			);
		}
	});

	it("isUserSignedIn should return false if session is empty", async () => {
		const request = {
			cookies: { session: undefined },
		} as unknown as FastifyRequest;
		expect(await isUserSignedIn(request)).toStrictEqual(false);
	});

	it("isUserSignedIn should return false if session id not in database", async () => {
		const request = {
			cookies: { session: uuidv4() },
		} as unknown as FastifyRequest;
		expect(await isUserSignedIn(request)).toStrictEqual(false);
	});

	it("isUserSignedIn should return true if session id in database", async () => {
		const userId = (
			await query(
				'INSERT INTO users(firstname, lastname, username, "password") VALUES($1, $2, $3, $4) RETURNING id',
				["Burt", "Goodman", "BurtG", passwordHash],
			)
		).rows[0].id as string;
		userIds.push(userId);
		const sessionId = (
			await query("INSERT INTO sessions(user_id) VALUES($1) RETURNING id", [userId])
		).rows[0].id as string;
		sessionIds.push(sessionId);
		const request = {
			cookies: { session: sessionId },
		} as unknown as FastifyRequest;

		expect(await isUserSignedIn(request)).toStrictEqual(true);
	});

	it("getSignedInUser should return null if session is empty", async () => {
		const request = {
			cookies: { session: undefined },
		} as unknown as FastifyRequest;
		expect(await getSignedInUser(request)).toStrictEqual(null);
	});

	it("getSignedInUser should return null if session id not in database", async () => {
		const request = {
			cookies: { session: uuidv4() },
		} as unknown as FastifyRequest;
		expect(await getSignedInUser(request)).toStrictEqual(null);
	});

	it("getSignedInUser should return the user if session id in database", async () => {
		const userId = (
			await query(
				'INSERT INTO users(firstname, lastname, username, "password") VALUES($1, $2, $3, $4) RETURNING id',
				["Harmony", "Cobel", "hCobel", passwordHash],
			)
		).rows[0].id as string;
		userIds.push(userId);
		const sessionId = (
			await query("INSERT INTO sessions(user_id) VALUES($1) RETURNING id", [userId])
		).rows[0].id as string;
		sessionIds.push(sessionId);
		const request = {
			cookies: { session: sessionId },
		} as unknown as FastifyRequest;

		expect(await getSignedInUser(request)).toEqual({
			id: userId,
			name: "Harmony",
			surname: "Cobel",
			username: "hCobel",
		});
	});

	it("createNewAccount should create new account and return user id", async () => {
		const userId = await createNewAccount({
			name: "Seth",
			surname: "Milchick",
			password: "a test",
			username: "sMilchick",
		});
		userIds.push(userId);

		const newUserResult = await query("SELECT * FROM users WHERE id = $1", [userId]);

		expect(newUserResult.rowCount).toEqual(1);
		expect(newUserResult.rows[0].firstname).toEqual("Seth");
		expect(newUserResult.rows[0].lastname).toEqual("Milchick");
		expect(newUserResult.rows[0].username).toEqual("sMilchick");
		const passwordMatches = await argon2.verify(newUserResult.rows[0].password, "a test");
		expect(passwordMatches).toStrictEqual(true);
	});

	it("signInUser should create a new session for provided user id and session id", async () => {
		let cookieHandlerArgs: unknown[] = [];
		const userId = await createNewAccount({
			name: "Harmony",
			surname: "Cobel",
			password: "a test",
			username: "hCobel",
		});
		const sessionId = await signInUser(userId, (...args) => {
			cookieHandlerArgs = args;
		});
		userIds.push(userId);
		sessionIds.push(sessionId);

		const userSessionResult = await query("SELECT * FROM sessions WHERE user_id = $1", [userId]);

		expect(userSessionResult.rowCount).toEqual(1);
		expect(userSessionResult.rows[0].id).toEqual(sessionId);
		expect(userSessionResult.rows[0].user_id).toEqual(userId);
		expect(cookieHandlerArgs[0]).toEqual(SESSION_COOKIE_NAME);
		expect(cookieHandlerArgs[1]).toEqual(sessionId);
		expect(cookieHandlerArgs[2]).toEqual({
			httpOnly: true,
			maxAge: 604800,
			sameSite: "strict",
			secure: "auto",
		});
	});

	it("signOut should delete session provided in the session cookie from database and clear the session cookie", async () => {
		const userId = await createNewAccount({
			name: "Harmony",
			surname: "Cobel",
			password: "a test",
			username: "hCobel",
		});
		userIds.push(userId);
		const sessionId = await signInUser(userId, () => {});
		expect(sessionId).not.toBeFalsy();
		const clearCookieHandler = vi.fn();

		await signOut(
			{ cookies: { session: sessionId } } as unknown as FastifyRequest,
			clearCookieHandler,
		);

		expect(
			await isUserSignedIn({ cookies: { session: sessionId } } as unknown as FastifyRequest),
		).toStrictEqual(false);
		expect(clearCookieHandler).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
	});

	it("signOut should still clear cookie if no session in the database", async () => {
		const clearCookieHandler = vi.fn();

		await signOut(
			{ cookies: { session: uuidv4() } } as unknown as FastifyRequest,
			clearCookieHandler,
		);
		expect(clearCookieHandler).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
	});
});
