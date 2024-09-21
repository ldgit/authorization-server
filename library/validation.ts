import type { UserRegisterType } from "../routes/frontend.ts";
import { findUserByUsername } from "./user.js";

export interface ValidationError {
	name?: string;
	surname?: string;
	username?: string;
	password?: string;
	data: UserRegisterType;
}

export async function validateNewUser(user: UserRegisterType): Promise<ValidationError | null> {
	const errors: ValidationError = { data: user };

	if (!user.name.trim()) {
		errors.name = "Name must not be empty";
	}
	if (!user.surname.trim()) {
		errors.surname = "Surname must not be empty";
	}
	if (!user.username.trim()) {
		errors.username = "Username must not be empty";
	}
	if (!user.password) {
		errors.password = "Password must not be empty";
	}

	if ((await findUserByUsername(user.username)) !== null) {
		errors.username = "Username already taken";
	}

	if (Object.keys(errors).length === 1) {
		return null;
	}

	return errors;
}
