import 'dotenv/config';
import * as argon2 from "argon2";
import * as db from '../database/adapter.ts';

const password = 'test'

await db.query('TRUNCATE users');

console.log('Creating dummy data ');

await db.transactionQuery(async (client) => {
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
}, { destroyClient: true });

console.log('Dummy data created successfully.');
