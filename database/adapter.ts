import pg from "pg";

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT as unknown as number,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

export function query(query: string, params?: any[]) {
  return pool.query(query, params);
}

interface Client {
  query: (query: string, params?: any[]) => Promise<pg.QueryResult<any>>,
}

type TransactionQueryFunction = (client: Client) => Promise<pg.QueryResult<any>> | Promise<void>

interface TransactionQueryOptions {
  destroyClient: boolean,
}

export async function transactionQuery(func: TransactionQueryFunction, options?: TransactionQueryOptions) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await func(client);
    await client.query('COMMIT');

    return result;
  } catch(error) {
    await client.query('ROLLBACK')
    throw error;
  } finally {
    client.release(options?.destroyClient);
  }
}
