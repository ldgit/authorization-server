import * as argon2 from "argon2";
import { isDate } from "date-fns";
import { validate as isValidUUID, v4 as uuidv4 } from "uuid";
import { describe, expect, it } from "vitest";
import { type UserData, findUserById, findUserByUsername } from "./user.js";

describe("user functions", () => {
	it("findUserByUsername should return null if user does not exist", async () => {
		expect(await findUserByUsername("thisUserDoesNotExist")).toBeNull();
	});

	it("findUserByUsername should return user data if user exists", async () => {
		const userData = (await findUserByUsername("DylanG")) as UserData;

		expect(isValidUUID(userData.id));
		expect(userData.username).toEqual("DylanG");
		expect(userData.firstname).toEqual("Dylan");
		expect(userData.lastname).toEqual("George");
		expect(isDate(userData.createdAt)).toStrictEqual(true);
		const passwordMatches = await argon2.verify(userData.password, "test");
		expect(passwordMatches).toStrictEqual(true);
	});

	it("findUserId should return null if user does not exists", async () => {
		const actualUserData = (await findUserById(uuidv4())) as UserData;
		expect(actualUserData).toEqual(null);
	});

	it("findUserId should return null if user id is not a uuid", async () => {
		const actualUserData = (await findUserById("someId")) as UserData;
		expect(actualUserData).toEqual(null);
	});

	it("findUserId should return user data if user exists", async () => {
		const expectedUserData = (await findUserByUsername("DylanG")) as UserData;
		const actualUserData = (await findUserById(expectedUserData.id)) as UserData;

		expect(actualUserData).toEqual(expectedUserData);
	});
});
