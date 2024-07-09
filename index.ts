import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import frontendRoutes from './routes/frontend.ts'
import apiRoutes from './routes/api.ts'
import pointOfView from '@fastify/view';
import path from 'path';
import ejs from 'ejs';
import formbody from "@fastify/formbody";
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import fastifyCookie from '@fastify/cookie';
import type { FastifyCookieOptions } from '@fastify/cookie'

const fastify: FastifyInstance = Fastify({
  logger: true
}).withTypeProvider<TypeBoxTypeProvider>();

/** 
 * @todo store an actual session secret in env 
 * @todo use secure: true in prod env
 */
fastify.register(fastifyCookie, {
  secret: "my-secret", // for cookies signature
  parseOptions: {}     // options for parsing cookies
} as FastifyCookieOptions);
fastify.register(formbody);
fastify.register(apiRoutes);

fastify.register(pointOfView, {
  engine: { ejs },
  templates: path.join(import.meta.dirname, 'frontend/templates'),
  layout: 'layout.ejs',
});
fastify.register(frontendRoutes);

fastify.listen({ port: 3000 }, (err) => {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
  console.log(`Server listening on ${fastify.server.address()!.port}`)
})
