import { afterEach, describe, expect, it } from "vitest";
import { type ValidationError, validateNewUser } from "./validation.ts";
import { query } from "../database/adapter.ts";
import { createNewAccount } from "./authentication.ts";

describe("validation", () => {
	const userIds: string[] = [];

	afterEach(async function () {
		if (userIds.length) {
			await query(
				`DELETE FROM users WHERE id IN (${userIds.map((userId) => `'${userId}'`).join(", ")})`,
			);
		}
	});

	it("validateNewUser should return empty object if data is valid", async () => {
		expect(
			await validateNewUser({
				name: "valid name",
				surname: "valid surname",
				username: "valid username",
				password: "valid password",
			}),
		).toEqual(null);
	});

	it("validateNewUser should return empty name error if name is empty", async () => {
		const validationResult1 = (await validateNewUser({
			name: "",
			surname: "valid surname",
			username: "valid username",
			password: "valid password",
		})) as ValidationError;
		expect(Object.keys(validationResult1)).toHaveLength(2);
		expect(validationResult1?.name).toEqual("Name must not be empty");

		// Check for whitespace too.
		const validationResult2 = (await validateNewUser({
			name: "   ",
			surname: "valid surname",
			username: "valid username",
			password: "valid password",
		})) as ValidationError;
		expect(Object.keys(validationResult2)).toHaveLength(2);
		expect(validationResult2?.name).toEqual("Name must not be empty");
	});

	it("validateNewUser should return empty surname error if surname is empty", async () => {
		const validationResult1 = (await validateNewUser({
			name: "valid name",
			surname: "",
			username: "valid username",
			password: "valid password",
		})) as ValidationError;
		expect(Object.keys(validationResult1)).toHaveLength(2);
		expect(validationResult1?.surname).toEqual("Surname must not be empty");
		// Check for whitespace too.
		const validationResult2 = (await validateNewUser({
			name: "valid name",
			surname: "  ",
			username: "valid username",
			password: "valid password",
		})) as ValidationError;
		expect(Object.keys(validationResult2)).toHaveLength(2);
		expect(validationResult2?.surname).toEqual("Surname must not be empty");
	});

	it("validateNewUser should return empty username error if username is empty", async () => {
		const validationResult1 = (await validateNewUser({
			name: "valid name",
			surname: "valid surname",
			username: "",
			password: "valid password",
		})) as ValidationError;
		expect(Object.keys(validationResult1)).toHaveLength(2);
		expect(validationResult1?.username).toEqual("Username must not be empty");
		// Check for whitespace too.
		const validationResult2 = (await validateNewUser({
			name: "valid name",
			surname: "valid surname",
			username: "  ",
			password: "valid password",
		})) as ValidationError;
		expect(Object.keys(validationResult2)).toHaveLength(2);
		expect(validationResult2.username).toEqual("Username must not be empty");
	});

	it("validateNewUser should return username taken error if username is already exists in database", async () => {
		const userId = await createNewAccount({
			name: "Ricken",
			surname: "Hale",
			username: "rHale",
			password: "test",
		});
		userIds.push(userId);

		const validationResult = (await validateNewUser({
			name: "Richard",
			surname: "Hale",
			username: "rHale",
			password: "double",
		})) as ValidationError;
		expect(Object.keys(validationResult)).toHaveLength(2);
		expect(validationResult?.username).toEqual("Username already taken");
	});

	it("validateNewUser should return empty password error if password is empty", async () => {
		const validationResult = (await validateNewUser({
			name: "valid name",
			surname: "valid surname",
			username: "valid username",
			password: "",
		})) as ValidationError;
		expect(Object.keys(validationResult)).toHaveLength(2);
		expect(validationResult?.password).toEqual("Password must not be empty");
		// Allow whitespace though.
		expect(
			await validateNewUser({
				name: "valid name",
				surname: "valid surname",
				username: "valid username",
				password: "valid password",
			}),
		).toEqual(null);
	});

	it("validateNewUser should return all detected errors if more than one exists", async () => {
		const userId = await createNewAccount({
			name: "Ricken",
			surname: "Hale",
			username: "rHale",
			password: "test",
		});
		userIds.push(userId);

		const newUser1 = {
			name: "  ",
			surname: "  ",
			username: "rHale",
			password: "",
		};
		const validationErrors1 = await validateNewUser(newUser1);
		expect(validationErrors1).toEqual({
			data: newUser1,
			name: "Name must not be empty",
			surname: "Surname must not be empty",
			password: "Password must not be empty",
			username: "Username already taken",
		});

		const newUser2 = {
			name: "  ",
			surname: "  ",
			username: " ",
			password: "",
		};
		const validationErrors2 = await validateNewUser(newUser2);
		expect(validationErrors2).toEqual({
			data: newUser2,
			name: "Name must not be empty",
			surname: "Surname must not be empty",
			password: "Password must not be empty",
			username: "Username must not be empty",
		});
	});
});
