import { createHash } from "node:crypto";
import { URL } from "node:url";
import { type Page, expect, request, test } from "@playwright/test";
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

async function signInUser(page: Page, username: string, password: string) {
	await page.goto("/login");
	await page.getByLabel(/Username/).fill(username);
	await page.getByLabel(/Password/).fill(password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL("/");
}

// TODO remove this?
test.setTimeout(4000);

/**
 * We use PKCE flow.
 *
 * @see https://www.oauth.com/playground/authorization-code-with-pkce.html.
 */
test("oauth2 flow happy path", async ({ page, baseURL }) => {
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
		`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);

	// User is taken to the login page to sign in first while preserving the query parameters.
	await page.waitForURL(
		`/login?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByLabel(/Password/).fill("test");
	await page.getByRole("button", { name: "Sign in" }).click();

	// Signed in user is asked to approve the client.
	await page.waitForURL(
		`/authorize?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
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

	const response = await requestAccessToken({
		clientId: id,
		clientSecret: secret,
		authorizationCode,
		redirectUri,
		codeVerifier,
	});
	expect(response.ok()).toBeTruthy();
	const responseJson = await response.json();
	assertAccessTokenResponseFollowsSpecs(responseJson, await response.headers());

	await assertUserinfoEndpointWorks(responseJson.access_token);
});

test("oauth2 flow happy path when the user is already signed in", async ({ page, baseURL }) => {
	// Sign in the user first.
	await signInUser(page, "MarkS", "test");

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
		`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);

	// Signed in user is immediately asked to approve the client.
	await expect(
		page.getByRole("heading", { name: `"${name}" wants to access your user data` }),
	).toBeVisible();
	// User approves the client.
	await page.getByRole("button", { name: "Approve" }).click();

	await page.waitForURL(/\/\?/);
	const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(page.url(), state);

	const response = await requestAccessToken({
		clientId: id,
		clientSecret: secret,
		authorizationCode,
		redirectUri,
		codeVerifier,
	});
	expect(response.ok()).toBeTruthy();
	const responseJson = await response.json();
	assertAccessTokenResponseFollowsSpecs(responseJson, await response.headers());

	await assertUserinfoEndpointWorks(responseJson.access_token);
});

["", "0054478d-431c-4e21-bc48-ffb4c3eb2ac0"].forEach((notAClientId) => {
	test(`authorization endpoint should should warn resource owner (user) if client doesn't exists (${notAClientId})`, async ({
		page,
	}) => {
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
		const state = cryptoRandomString({ length: 16, type: "alphanumeric" });

		await page.goto(
			`/authorize?response_type=code&client_id=${notAClientId}&redirect_uri=https://www.google.com&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
		);

		await page.waitForURL(
			`/error/client-id?response_type=code&client_id=${notAClientId}&redirect_uri=${encodeURIComponent("https://www.google.com")}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
		);
		await expect(page.getByRole("heading", { name: "Error" })).toBeVisible();
		await expect(
			page.getByRole("heading", { name: `Client with "${notAClientId}" id does not exist.` }),
		).toBeVisible();
	});

	test(`authorization endpoint should should warn resource owner (user) if client doesn't exists (${notAClientId}) even if other parameters are missing`, async ({
		page,
	}) => {
		await page.goto(`/authorize?client_id=${notAClientId}&redirect_uri=https://www.google.com`);

		await page.waitForURL(
			`/error/client-id?client_id=${notAClientId}&redirect_uri=${encodeURIComponent("https://www.google.com")}`,
		);
		await expect(page.getByRole("heading", { name: "Error" })).toBeVisible();
		await expect(
			page.getByRole("heading", { name: `Client with "${notAClientId}" id does not exist.` }),
		).toBeVisible();
	});
});

test("authorization endpoint should warn resource owner (user) about the incorrect redirect_uri", async ({
	page,
	baseURL,
}) => {
	const { id } = await createTestClient(baseURL as string);
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });

	await page.goto(
		`/authorize?response_type=code&client_id=${id}&redirect_uri=https://www.google.com&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);

	await page.waitForURL(
		`/error/redirect-uri?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent("https://www.google.com")}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	await expect(page.getByRole("heading", { name: "Error" })).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "The redirect_uri query parameter is missing or not allowed.",
		}),
	).toBeVisible();
});

