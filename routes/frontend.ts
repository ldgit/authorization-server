import Static from '@fastify/static';
import path from 'path';

export default async function frontend(fastify, opts) {
  await fastify.register(Static, {
    root: path.join(import.meta.dirname, '..', 'public'),
    prefix: '/'
  })

  fastify.get('/', async function(req, reply) {
    reply.view("homePage.ejs", { text: "text" });
  })

  function isUserSignedIn(): boolean {
    return false;
  }

  /**
   * Login page.
   */
  fastify.get('/login', async function(req, reply) {
    if(isUserSignedIn()) {
      return reply.redirect('/');
    }

    return reply.view("loginPage.ejs", { text: "world" });
  });

  /**
   * Handles login page submit action.
   */
  fastify.post('/login', async function(req, reply) {

  });
}