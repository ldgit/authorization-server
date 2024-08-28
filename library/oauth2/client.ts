import { validate as isValidUUID } from "uuid";
import { query } from "../../database/database.js";

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
} | null {
	if (!authorizationHeader) {
		return null;
	}

	const [authorizationType, base64EncodedCredentials] = authorizationHeader.split(" ");

	if (authorizationType !== "Basic") {
		return null;
	}

	const credentials = atob(base64EncodedCredentials);
	const [clientId, clientSecret] = credentials.split(":");

	if (!clientSecret || !clientId) {
		return null;
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
