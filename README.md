# Authorization Server

OAuth 2.0 authorization server implementation. Follows specification defined in:
- [IETF RFC 6749 The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749.html) 
- [IETF RFC 6750 The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750.html)

## Development

Steps to run locally:
1. Create the `.env` file from provided example: `cp .env.example .env`
2. Start up the database docker container: `docker-compose up -d`
3. Start up the dev database: `npm run dev-db`
4. Start the local server: `npm run dev`
5. Access in browser on `http://127.0.0.1:3000/`
