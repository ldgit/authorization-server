import { createHash } from "node:crypto";
import { URL } from "node:url";
import { type Page, expect, request, test } from "@playwright/test";
import * as argon2 from "argon2";
import cryptoRandomString from "crypto-random-string";
import { subSeconds } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import {
	DUMMY_CLIENT_ID,
	DUMMY_CLIENT_REDIRECT_URI,
	DUMMY_CLIENT_SECRET,
} from "../database/createDummyData.js";
import { query } from "../database/database.js";
import { createAuthorizationToken } from "../library/oauth2/authorizationToken.js";
import { type UserData, findUserByUsername } from "../library/user.js";
import type { AccessTokenRequestQueryParams } from "../routes/api.js";

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
	expect(response.status()).toEqual(200);
	const responseJson = await response.json();
	assertAccessTokenResponseFollowsSpecs(responseJson, await response.headers());

	await assertUserinfoEndpointWorks(responseJson.access_token, {
		sub: await getUserIdFromUsername("MarkS"),
		preferred_username: "MarkS",
		given_name: "Mark",
		family_name: "Scout",
	});
});

test("oauth2 flow happy path when the user is already signed in", async ({ page, baseURL }) => {
	// Sign in the user first.
	await signInUser(page, "IrvingB", "test");

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
	expect(response.status()).toEqual(200);
	const responseJson = await response.json();
	assertAccessTokenResponseFollowsSpecs(responseJson, await response.headers());

	await assertUserinfoEndpointWorks(responseJson.access_token, {
		sub: await getUserIdFromUsername("IrvingB"),
		preferred_username: "IrvingB",
		given_name: "Irving",
		family_name: "Bailiff",
	});
});

