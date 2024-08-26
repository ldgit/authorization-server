# Authorization Server

[![build](https://github.com/ldgit/authorization-server/actions/workflows/build.yml/badge.svg)](https://github.com/ldgit/authorization-server/actions/workflows/build.yml)

### 🚧🚨 Unfinished WIP 🚨🚧

OAuth 2.0 authorization server implementation. Follows specification defined in:
- [IETF RFC 6749 The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749.html) 
- [IETF RFC 6750 The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750.html)

## Local Development

### First time setup

1. Create the `.env` file: `cp .dev.env .env`.
2. Install npm packages: `npm ci`.
3. `npx playwright install --with-deps` to install Playwright browsers for e2e testing.

### Starting the server 

1. Start up the database docker container: `docker-compose up -d`.
2. Set up the dev database: `npm run dev-db`.
3. Start the local server: `npm run dev`.
4. If working on css styles run `npm run styles -- --watch` separately.
5. Access in browser on `http://127.0.0.1:3000/`.

### Testing

To run unit and integration tests: `npm t`

To run end to end tests:
1. ***Optional*** `npm run dev` to start up the dev server. Playwright will do this automatically if the server is not running, but this is useful if you wish to see server errors in the console.
2. `npm run e2e` to run the tests.

## Tech used

- Fastify web framework
- PostgreSQL for database
- ejs for templating
- Tailwind for styles
- Vitest for unit and integration testing
- Playwright for e2e testing
- biome.js for linting and enforcing code style