test("authorization endpoint should warn resource owner (user) about the incorrect redirect_uri even if every other query param is missing", async ({
	page,
	baseURL,
}) => {
	const { id } = await createTestClient(baseURL as string);

	await page.goto(`/authorize?client_id=${id}&redirect_uri=https://www.google.com`);

	await page.waitForURL(
		`/error/redirect-uri?client_id=${id}&redirect_uri=${encodeURIComponent("https://www.google.com")}`,
	);
	await expect(page.getByRole("heading", { name: "Error" })).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "The redirect_uri query parameter is missing or not allowed.",
		}),
	).toBeVisible();
});

const validPKCEChallenge = "B3b_JHueqI6LBp_WhuR7NfViLSgGVeXBpfpEMjoSdok";
[
	{
		description: "unsupported response_type",
		invalidQueryString: `response_type=token&scope=openid&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S256`,
		expectedError: "unsupported_response_type",
	},
	{
		description: "invalid response_type",
		invalidQueryString: `response_type=qwerty&scope=openid&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S256`,
		expectedError: "invalid_request",
	},
	{
		description: "missing response_type",
		invalidQueryString: `scope=openid&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S256`,
		expectedError: "invalid_request",
	},
	{
		description: "duplicate response_type",
		invalidQueryString: `response_type=code&scope=openid&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S256&response_type=code`,
		expectedError: "invalid_request",
	},
	{
		description: "invalid scope",
		invalidQueryString: `response_type=code&scope=full-info&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S256`,
		expectedError: "invalid_scope",
	},
	{
		description: "missing scope",
		invalidQueryString: `response_type=code&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S256`,
		expectedError: "invalid_request",
	},
	{
		description: "duplicate scope",
		invalidQueryString: `response_type=code&scope=openid&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S256&scope=openid`,
		expectedError: "invalid_request",
	},
	{
		description: "missing code_challenge",
		invalidQueryString:
			"response_type=code&scope=openid&state=validState&code_challenge_method=S256",
		expectedError: "invalid_request",
	},
	{
		description: "unsupported code_challenge",
		invalidQueryString:
			"response_type=code&scope=openid&state=validState&code_challenge=&code_challenge_method=S256",
		expectedError: "invalid_request",
	},
	{
		description: "duplicate code_challenge",
		invalidQueryString: `response_type=code&scope=openid&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S256&code_challenge=${validPKCEChallenge}`,
		expectedError: "invalid_request",
	},
	{
		description: "unsupported code_challenge_method",
		invalidQueryString: `response_type=code&scope=openid&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S224`,
		expectedError: "invalid_request",
	},
	{
		description: "missing code_challenge_method",
		invalidQueryString: `response_type=code&scope=openid&state=validState&code_challenge=${validPKCEChallenge}`,
		expectedError: "invalid_request",
	},
	{
		description: "duplicate code_challenge_method",
		invalidQueryString: `response_type=code&code_challenge_method=S256&scope=openid&state=validState&code_challenge=${validPKCEChallenge}&code_challenge_method=S256`,
		expectedError: "invalid_request",
	},
].forEach(({ description, invalidQueryString, expectedError }) => {
	test(`GET /authorize endpoint should redirect back with ${expectedError} error in case of ${description} (${invalidQueryString})`, async ({
		page,
		baseURL,
	}) => {
		// We don't need to sign in the user for this test, these checks are performed before the user check.
		const { id, redirectUri } = await createTestClient(baseURL as string);

		await page.goto(`/authorize?client_id=${id}&redirect_uri=${redirectUri}&${invalidQueryString}`);

		await page.waitForURL(/\/\?/);

		const expectedRedirectUri = new URL(page.url());
		expect(expectedRedirectUri.searchParams.get("error")).toEqual(expectedError);
		expect(expectedRedirectUri.searchParams.get("code")).toBeNull();
		await expect(expectedRedirectUri.searchParams.get("state")).toEqual("validState");
	});

	test(`POST /authorize endpoint should redirect back with ${expectedError} error in case of ${description} (${invalidQueryString})`, async ({
		page,
		baseURL,
	}) => {
		const { id, redirectUri } = await createTestClient(baseURL as string);
		await signInUser(page, "MarkS", "test");

		const response = await page.request.post(
			`/authorize?client_id=${id}&redirect_uri=${redirectUri}&${invalidQueryString}`,
			{
				form: { approved: "" },
				maxRedirects: 0,
			},
		);

		expect(response.status()).toEqual(302);
		expect(response.headers().location).toContain(redirectUri);
		const expectedRedirectUri = new URL(response.headers().location);
		expect(expectedRedirectUri.searchParams.get("error")).toEqual(expectedError);
		expect(expectedRedirectUri.searchParams.get("code")).toBeNull();
		expect(expectedRedirectUri.searchParams.get("state")).toEqual("validState");
	});
});