["", "0054478d-431c-4e21-bc48-ffb4c3eb2ac0"].forEach((notAClientId) => {
	test(`/authorize endpoint should should warn resource owner (user) if client doesn't exists (${notAClientId})`, async ({
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

	test(`/authorize endpoint should should warn resource owner (user) if client doesn't exists (${notAClientId}) even if other parameters are missing`, async ({
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

test("/authorize endpoint should warn resource owner (user) about the incorrect redirect_uri", async ({
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

test("/authorize endpoint should warn resource owner (user) about the incorrect redirect_uri even if every other query param is missing", async ({
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

["grant_type", "redirect_uri", "code", "code_verifier"].forEach((missingParameter: string) => {
	test(`/token endpoint should respond with 400 error code if ${missingParameter} parameter is missing`, async ({
		page,
		baseURL,
		request,
	}) => {
		await signInUser(page, "MarkS", "test");
		const { id, redirectUri, secret } = await createTestClient(baseURL as string);
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
		const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
		await page.goto(
			`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
		);
		// User approves the client.
		await page.getByRole("button", { name: "Approve" }).click();
		await page.waitForURL(/\/\?/);
		const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(
			page.url(),
			state,
		);

		const formParameters: AccessTokenRequestQueryParams = {
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
			code: authorizationCode as string,
			code_verifier: codeVerifier,
		};
		delete formParameters[missingParameter as keyof AccessTokenRequestQueryParams];

		const response = await request.post("/api/v1/token", {
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${base64encode(`${id}:${secret}`)}`,
			},
			form: formParameters as any,
		});
		expect(response.status()).toEqual(400);
		expect(response.statusText()).toEqual("Bad Request");
		expect(await response.json()).toEqual({ error: "invalid_request" });
		expectTokenEndpointHeadersAreCorrect(response.headers());
	});
});

test("/token endpoint should respond with 401 error if client credentials are invalid (no authorization header)", async ({
	page,
	request,
}) => {
	await signInUser(page, "MarkS", "test");
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
	await page.goto(
		`/authorize?response_type=code&client_id=${DUMMY_CLIENT_ID}&redirect_uri=${DUMMY_CLIENT_REDIRECT_URI}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	await page.getByRole("button", { name: "Approve" }).click();
	await page.waitForURL(`${DUMMY_CLIENT_REDIRECT_URI}**`);
	const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(page.url(), state);

	const response = await request.post("/api/v1/token", {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		form: {
			grant_type: "authorization_code",
			redirect_uri: DUMMY_CLIENT_REDIRECT_URI,
			code: authorizationCode as string,
			code_verifier: codeVerifier,
		},
	});
	expect(response.status()).toEqual(401);
	expect(response.statusText()).toEqual("Unauthorized");
	expect(response.headers()["www-authenticate"]).toEqual('Basic realm="Client authentication"');
	expect(await response.json()).toEqual({ error: "invalid_client" });
	expectTokenEndpointHeadersAreCorrect(response.headers());
});

test("/token endpoint should respond with 401 error if client credentials are invalid (different client id)", async ({
	page,
	baseURL,
	request,
}) => {
	await signInUser(page, "MarkS", "test");
	// We start authorization as default dummy client, but then use this client's id.
	const differentClient = await createTestClient(baseURL as string);
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
	await page.goto(
		`/authorize?response_type=code&client_id=${DUMMY_CLIENT_ID}&redirect_uri=${DUMMY_CLIENT_REDIRECT_URI}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	await page.getByRole("button", { name: "Approve" }).click();
	await page.waitForURL(`${DUMMY_CLIENT_REDIRECT_URI}**`);
	const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(page.url(), state);

	const response = await request.post("/api/v1/token", {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${base64encode(`${differentClient.id}:${DUMMY_CLIENT_SECRET}`)}`,
		},
		form: {
			grant_type: "authorization_code",
			redirect_uri: DUMMY_CLIENT_REDIRECT_URI,
			code: authorizationCode as string,
			code_verifier: codeVerifier,
		},
	});
	expect(response.status()).toEqual(401);
	expect(response.statusText()).toEqual("Unauthorized");
	expect(response.headers()["www-authenticate"]).toEqual('Basic realm="Client authentication"');
	expect(await response.json()).toEqual({ error: "invalid_client" });
	expectTokenEndpointHeadersAreCorrect(response.headers());
});

[
	["unknown client", { id: "4998308c-071a-4191-abbd-2372b48c9d20", secret: DUMMY_CLIENT_SECRET }],
	["different client secret", { id: DUMMY_CLIENT_ID, secret: "different_secret" }],
].forEach(([description, client]: any) => {
	test(`/token endpoint should respond with 401 error if client credentials are invalid (${description})`, async ({
		page,
		request,
	}) => {
		await signInUser(page, "MarkS", "test");
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
		const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
		await page.goto(
			`/authorize?response_type=code&client_id=${DUMMY_CLIENT_ID}&redirect_uri=${DUMMY_CLIENT_REDIRECT_URI}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
		);
		await page.getByRole("button", { name: "Approve" }).click();
		await page.waitForURL(`${DUMMY_CLIENT_REDIRECT_URI}**`);
		const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(
			page.url(),
			state,
		);

		const response = await request.post("/api/v1/token", {
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${base64encode(`${client.id}:${client.secret}`)}`,
			},
			form: {
				grant_type: "authorization_code",
				redirect_uri: DUMMY_CLIENT_REDIRECT_URI,
				code: authorizationCode as string,
				code_verifier: codeVerifier,
			},
		});
		expect(response.status()).toEqual(401);
		expect(response.statusText()).toEqual("Unauthorized");
		expect(response.headers()["www-authenticate"]).toEqual('Basic realm="Client authentication"');
		expect(await response.json()).toEqual({ error: "invalid_client" });
		expectTokenEndpointHeadersAreCorrect(response.headers());
	});
});

[
	["redirect_uri", "invalid_grant"],
	["code_verifier", "invalid_request"], // Requires working PKCE verification to pass.
].forEach(([parameter, expectedError]) => {
	test(`/token endpoint should respond with 400 error code if ${parameter} parameter has unsupported value`, async ({
		page,
		baseURL,
		request,
	}) => {
		await signInUser(page, "MarkS", "test");
		const { id, redirectUri, secret } = await createTestClient(baseURL as string);
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
		const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
		await page.goto(
			`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
		);
		// User approves the client.
		await page.getByRole("button", { name: "Approve" }).click();
		await page.waitForURL(/\/\?/);
		const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(
			page.url(),
			state,
		);

		const formParameters: any = {
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
			code: authorizationCode as string,
			code_verifier: codeVerifier,
		};
		formParameters[parameter] = "unsupported value";

		const response = await request.post("/api/v1/token", {
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${base64encode(`${id}:${secret}`)}`,
			},
			form: formParameters,
		});
		expect(response.status()).toEqual(400);
		expect(response.statusText()).toEqual("Bad Request");
		expect(await response.json()).toEqual({ error: expectedError });
		expectTokenEndpointHeadersAreCorrect(response.headers());
	});
});

test("/token endpoint should respond with 400 status code and invalid_grant error if code does not exist", async ({
	page,
	baseURL,
	request,
}) => {
	await signInUser(page, "MarkS", "test");
	const { id, redirectUri, secret } = await createTestClient(baseURL as string);
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
	await page.goto(
		`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	// User approves the client.
	await page.getByRole("button", { name: "Approve" }).click();
	await page.waitForURL(/\/\?/);

	const formParameters: any = {
		grant_type: "authorization_code",
		redirect_uri: redirectUri,
		code: "invalid authorization code",
		code_verifier: codeVerifier,
	};

	const response = await request.post("/api/v1/token", {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${base64encode(`${id}:${secret}`)}`,
		},
		form: formParameters,
	});
	expect(response.status()).toEqual(400);
	expect(response.statusText()).toEqual("Bad Request");
	expect(await response.json()).toEqual({ error: "invalid_grant" });
	expectTokenEndpointHeadersAreCorrect(response.headers());
});

test("/token endpoint should respond with 400 status code and invalid_grant error if code is for a different client", async ({
	page,
	baseURL,
	request,
}) => {
	await signInUser(page, "MarkS", "test");
	const { id, redirectUri, secret } = await createTestClient(baseURL as string);
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
	await page.goto(
		`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	// User approves the client.
	await page.getByRole("button", { name: "Approve" }).click();
	await page.waitForURL(/\/\?/);

	// Create authorization token for the dummy client for the same user, to force a client check in production code.
	const userId = (await query("SELECT id FROM users WHERE username = $1", ["MarkS"])).rows[0].id;
	const differentAuthCode = await createAuthorizationToken(
		DUMMY_CLIENT_ID,
		userId,
		"openid",
		codeChallenge,
		"S256",
	);

	const formParameters: any = {
		grant_type: "authorization_code",
		redirect_uri: redirectUri,
		// We send an auth code for a different client.
		code: differentAuthCode,
		code_verifier: codeVerifier,
	};

	const response = await request.post("/api/v1/token", {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${base64encode(`${id}:${secret}`)}`,
		},
		form: formParameters,
	});
	expect(response.status()).toEqual(400);
	expect(response.statusText()).toEqual("Bad Request");
	expect(await response.json()).toEqual({ error: "invalid_grant" });
	expectTokenEndpointHeadersAreCorrect(response.headers());
});

test("/token endpoint should respond with 400 status code and unsupported_grant_type error if grant_type is of unknown value", async ({
	page,
	baseURL,
	request,
}) => {
	await signInUser(page, "MarkS", "test");
	const { id, redirectUri, secret } = await createTestClient(baseURL as string);
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
	await page.goto(
		`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
	);
	// User approves the client.
	await page.getByRole("button", { name: "Approve" }).click();
	await page.waitForURL(/\/\?/);
	const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(page.url(), state);

	const formParameters: any = {
		// We send the wrong grant type.
		grant_type: "client_credentials",
		redirect_uri: redirectUri,
		code: authorizationCode,
		code_verifier: codeVerifier,
	};

	const response = await request.post("/api/v1/token", {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${base64encode(`${id}:${secret}`)}`,
		},
		form: formParameters,
	});
	expect(response.status()).toEqual(400);
	expect(response.statusText()).toEqual("Bad Request");
	expect(await response.json()).toEqual({ error: "unsupported_grant_type" });
	expectTokenEndpointHeadersAreCorrect(response.headers());
});

["redirect_uri", "code_verifier", "code", "grant_type"].forEach((repeatedParameter) => {
	test(`/token endpoint should respond with 400 status code and invalid_request error if ${repeatedParameter} parameter is repeated`, async ({
		page,
		baseURL,
		request,
	}) => {
		await signInUser(page, "MarkS", "test");
		const { id, redirectUri, secret } = await createTestClient(baseURL as string);
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
		const state = cryptoRandomString({ length: 16, type: "alphanumeric" });
		await page.goto(
			`/authorize?response_type=code&client_id=${id}&redirect_uri=${redirectUri}&scope=openid&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
		);
		// User approves the client.
		await page.getByRole("button", { name: "Approve" }).click();
		await page.waitForURL(/\/\?/);
		const authorizationCode = await getAuthorizationCodeFromRedirectUriQueryString(
			page.url(),
			state,
		);

		const formParameters: any = {
			grant_type: "authorization_code",
			redirect_uri: encodeURIComponent(redirectUri),
			code: authorizationCode,
			code_verifier: codeVerifier,
		};
		// Convert formParameters object to application/x-www-form-urlencoded string manually
		// and add the repeated parameter.
		const formString = `${Object.keys(formParameters).reduce((previous, currentKey) => {
			return `${previous}${currentKey}=${formParameters[currentKey]}&`;
		}, "")}${repeatedParameter}=${formParameters[repeatedParameter]}`;

		const response = await request.post("/api/v1/token", {
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${base64encode(`${id}:${secret}`)}`,
			},
			data: formString,
		});
		expect(response.status()).toEqual(400);
		expect(response.statusText()).toEqual("Bad Request");
		expect(await response.json()).toEqual({ error: "invalid_request" });
		expectTokenEndpointHeadersAreCorrect(response.headers());
	});
});

test("/token endpoint should respond with 400 status code and invalid_grant error if authorization code has expired", async ({
	request,
}) => {
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

	const userId = (await query("SELECT id FROM users WHERE username = $1", ["MarkS"])).rows[0].id;
	const authorizationCode = cryptoRandomString({ length: 64, characters: "alphanumeric" });
	// Set up so the user has already approved the authorization request and we manually create the
	// already *expired* authorization code.
	await query(
		"INSERT INTO authorization_tokens(created_at, value, scope, client_id, user_id, code_challenge, code_challenge_method) VALUES($1, $2, $3, $4, $5, $6, $7)",
		[
			subSeconds(new Date(), 121),
			authorizationCode,
			"openid",
			DUMMY_CLIENT_ID,
			userId,
			codeChallenge,
			"S256",
		],
	);

	const formParameters: any = {
		grant_type: "authorization_code",
		redirect_uri: DUMMY_CLIENT_REDIRECT_URI,
		code: authorizationCode,
		code_verifier: codeVerifier,
	};

	const response = await request.post("/api/v1/token", {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${base64encode(`${DUMMY_CLIENT_ID}:${DUMMY_CLIENT_SECRET}`)}`,
		},
		form: formParameters,
	});
	expect(response.status()).toEqual(400);
	expect(response.statusText()).toEqual("Bad Request");
	expect(await response.json()).toEqual({ error: "invalid_grant" });
	expectTokenEndpointHeadersAreCorrect(response.headers());
});

test("/userinfo endpoint should respond with 401 error code if access token is invalid", async ({
	request,
}) => {
	const invalidAccessToken = cryptoRandomString({
		length: 64,
		characters: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~",
	});

	const response = await request.post("/api/v1/userinfo", {
		headers: { Authorization: `Bearer ${base64encode(invalidAccessToken)}` },
	});

	expect(response.status()).toEqual(401);
	expect(response.statusText()).toEqual("Unauthorized");
	expect(response.headers()["www-authenticate"]).toEqual("Bearer");
	expect(await response.json()).toEqual({ error: "invalid_token" });
});

test("/userinfo endpoint should respond with 401 error code if no authentication is provided", async ({
	request,
}) => {
	const response = await request.post("/api/v1/userinfo");

	expect(response.status()).toEqual(401);
	expect(response.statusText()).toEqual("Unauthorized");
	expect(response.headers()["www-authenticate"]).toEqual("Bearer");
	expect(await response.text()).toEqual("");
});

test.skip("/userinfo endpoint should respond with 401 error code if access token has expired", () => {});

/**
 * TODO validation for POST /token tests:
 * + one of the parameters is missing: respond with 400 http status code, `error: invalid_request`
 * + redirect uri does not match: respond with 400 http status code, `error: invalid_grant`
 * + code_verifier is of unsupported value: respond with 400 http status code, `error: invalid_request`
 * + authorization code is invalid: respond with 400 http status code, `error: invalid_grant`
 * + authorization code matches client id: respond with 400 http status code, `error: invalid_grant`
 * + unknown grant type: respond with 400 http status code, `error: unsupported_grant_type`
 * + one of the parameters is repeated: respond with 400 http status code, `error: invalid_request`
 * + authorization code is expired: respond with 400 http status code, `error: invalid_grant`
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
			Authorization: `Basic ${base64encode(`${clientId}:${clientSecret}`)}`,
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
	expect(responseJson.scope).toEqual("openid");
	expectTokenEndpointHeadersAreCorrect(headers);
}

function expectTokenEndpointHeadersAreCorrect(headers: any) {
	expect(headers["cache-control"]).toEqual("no-store");
	expect(headers.pragma).toEqual("no-cache");
	expect(headers["content-type"]).toEqual("application/json; charset=utf-8");
}

/**
 * @see https://playwright.dev/docs/api-testing#using-request-context We deliberately create new request context
 * so we don't accidentally send user's session cookie in the API request.
 */
async function assertUserinfoEndpointWorks(accessToken: string, expectedUserData: any) {
	const apiRequest = await request.newContext();
	/**
	 * Using the access token fetch basic user info from the resource server.
	 */
	const resourceResponse = await apiRequest.post("/api/v1/userinfo", {
		headers: { Authorization: `Bearer ${base64encode(accessToken)}` },
	});
	expect(resourceResponse.ok()).toBeTruthy();
	await expect(await resourceResponse.json()).toEqual(expectedUserData);
}

function base64encode(text: string): string {
	return Buffer.from(text).toString("base64");
}

async function getUserIdFromUsername(username: string): Promise<string> {
	return ((await findUserByUsername(username)) as UserData)?.id;
}
