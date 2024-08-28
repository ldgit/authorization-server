import { createHash } from "node:crypto";
import { URL } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import * as argon2 from "argon2";
import cryptoRandomString from "crypto-random-string";
import { v4 as uuidv4 } from "uuid";
import { query } from "../database/database.js";

async function createTestClient(baseURL: string) {
	const secret = cryptoRandomString({ length: 44, type: "alphanumeric" });
	/**
	 * We deliberately use authorization server homepage as client redirect uri.
	 *
	 * Ideally we would use a different domain for client redirect_uri and intercept that redirect through playwright mock API functionality.
	 * Unfortunately this is not possible because playwright won't mock redirect requests by design.
	 *
	 * @see https://github.com/microsoft/playwright/issues/23301
	 * @see https://github.com/microsoft/playwright/pull/3994
	 */
	const redirectUri = `${baseURL}/`;
	const name = `client_name_${uuidv4()}`;

	const id = (
		await query(
			"INSERT INTO clients(name, description, secret, redirect_uri) VALUES($1, $2, $3, $4) RETURNING id",
			[name, "A e2e test client", await argon2.hash(secret), redirectUri],
		)
	).rows[0].id as string;

	return { id, secret, name, redirectUri };
}

function generateCodeVerifier() {
	return cryptoRandomString({
		length: 64,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});
}

// TODO remove this?
test.setTimeout(4000);

/**
 * We use PKCE flow.
 *
 * @see https://www.oauth.com/playground/authorization-code-with-pkce.html.
 */
