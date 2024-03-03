import Fastify from 'fastify';
import fastifyPostgres from '@fastify/postgres';

const fastify = Fastify({
  logger: true
});

fastify.register(fastifyPostgres, {
  connectionString: 'postgresql://user:S3cret@localhost:5432/postgres'
})

fastify.get('/', (req, reply) => {
  reply.send({ message: "Hello world"})
})

fastify.get('/user', function (req, reply) {
  fastify.pg.query(
    'SELECT * FROM pg_catalog.pg_tables',
    function onResult (err, result) {
      reply.send(err || result)
    }
  )
})

fastify.listen({ port: 3000 }, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
