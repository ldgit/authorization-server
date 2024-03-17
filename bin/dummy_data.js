import * as argon2 from "argon2";
import pg from "pg";

async function run() {
  const password = 'test'
  const client = new pg.Client({
    host: "localhost",
    port: 5432,
    database: "authorization_db",
    user: "user",
    password: "S3cret",
  });
  await client.connect();
  await client.query('TRUNCATE users');

  console.log('Creating dummy data ');
  
  try {
    await client.query('BEGIN');
    const queryText = 'INSERT INTO users(firstname, lastname, username, "password") VALUES($1, $2, $3, $4) RETURNING id';
    let hash = await argon2.hash(password);
    await client.query(queryText, ['john', 'roe', 'jRoe42', hash])
    console.log('Created user jRoe42');
    hash = await argon2.hash(password);
    await client.query(queryText, ['jane', 'doe', 'jDoe', hash])
    console.log('Created user jDoe');
    hash = await argon2.hash(password);
    await client.query(queryText, ['jack', 'hoe', 'jHoe80', hash])
    console.log('Created user jHoe80');
    console.log('All users use same password: "test"');

    await client.query('COMMIT')
    console.log('Dummy data created successfully.');
  } catch (error) {
    console.log('Error encountered, rolling back created data.');
    await client.query('ROLLBACK');
    console.log('ERROR: ' + error);
  } finally {
    client.end();
  }

  console.log('Dummy data creation finished')
}

run();
