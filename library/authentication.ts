import type { FastifyRequest } from "fastify";
import { query } from "../database/adapter.js";
import type { UserRegisterType } from "../routes/frontend.ts";
import * as argon2 from "argon2";

export async function isUserSignedIn(request: FastifyRequest): Promise<boolean> {
	const user = await getSignedInUser(request);

	return !!user;
}

export interface User {
	id: string;
	username: string;
	name: string;
	surname: string;
}

export async function getSignedInUser(request: FastifyRequest): Promise<User | null> {
	const sessionId = request.cookies.session;
	if (!sessionId) {
		return null;
	}

	const result = await query(
		`
      SELECT users.id, sessions.user_id, users.username, users.firstname, users.lastname 
      FROM sessions 
      JOIN users ON users.id = sessions.user_id 
      WHERE sessions.id = $1
    `,
		[sessionId],
	);

	if (result.rowCount !== 1) {
		return null;
	}

	const userRow = result.rows[0];
	return {
		id: userRow.id as string,
		username: userRow.username as string,
		name: userRow.firstname as string,
		surname: userRow.lastname as string,
	};
}

export async function createNewAccount(user: UserRegisterType): Promise<string> {
	const { name, surname, username, password } = user;
	const result = await query(
		'INSERT INTO users(firstname, lastname, username, "password") VALUES($1, $2, $3, $4) RETURNING id',
		[name, surname, username, await argon2.hash(password)],
	);

	return result.rows[0].id as string;
}

export type SetCookieHandler = (
	name: string,
	value: string,
	options: { httpOnly: boolean; maxAge: number; sameSite: string; secure: string },
) => unknown;

export async function signInUser(
	userId: string,
	setCookieHandler: SetCookieHandler,
): Promise<string> {
	const result = await query("INSERT INTO sessions(user_id) VALUES($1) RETURNING id", [userId]);
	const sessionId = result.rows[0].id;

	setCookieHandler("session", sessionId, {
		httpOnly: true,
		// Expires after one week.
		maxAge: 604800,
		sameSite: "strict",
		secure: "auto",
	});

	return sessionId;
}
