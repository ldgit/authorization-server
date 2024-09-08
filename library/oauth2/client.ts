import { validate as isValidUUID } from "uuid";
import { query } from "../../database/database.js";
import type { AuthorizationResponseErrorType } from "../../routes/frontend.js";

export interface Client {
	id: string;
	name: string;
	redirectUri: string;
	secret: string;
	description: string;
}

export async function getClientById(id: string): Promise<Client | null> {
	if (!isValidUUID(id)) {
		return null;
	}

	const result = await query(
		"SELECT id, name, redirect_uri, secret, description FROM clients WHERE id = $1",
		[id],
	);

	if (result.rowCount !== 1) {
		return null;
	}

	const client = result.rows[0];

	return {
		id: client.id,
		redirectUri: client.redirect_uri,
		name: client.name,
		secret: client.secret,
		description: client.description,
	};
}

export async function clientExists(clientId: string | undefined): Promise<boolean> {
	if (!clientId || !isValidUUID(clientId)) {
		return false;
	}

	const exists = await query("SELECT EXISTS(SELECT 1 FROM clients WHERE id = $1)", [clientId]);

	return exists.rows[0].exists;
}

/**
 * @param authorizationHeader Authorization request header that uses RFC2617 Basic Authentication Scheme.
 * @see https://datatracker.ietf.org/doc/html/rfc2617#section-2
 */
export function extractClientCredentials(authorizationHeader: string | undefined): {
	clientId: string;
	clientSecret: string;
} {
	if (!authorizationHeader) {
		return { clientId: "", clientSecret: "" };
	}

	const [authorizationType, base64EncodedCredentials] = authorizationHeader.split(" ");

	if (authorizationType !== "Basic") {
		return { clientId: "", clientSecret: "" };
	}

	const credentials = atob(base64EncodedCredentials);
	const [clientId, clientSecret] = credentials.split(":");

	if (!clientSecret || !clientId) {
		return { clientId: "", clientSecret: "" };
	}

	return { clientId, clientSecret };
}

export async function isRedirectUriValid(clientId: string, redirectUri: string): Promise<boolean> {
	const clientData = await query("SELECT id, redirect_uri FROM clients WHERE id = $1", [clientId]);
	if (clientData.rowCount !== 1) {
		throw new Error(`Client with id ${clientId} not found.`);
	}

	const clientRedirectUri = clientData.rows[0].redirect_uri;
	if (clientRedirectUri !== redirectUri) {
		return false;
	}

	return true;
}

/**
 * Attaches `error` parameter to `redirect_uri` query string with relevant `errorType`.
 *
 * If a `state` parameter is provided it is attached as well.
 * All original query parameters in the `redirect_uri` are preserved.
 *
 * @returns `redirect_uri` with error data added to query string
 */
export function attachErrorInformationToRedirectUri(
	redirectUri: string,
	state: string,
	errorType: AuthorizationResponseErrorType,
): string {
	const redirectUrl = new URL(redirectUri);
	const searchParams = redirectUrl.searchParams;

	if (state) {
		searchParams.append("state", state);
	}
	searchParams.append("error", errorType);

	return redirectUrl.toString();
}
