import { validate as isValidUUID } from "uuid";
import { query } from "../database/database.js";

export interface UserData {
	id: string;
	createdAt: Date;
	username: string;
	firstname: string;
	lastname: string;
	password: string;
}

export async function findUserByUsername(username: string): Promise<UserData | null> {
	const result = await query(
		"SELECT id, username, created_at, firstname, lastname, password FROM users WHERE username = $1",
		[username],
	);

	if (result.rowCount !== 1) {
		return null;
	}

	const userRow = result.rows[0];

	return {
		id: userRow.id,
		username: userRow.username,
		firstname: userRow.firstname,
		lastname: userRow.lastname,
		password: userRow.password,
		createdAt: userRow.created_at,
	};
}

export async function findUserById(id: string): Promise<UserData | null> {
	if (!isValidUUID(id)) {
		return null;
	}

	const result = await query(
		"SELECT id, username, created_at, firstname, lastname, password FROM users WHERE id = $1",
		[id],
	);

	if (result.rowCount !== 1) {
		return null;
	}

	const userRow = result.rows[0];

	return {
		id: userRow.id,
		username: userRow.username,
		firstname: userRow.firstname,
		lastname: userRow.lastname,
		password: userRow.password,
		createdAt: userRow.created_at,
	};
}
