import { beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { transactionQuery, query } from './adapter.ts';
import { QueryResult } from 'pg';

describe('database adapter', () => {
  beforeAll(async () => {
    query('TRUNCATE users');
  });

  it('transactionQuery should insert a user into the database', async () => {
    let expectedUserId = '';

    const result = await transactionQuery(async (client) => {
      expectedUserId = uuidv4();
      return await client.query('INSERT INTO users(id, firstname, lastname, username, "password") VALUES($1, $2, $3, $4, $5) RETURNING id', [
        expectedUserId, 'Jane', 'Doe', 'user1', 'lets pretend this is a password hash',
      ]);
    }) as QueryResult;

    expect(result.rowCount).toEqual(1);
    expect(result.rows[0].id).toEqual(expectedUserId);
  });

  it('transactionQuery should rollback all changes in case of query failure', async () => {
    let firstUserId = '';

    const invalidInsertion = async () =>
    await transactionQuery(async (client) => {
      firstUserId = uuidv4();
      await client.query('INSERT INTO users(id, firstname, lastname, username, "password") VALUES($1, $2, $3, $4, $5) RETURNING id', [
        firstUserId, 'Jill', 'Doe', 'user2', 'lets pretend this is a password hash',
      ]);
      // This one should fail because of unique constraint on `username` field.
      await client.query('INSERT INTO users(id, firstname, lastname, username, "password") VALUES($1, $2, $3, $4, $5) RETURNING id', [
        uuidv4(), 'Jack', 'Doe', 'user2', 'lets pretend this is a password hash',
      ]);
    });

    await expect(async () => await invalidInsertion()).rejects.toThrowError('duplicate key value violates unique constraint "users_username_key"');
    const result = await query('SELECT * FROM users WHERE id=$1::uuid', [firstUserId])
    expect(result.rowCount).toEqual(0);
  });

  it('transactionQuery should release clients', async () => {
    for (let index = 0; index < 100; index++) {
      await transactionQuery(async (client) => { return await client.query('SELECT * FROM users'); })
    }
  });

  it('transactionQuery should rollback all changes in case of code error', async () => {
    let firstUserId = '';

    const invalidInsertion = async () =>
    await transactionQuery(async (client) => {
      firstUserId = uuidv4();
      await client.query('INSERT INTO users(id, firstname, lastname, username, "password") VALUES($1, $2, $3, $4, $5) RETURNING id', [
        firstUserId, 'Jill', 'Doe', 'user2', 'lets pretend this is a password hash',
      ]);
      
      throw new Error('test')
    })

    await expect(async () => await invalidInsertion()).rejects.toThrowError('test');
    const result = await query('SELECT * FROM users WHERE id=$1::uuid', [firstUserId])
    expect(result.rowCount).toEqual(0);
  });
})


