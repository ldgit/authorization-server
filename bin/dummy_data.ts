import 'dotenv/config';
import * as argon2 from "argon2";
import * as db from '../database/adapter.ts';

async function createDummyData() {
  const password = 'test';
  await db.query('TRUNCATE clients');
  await db.query('TRUNCATE sessions, users');
  
  console.log('Creating dummy data ');
  
  await db.transactionQuery(async (client) => {
    const queryText = 'INSERT INTO users(firstname, lastname, username, "password") VALUES($1, $2, $3, $4) RETURNING id';

    let hash = await argon2.hash(password);
    await client.query(queryText, ['Mark', 'Scout', 'MarkS', hash])
    console.log('Created user MarkS');
    hash = await argon2.hash(password);
    await client.query(queryText, ['Helly', 'Riggs', 'HellyR', hash])
    console.log('Created user HellyR');
    hash = await argon2.hash(password);
    await client.query(queryText, ['Irving', 'Bailiff', 'IrvingB', hash])
    console.log('Created user IrvingB');
    console.log('All users use same password: "test"');
  }, { destroyClient: true });
  
  console.log('Dummy data created successfully.');
}

createDummyData();
