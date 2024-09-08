import { describe, expect, it } from "vitest";
import { DUMMY_CLIENT_ID, DUMMY_CLIENT_REDIRECT_URI } from "../../database/createDummyData.js";
import type { AuthorizationResponseErrorType } from "../../routes/frontend.js";
import {
	attachErrorInformationToRedirectUri,
	clientExists,
	extractClientCredentials,
	isRedirectUriValid,
} from "./client.js";

describe("client authentication", () => {
	it("clientExists should return false if provided client id is undefined or not in database", async () => {
		expect(await clientExists(undefined)).toEqual(false);
		expect(await clientExists("a17d060f-607a-47eb-9113-0f6402dcf089")).toEqual(false);
		expect(await clientExists("")).toEqual(false);
		expect(await clientExists("jdfhercndsjkvcns")).toEqual(false);
	});

	it("clientExists should return true if provided client id exists in database", async () => {
		expect(await clientExists(DUMMY_CLIENT_ID)).toEqual(true);
	});

	it("extractClientCredentials should extract client credentials from an authorization request header", () => {
		const clientCredentials = extractClientCredentials(
			`Basic ${btoa(`${clientId}:${clientSecret}`)}`,
		);

		expect(clientCredentials).toEqual({
			clientId,
			clientSecret,
		});
	});

	const clientId = "e2062e6b-7af1-4c45-9b13-9ebfe9263fe6";
	const clientSecret = "eqCwSoGkm2Uo0WgzjyKGJSrHHApYuljEv1ceEBeMoF8d";
	for (const [description, authorizationHeader] of new Map([
		[
			"Bearer ${btoa(`${clientId}:${clientSecret}`)}",
			`Bearer ${btoa(`${clientId}:${clientSecret}`)}`,
		],
		["Basic${btoa(`${clientId}:${clientSecret}`)}", `Basic${btoa(`${clientId}:${clientSecret}`)}`],
		["Basic ${btoa(`${clientId}${clientSecret}`)}", `Basic ${btoa(`${clientId}${clientSecret}`)}`],
		["Basic ${btoa(`:${clientSecret}`)}", `Basic ${btoa(`:${clientSecret}`)}`],
		["${btoa(`${clientId}:${clientSecret}`)}`)}", `${btoa(`${clientId}:${clientSecret}`)}`],
		["undefined", undefined],
	])) {
		it(`extractClientCredentials should return empty object if authorization header is invalid (${description})`, () => {
			expect(extractClientCredentials(authorizationHeader)).toEqual({
				clientId: "",
				clientSecret: "",
			});
		});
	}

	it("isRedirectUriValid should return true if redirect uri matches for the client", async () => {
		expect(await isRedirectUriValid(DUMMY_CLIENT_ID, DUMMY_CLIENT_REDIRECT_URI)).toEqual(true);
	});

	it("isRedirectUriValid should return false if redirect uri does not match for the client", async () => {
		expect(await isRedirectUriValid(DUMMY_CLIENT_ID, "https://someotheruri.example.com")).toEqual(
			false,
		);
		expect(await isRedirectUriValid(DUMMY_CLIENT_ID, `${DUMMY_CLIENT_REDIRECT_URI}/other`)).toEqual(
			false,
		);
		expect(
			await isRedirectUriValid(DUMMY_CLIENT_ID, `${DUMMY_CLIENT_REDIRECT_URI}?query=param`),
		).toEqual(false);
	});

	it("isRedirectUriValid should throw error if client does not exist in database", async () => {
		await expect(async () => {
			await isRedirectUriValid("0d15269c-a0f3-4e07-8432-a47faede1f53", DUMMY_CLIENT_REDIRECT_URI);
		}).rejects.toThrowError("Client with id 0d15269c-a0f3-4e07-8432-a47faede1f53 not found.");
	});
});

describe("attachErrorInformationToRedirectUri", () => {
	[
		{
			redirectUri: "https://redirecturi.example.com",
			state: "",
			errorType: "access_denied",
			expectedRedirectUri: "https://redirecturi.example.com/?error=access_denied",
		},
		{
			redirectUri: "https://redirecturi.example.com",
			state: "someState",
			errorType: "invalid_request",
			expectedRedirectUri: "https://redirecturi.example.com/?state=someState&error=invalid_request",
		},
		{
			redirectUri: "https://redirecturi.example.com?existing_query=very_yes",
			state: "otherState",
			errorType: "invalid_scope",
			expectedRedirectUri:
				"https://redirecturi.example.com/?existing_query=very_yes&state=otherState&error=invalid_scope",
		},
		{
			redirectUri: "https://redirecturi.example.com?existing_query=very_yes",
			state: "",
			errorType: "server_error",
			expectedRedirectUri:
				"https://redirecturi.example.com/?existing_query=very_yes&error=server_error",
		},
	].forEach(({ redirectUri, state, errorType, expectedRedirectUri }) => {
		it(`should attach "${errorType}" error type to a redirect uri ${redirectUri} (with state "${state}")`, () => {
			const actualRedirectUri = attachErrorInformationToRedirectUri(
				redirectUri,
				state,
				errorType as AuthorizationResponseErrorType,
			);
			expect(actualRedirectUri).toEqual(expectedRedirectUri);
		});
	});
});
