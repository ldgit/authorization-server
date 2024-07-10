import { query } from "../database/adapter.ts";
import type { UserRegisterType } from "../routes/frontend.ts";

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

	const userResult = await query("SELECT username FROM users WHERE username = $1", [user.username]);
	if (userResult.rowCount !== 0) {
		errors.username = "Username already taken";
	}

	if (Object.keys(errors).length === 1) {
		return null;
	}

	return errors;
}
