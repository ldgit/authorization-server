# Authorization Server

### 🚧🚨 Unfinished WIP 🚨🚧

OAuth 2.0 authorization server implementation. Follows specification defined in:
- [IETF RFC 6749 The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749.html) 
- [IETF RFC 6750 The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750.html)

## Local Development

Steps to run the app:
1. Create the `.env` file from provided example: `cp .env.example .env`
2. Start up the database docker container: `docker-compose up -d`
3. Set up the dev database: `npm run dev-db`
4. Start the local server: `npm run dev`
5. If working on css styles run `npm run styles -- --watch` separately.
6. Access in browser on `http://127.0.0.1:3000/`

## Tech used

- Fastify web framework
- PostgreSQL for database
- ejs for templating
- Tailwind for styles
- biome.js for linting and enforcing code style
