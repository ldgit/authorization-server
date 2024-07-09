import { FastifyRequest } from "fastify";
import { query } from "../database/adapter.js";

export async function isUserSignedIn(request: FastifyRequest): Promise<boolean> {
  const user = await getSignedInUser(request);

  return !!user;
}

export interface User {
  id: string,
  username: string,
  name: string,
  surname: string,
}

export async function getSignedInUser(request: FastifyRequest): Promise<User|null> {
  const sessionId = request.cookies.session;
    if (!sessionId) {
      return null;
    }

    const result = (await query(`
      SELECT users.id, sessions.user_id, users.username, users.firstname, users.lastname 
      FROM sessions 
      JOIN users ON users.id = sessions.user_id 
      WHERE sessions.id = $1
    `, [sessionId]));

    if(result.rowCount !== 1) {
      return null;
    }

    const userRow = result.rows[0]
    return {
      id: userRow.id as string,
      username: userRow.username as string,
      name: userRow.firstname as string,
      surname: userRow.lastname as string,
    };
}
