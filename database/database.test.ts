import type { QueryResult } from "pg";
import { v4 as uuidv4 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { query, transactionQuery } from "./database.ts";

const passwordHash =
	"$argon2id$v=19$m=65536,t=3,p=4$P5wGfnyG6tNP2iwvWPp9SA$Gp3wgJZC1xe6fVzUTMmqgCGgFPyZeCt1aXjUtlwSMmo";

describe("database adapter", () => {
	beforeAll(async () => {
		await query("TRUNCATE users CASCADE");
	});

	it("should support storing and fetching data from database", async () => {
		await query(
			'INSERT INTO users(firstname, lastname, username, "password") VALUES($1, $2, $3, $4)',
			["Mark", "Scout", "MarkS", passwordHash],
		);
		const result = await query(
			"SELECT firstname, lastname, username, password FROM users WHERE username = $1",
			["MarkS"],
		);
		expect(result.rowCount).toEqual(1);
		expect(result.rows[0].username).toEqual("MarkS");
		expect(result.rows[0].firstname).toEqual("Mark");
		expect(result.rows[0].lastname).toEqual("Scout");
		expect(result.rows[0].password).toEqual(passwordHash);
	});

	it("should protect from sql injection", async () => {
		const username = `Robert'); DROP TABLE users; --`;
		/** Uncomment the query bellow for comparison of what happens if we don't use parametrized query. */
		// await query(`SELECT firstname, lastname, username, password FROM users WHERE username = ${username}`);
		const result = await query(
			"SELECT firstname, lastname, username, password FROM users WHERE username = $1",
			[username],
		);
		expect(result.rowCount).toEqual(0);
	});

	it("transactionQuery should insert a user into the database", async () => {
		let expectedUserId = "";

		const result = (await transactionQuery(async (client) => {
			expectedUserId = uuidv4();
			return await client.query(
				'INSERT INTO users(id, firstname, lastname, username, "password") VALUES($1, $2, $3, $4, $5) RETURNING id',
				[expectedUserId, "Helly", "Riggs", "HellyR", passwordHash],
			);
		})) as QueryResult;

		expect(result.rowCount).toEqual(1);
		expect(result.rows[0].id).toEqual(expectedUserId);
	});

	it("transactionQuery should rollback all changes in case of query failure", async () => {
		let firstUserId = "";

		const invalidInsertion = async () => {
			firstUserId = uuidv4();
			const secondUserId = uuidv4();
			await transactionQuery(async (client) => {
				await client.query(
					'INSERT INTO users(id, firstname, lastname, username, "password") VALUES($1, $2, $3, $4, $5) RETURNING id',
					[firstUserId, "Jill", "Doe", "user2", passwordHash],
				);
				// This one should fail because of unique constraint on `username` field.
				await client.query(
					'INSERT INTO users(id, firstname, lastname, username, "password") VALUES($1, $2, $3, $4, $5) RETURNING id',
					[secondUserId, "Jack", "Doe", "user2", passwordHash],
				);
			});
		};

		await expect(async () => await invalidInsertion()).rejects.toThrowError(
			'duplicate key value violates unique constraint "users_username_key"',
		);
		const result = await query("SELECT * FROM users WHERE id=$1::uuid", [firstUserId]);
		expect(result.rowCount).toEqual(0);
	});

	it("transactionQuery should release clients", async () => {
		for (let index = 0; index < 100; index++) {
			await transactionQuery(async (client) => {
				return await client.query("SELECT * FROM users");
			});
		}
	});

	it("transactionQuery should rollback all changes in case of code error", async () => {
		let firstUserId = "";

		const invalidInsertion = async () =>
			await transactionQuery(async (client) => {
				firstUserId = uuidv4();
				await client.query(
					'INSERT INTO users(id, firstname, lastname, username, "password") VALUES($1, $2, $3, $4, $5) RETURNING id',
					[firstUserId, "Jill", "Doe", "user2", passwordHash],
				);

				throw new Error("test");
			});

		await expect(async () => await invalidInsertion()).rejects.toThrowError("test");
		const result = await query("SELECT * FROM users WHERE id=$1::uuid", [firstUserId]);
		expect(result.rowCount).toEqual(0);
	});
});
