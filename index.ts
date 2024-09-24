import "dotenv/config";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import type { FastifyCookieOptions } from "@fastify/cookie";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import pointOfView from "@fastify/view";
import ejs from "ejs";
import Fastify, { type FastifyInstance } from "fastify";
import apiRoutes from "./routes/api.js";
import frontendRoutes from "./routes/frontend.js";

const fastify: FastifyInstance = Fastify({
	logger: true,
}).withTypeProvider<TypeBoxTypeProvider>();

fastify.register(helmet, {
	contentSecurityPolicy: {
		directives: {
			// Not needed because all our requests will already be https in production.
			// Also breaks Safari when accessing localhost.
			upgradeInsecureRequests: null,
		},
	},
	// For some reason setting this option to true makes Playwright tests occasionally timeout
	// on page.goto commands.
	crossOriginOpenerPolicy: false,
});

/**
 * @todo store an actual session secret in env
 * @todo use secure: true in prod env
 */
fastify.register(fastifyCookie, {
	secret: "my-secret", // for cookies signature
	parseOptions: {}, // options for parsing cookies
} as FastifyCookieOptions);
fastify.register(formbody);

fastify.register(pointOfView, {
	engine: { ejs },
	templates: path.join(import.meta.dirname, "frontend/templates"),
	layout: "layout.ejs",
});
fastify.register(frontendRoutes);
fastify.register(apiRoutes, { prefix: "/api/v1" });

fastify.listen({ port: 3000 }, (err, address) => {
	if (err) {
		fastify.log.error(err);
		process.exit(1);
	}
	console.log(`Server listening on ${address}`);
});
