import 'dotenv/config';
import Fastify from 'fastify';
import {query} from './database/adapter.ts';

const fastify = Fastify({
  logger: true
});

fastify.get('/', (req, reply) => {
  reply.send({ message: "Hello world"})
})

fastify.get('/user', async function (req, reply) {
  const result = await query('SELECT * FROM users')
  reply.send(result.rows);
})

fastify.listen({ port: 3000 }, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
