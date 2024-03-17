import Postgrator from "postgrator";
import pg from "pg";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // Create a client of your choice
  const client = new pg.Client({
    host: "localhost",
    port: 5432,
    database: "authorization_db",
    user: "user",
    password: "S3cret",
  });

  try {
    await client.connect();
    const postgrator = new Postgrator({
      migrationPattern: __dirname + "/../migrations/*",
      driver: "pg",
      database: "authorization_db",
      schemaTable: "migrations",
      currentSchema: 'public',
      execQuery: (query) => client.query(query),
    });

    // Or migrate to max version (optionally can provide 'max')
    const result = await postgrator.migrate()
    if (result.length === 0) {
      console.log(
        'No migrations run for schema "public". Already at the latest one.'
      )
    }
    console.log('Migration done.')
  } catch (error) {
    // If error happened partially through migrations,
    // error object is decorated with appliedMigrations
    console.error('An error occurred: ' + error); // array of migration objects
  }

  // Once done migrating, close your connection.
  await client.end();
}
main();