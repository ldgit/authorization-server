import "dotenv/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import Postgrator from "postgrator";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
	// Create a client of your choice
	const client = new pg.Client({
		host: process.env.POSTGRES_HOST,
		port: process.env.POSTGRES_PORT,
		database: process.env.POSTGRES_DB,
		user: process.env.POSTGRES_USER,
		password: process.env.POSTGRES_PASSWORD,
	});

	try {
		await client.connect();
		const postgrator = new Postgrator({
			migrationPattern: `${__dirname}/../migrations/*`,
			driver: "pg",
			database: process.env.POSTGRES_DB,
			schemaTable: "migrations",
			currentSchema: "public",
			execQuery: (query) => client.query(query),
		});

		// Or migrate to max version (optionally can provide 'max')
		const result = await postgrator.migrate();
		if (result.length === 0) {
			console.log('No migrations run for schema "public". Already at the latest one.');
		}
		console.log("Migration done.");
	} catch (error) {
		// If error happened partially through migrations,
		// error object is decorated with appliedMigrations
		console.error(`An error occurred: ${error}`); // array of migration objects
		process.exit(1);
	}

	// Once done migrating, close your connection.
	await client.end();
}
main();
