import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import frontendRoutes from './routes/frontend.ts'
import apiRoutes from './routes/api.ts'
import pointOfView from '@fastify/view';
import path from 'path';
import ejs from 'ejs';

const fastify: FastifyInstance = Fastify({
  logger: true
});

fastify.register(pointOfView, {
  engine: { ejs },
  templates: path.join(import.meta.dirname, 'frontend/templates'),
  layout: 'layout.ejs',
})
fastify.register(frontendRoutes);
fastify.register(apiRoutes);

fastify.listen({ port: 3000 }, (err, address) => {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
  console.log(`Server listening on ${fastify.server.address()!.port}`)
})