test("POST /authorize endpoint should return 403 error if user is not signed in", async ({
	page,
}) => {
	// We make the request with a invalid query string because we want to check if user is signed in first.
	const response = await page.request.post("/authorize", {
		form: { approved: "" },
		maxRedirects: 0,
	});

	expect(response.status()).toEqual(403);
	expect(response.statusText()).toEqual("Forbidden");
});

test("/authorize endpoint should redirect with access_denied error code if user denies the authorization request", async ({
	page,
	baseURL,
}) => {
	await signInUser(page, "MarkS", "test");

	const { id, name, redirectUri } = await createTestClient(baseURL as string);
	const codeVerifier = generateCodeVerifier();
	// Create code challenge from code verifier.
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	// State can just be a random string for test purposes.
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });

	/** Request an authorization token. */
	await page.goto(
		`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);

	// Signed in user is asked to approve the client, but denies access instead.
	await expect(
		page.getByRole("heading", { name: `"${name}" wants to access your user data` }),
	).toBeVisible();
	// User approves the client.
	await page.getByRole("button", { name: "Deny" }).click();

	await page.waitForURL(/\/\?/);
	const { protocol, host, pathname, searchParams } = new URL(page.url());
	const actualRedirectUri = `${protocol}//${host}${pathname}`;
	expect(actualRedirectUri).toEqual(redirectUri);
	// We verify the data in the redirect_uri query string is there.
	expect(searchParams.get("code")).toBeNull();
	expect(searchParams.get("state")).toEqual(state);
	expect(searchParams.get("error")).toEqual("access_denied");
});

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

function generateCodeVerifier() {
	return cryptoRandomString({
		length: 64,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});
}

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
 *
 * send user's cookies. These endpoints are "back channel", ie. they are not meant to be accessed by user's browser
 *
 * @see https://playwright.dev/docs/api/class-fixtures#fixtures-request
 */

/**
 * Using the authorization code we received we request an access token from the authorization server.
 *
 * The client is authenticated by the auth server using Basic Authentication Scheme as described in RFC2617.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc2617#section-2
 * @see https://playwright.dev/docs/api-testing#using-request-context We deliberately create new request context
 * so we don't accidentally send user's session cookie in the API request.
 */
async function requestAccessToken({
	clientId,
	clientSecret,
	redirectUri,
	authorizationCode,
	codeVerifier,
}: any) {
	const apiRequest = await request.newContext();
	return await apiRequest.post("/api/v1/token", {
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

/**
 * @see https://playwright.dev/docs/api-testing#using-request-context We deliberately create new request context
 * so we don't accidentally send user's session cookie in the API request.
 */
async function assertUserinfoEndpointWorks(accessToken: string) {
	const apiRequest = await request.newContext();
	/**
	 * Using the access token fetch basic user info from the resource server.
	 */
	const resourceResponse = await apiRequest.post("/api/v1/userinfo", {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	expect(resourceResponse.ok()).toBeTruthy();
	await expect(await resourceResponse.json()).toEqual({
		username: "MarkS",
		name: "Mark",
		surname: "Scout",
	});
}