test("oauth2 flow happy path", async ({ page, browserName, baseURL }) => {
	// TODO remove this
	test.skip(browserName.toLowerCase() !== "firefox", "Test only on Firefox!");

	const { id, name, redirectUri, secret } = await createTestClient(baseURL as string);
	const codeVerifier = generateCodeVerifier();
	// Create code challenge from code verifier.
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	// State can just be a random string for test purposes.
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });

	/**
	 * Start with request for an authorization token.
	 */
	await page.goto(
		`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=basic-info&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);

	// User is taken to the login page to sign in first while preserving the query parameters.
	await page.waitForURL(
		`/login?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=basic-info&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByLabel(/Password/).fill("test");
	await page.getByRole("button", { name: "Sign in" }).click();

	// Signed in user is asked to approve the client.
	await page.waitForURL(
		`/approve?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=basic-info&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	await expect(
		page.getByRole("heading", { name: `"${name}" wants to access your user data` }),
	).toBeVisible();
	// User approves the client.
	await page.getByRole("button", { name: "Approve" }).click();

	/**
	 * Authorization server then redirects us to the client-provided redirect_uri.
	 *
	 * In this case it's the auth server homepage for ease of testing (we pretend that the auth server homepage is the client).
	 */
	await page.waitForURL(/\/\?/);
	const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(page.url(), state);

	const response = await requestAccessToken(page, {
		clientId: id,
		clientSecret: secret,
		authorizationCode,
		redirectUri,
		codeVerifier,
	});
	expect(response.ok()).toBeTruthy();
	const responseJson = await response.json();
	assertAccessTokenResponseFollowsSpecs(responseJson, await response.headers());

	await assertFetchingBasicInfoWorks(page, responseJson.access_token);
});

test("oauth2 flow happy path when the user is already signed in", async ({
	page,
	browserName,
	baseURL,
}) => {
	// TODO remove this
	test.skip(browserName.toLowerCase() !== "firefox", "Test only on Firefox!");

	// Sign in the user first.
	await page.goto("/login");
	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByLabel(/Password/).fill("test");
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL("/");

	const { id, name, redirectUri, secret } = await createTestClient(baseURL as string);
	const codeVerifier = generateCodeVerifier();
	// Create code challenge from code verifier.
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	// State can just be a random string for test purposes.
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });

	/**
	 * Start with request for an authorization token.
	 */
	await page.goto(
		`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=basic-info&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);

	// Signed in user is immediately asked to approve the client.
	await page.waitForURL(
		`/approve?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=basic-info&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	await expect(
		page.getByRole("heading", { name: `"${name}" wants to access your user data` }),
	).toBeVisible();
	// User approves the client.
	await page.getByRole("button", { name: "Approve" }).click();

	await page.waitForURL(/\/\?/);
	const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(page.url(), state);

	const response = await requestAccessToken(page, {
		clientId: id,
		clientSecret: secret,
		authorizationCode,
		redirectUri,
		codeVerifier,
	});
	expect(response.ok()).toBeTruthy();
	const responseJson = await response.json();
	assertAccessTokenResponseFollowsSpecs(responseJson, await response.headers());

	await assertFetchingBasicInfoWorks(page, responseJson.access_token);
});

test("authorization endpoint should should warn resource owner (user) if client doesn't exists", async ({
	page,
	browserName,
}) => {
	// TODO remove this
	test.skip(browserName.toLowerCase() !== "firefox", "Test only on Firefox!");
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
	const notAClientId = "0054478d-431c-4e21-bc48-ffb4c3eb2ac0";

	await page.goto(
		`/authorize?response_type=code&client_id=${notAClientId}&redirect_uri=https://www.google.com&scope=basic-info&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);

	await page.waitForURL(
		`/error/client-id?response_type=code&client_id=${notAClientId}&redirect_uri=${encodeURIComponent("https://www.google.com")}&scope=basic-info&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	await expect(page.getByRole("heading", { name: "Error" })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: `Client with "${notAClientId}" id does not exist.` }),
	).toBeVisible();
});

test("authorization endpoint should warn resource owner (user) about the incorrect redirect_uri", async ({
	page,
	browserName,
	baseURL,
}) => {
	// TODO remove this
	test.skip(browserName.toLowerCase() !== "firefox", "Test only on Firefox!");

	const { id } = await createTestClient(baseURL as string);
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });

	await page.goto(
		`/authorize?response_type=code&client_id=${id}&redirect_uri=https://www.google.com&scope=basic-info&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);

	await page.waitForURL(
		`/error/redirect-uri?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent("https://www.google.com")}&scope=basic-info&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	await expect(page.getByRole("heading", { name: "Error" })).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "The redirect_uri query parameter is missing or not allowed.",
		}),
	).toBeVisible();
});

async function getAuthorizationCodeFromRedirectUriQueryString(
	url: string,
	expectedState: string,
): Promise<string> {
	// We verify the data in the redirect_uri query string is there.
	const expectedRedirectUri = new URL(url);
	const authorizationCode = expectedRedirectUri.searchParams.get("code");
	await expect(expectedRedirectUri.searchParams.get("state")).toEqual(expectedState);
	// Check that we received the authorization code token.
	await expect(authorizationCode?.length).toBeGreaterThan(10);

	return authorizationCode as string;
}

/**
 * Using the authorization code we received we request an access token from the authorization server.
 *
 * The client is authenticated by the auth server using Basic Authentication Scheme as described in RFC2617.
 * @see https://datatracker.ietf.org/doc/html/rfc2617#section-2
 */
async function requestAccessToken(
	page: Page,
	{ clientId, clientSecret, redirectUri, authorizationCode, codeVerifier }: any,
) {
	return await page.request.post("/api/v1/token", {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
		},
		form: {
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
			code: authorizationCode as string,
			code_verifier: codeVerifier,
		},
	});
}

/**
 * Verify that access token response follows rfc6749 specification.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749.html#section-5.1
 */
function assertAccessTokenResponseFollowsSpecs(responseJson: any, headers: any) {
	expect(responseJson.access_token).not.toBeFalsy();
	expect(responseJson.token_type).toEqual("Bearer");
	expect(responseJson.expires_in).toEqual(86400);
	expect(responseJson.scope).toEqual("basic_info");
	expect(headers["cache-control"]).toEqual("no-store");
	expect(headers.pragma).toEqual("no-cache");
	expect(headers["content-type"]).toEqual("application/json; charset=utf-8");
}

async function assertFetchingBasicInfoWorks(page: Page, accessToken: string) {
	/**
	 * Using the access token fetch basic user info from the resource server.
	 */
	const resourceResponse = await page.request.post("/api/v1/resource/basic-info", {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	expect(resourceResponse.ok()).toBeTruthy();
	expect(await resourceResponse.json()).toEqual({
		username: "MarkS",
		name: "Mark",
		surname: "Scout",
	});
}

/**
 * TODO validation for authorization endpoint:
 * - if client parameter other than redirect uri is invalid, redirect back to client with just state param and error param where error is documented here https://datatracker.ietf.org/doc/html/rfc6749.html#section-4.1.2.1
 * - when redirecting back to redirect_uri, ignore existing query parameters and just add your own
 */

/**
 * TODO validation for POST /token tests:
 * - one of the parameters is missing: respond with 400 http status code, `error: invalid_request`
 * - one of the parameters unsupported: respond with 400 http status code, `error: invalid_request`
 * - one of the parameters is repeated: respond with 400 http status code, `error: invalid_request`
 * - redirect uri does not match: respond with 400 http status code, `error: invalid_grant`
 * - authorization code is invalid or expired: respond with 400 http status code, `error: invalid_grant`
 * - unknown grant type: respond with 400 http status code, `error: unsupported_grant_type`
 * - if access token is requested twice for the same auth code, access_token is invalidated and user must sign in again
 */
