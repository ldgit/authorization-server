import { afterAll, describe, expect, it } from 'vitest';
import { getSignedInUser, isUserSignedIn } from './authentication.ts';
import { v4 as uuidv4 } from 'uuid';
import { query } from "../database/adapter.js";
import { FastifyRequest } from 'fastify';

describe.only('authentication plugin', () => {
  const userIds: string[] = [];
  const sessionIds: string[] = [];

  afterAll(async function () {
    await query(`DELETE FROM sessions WHERE id IN (${sessionIds.map(sessionId => `'${sessionId}'`).join(', ')})`);
    await query(`DELETE FROM users WHERE id IN (${userIds.map(userId => `'${userId}'`).join(', ')})`);
  })

  it('isUserSignedIn should return false if session is empty', async () => {
    const request = { cookies: { session: undefined } } as unknown as FastifyRequest;
    expect(await isUserSignedIn(request)).toStrictEqual(false);
  })

  it('isUserSignedIn should return false if session id not in database', async () => {
    const request = { cookies: { session: uuidv4() } } as unknown as FastifyRequest;
    expect(await isUserSignedIn(request)).toStrictEqual(false);
  })

  it('isUserSignedIn should return true if session id in database', async () => {
    const userId = (await query(
      'INSERT INTO users(firstname, lastname, username, "password") VALUES($1, $2, $3, $4) RETURNING id', 
      ['Burt', 'Goodman', 'BurtG', 'password hash']
    )).rows[0].id as string;
    userIds.push(userId);
    const sessionId = (await query(
      'INSERT INTO sessions(user_id) VALUES($1) RETURNING id', 
      [userId]
    )).rows[0].id as string;
    sessionIds.push(sessionId);
    const request = { cookies: { session: sessionId } } as unknown as FastifyRequest;

    expect(await isUserSignedIn(request)).toStrictEqual(true);
  })
  
  it('getSignedInUser should return null if session is empty', async () => {
    const request = { cookies: { session: undefined } } as unknown as FastifyRequest;
    expect(await getSignedInUser(request)).toStrictEqual(null);
  })

  it('getSignedInUser should return null if session id not in database', async () => {
    const request = { cookies: { session: uuidv4() } } as unknown as FastifyRequest;
    expect(await getSignedInUser(request)).toStrictEqual(null);
  })

  it('getSignedInUser should return the user if session id in database', async () => {
    const userId = (await query(
      'INSERT INTO users(firstname, lastname, username, "password") VALUES($1, $2, $3, $4) RETURNING id', 
      ['Dylan', 'George', 'DylanG', 'password hash']
    )).rows[0].id as string;
    userIds.push(userId);
    const sessionId = (await query(
      'INSERT INTO sessions(user_id) VALUES($1) RETURNING id', 
      [userId]
    )).rows[0].id as string;
    sessionIds.push(sessionId);
    const request = { cookies: { session: sessionId } } as unknown as FastifyRequest;

    expect(await getSignedInUser(request)).toEqual({
      id: userId,
      name: 'Dylan',
      surname: 'George',
      username: 'DylanG',
    });
  })

})
