import * as argon2 from "argon2";
import { query, transactionQuery } from "../database/database.js";

/** Only for use in tests. */
export const DUMMY_CLIENT_ID = "23f0706a-f556-477f-a8cb-808bd045384f";
/** Only for use in tests. */
export const DUMMY_CLIENT_NAME = "Lumon Industries";
/** Only for use in tests. */
export const DUMMY_CLIENT_REDIRECT_URI = "https://lumon.example.com";

/**
 * Fills the database with dummy data.
 *
 * For use in automated tests and local testing. Deletes all existing data.
 */
export async function createDummyData() {
	const password = "test";

	console.log("Deleting all existing data");
	await query("TRUNCATE clients, authorization_tokens, access_tokens, sessions, users");

	console.log("Creating dummy data");

	await transactionQuery(
		async (client) => {
			const queryText =
				'INSERT INTO users(firstname, lastname, username, "password") VALUES($1, $2, $3, $4) RETURNING id';

			let hash = await argon2.hash(password);
			await client.query(queryText, ["Mark", "Scout", "MarkS", hash]);
			console.log("Created user MarkS");
			hash = await argon2.hash(password);
			await client.query(queryText, ["Helly", "Riggs", "HellyR", hash]);
			console.log("Created user HellyR");
			hash = await argon2.hash(password);
			await client.query(queryText, ["Irving", "Bailiff", "IrvingB", hash]);
			console.log("Created user IrvingB");
			console.log('All users use same password: "test"');
			console.log("---");

			console.log("Creating clients");
			await client.query(
				"INSERT INTO clients(id, name, redirect_uri, secret, description) VALUES($1, $2, $3, $4, $5) RETURNING id",
				[
					DUMMY_CLIENT_ID,
					DUMMY_CLIENT_NAME,
					DUMMY_CLIENT_REDIRECT_URI,
					"secret_123",
					"A dummy client used for testing and development purposes.",
				],
			);
			console.log(`Created a test client ${DUMMY_CLIENT_NAME} (id: ${DUMMY_CLIENT_ID})`);
			console.log(`Client redirect URI: ${DUMMY_CLIENT_REDIRECT_URI}`);
		},
		{ destroyClient: true },
	);

	console.log("Dummy data created successfully.");
}
