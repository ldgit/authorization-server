import { expect, test } from "@playwright/test";

test("Login happy path", async ({ page }) => {
	await page.goto("/");

	await expect(page).toHaveTitle(/Authorization Server/);
	await page.getByRole("link", { name: "Sign in" }).click();
	await page.waitForURL("/login");

	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByLabel(/Password/).fill("test");
	await page.getByRole("button", { name: "Sign in" }).click();

	await page.waitForURL("/");
	await expect(page.getByRole("heading", { name: "Welcome Mark Scout! 🎉" })).toBeVisible();
});

test("Sign out path", async ({ page }) => {
	await page.goto("/login");

	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByLabel(/Password/).fill("test");
	await page.getByRole("button", { name: "Sign in" }).click();

	await page.waitForURL("/");
	await page.getByRole("link", { name: "Sign out" }).click();
	await page.waitForURL("/");
	await expect(page.getByRole("button", { name: "Create new account" })).toBeVisible();
});

test("Login validation error", async ({ page }) => {
	await page.goto("/login");

	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByLabel(/Password/).fill("wrong password");
	await page.getByRole("button", { name: "Sign in" }).click();

	await expect(page.getByText("Wrong username or password.")).toBeVisible();
	await expect(page).toHaveURL(/\/login/);

	await page.getByLabel(/Username/).fill("MarkWho");
	await page.getByLabel(/Password/).fill("test");
	await page.getByRole("button", { name: "Sign in" }).click();

	await expect(page.getByText("Wrong username or password.")).toBeVisible();
	await expect(page).toHaveURL(/\/login/);

	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByLabel(/Password/).fill("test");
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL("/");
	await expect(page.getByRole("heading", { name: "Welcome Mark Scout! 🎉" })).toBeVisible();
});

test("Login should preserve query parameters on validation error", async ({ page }) => {
	await page.goto(
		"/login?client_id=123&response_type=code&redirect_uri=https://www.example.com&scope=openid",
	);

	// Everything empty.
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText("Wrong username or password.")).toBeVisible();
	expectQueryParametersToBePreserved(page.url());

	// Unknown username
	await page.getByLabel(/Username/).fill("notMarkS");
	await page.getByLabel(/Password/).fill("test");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText("Wrong username or password.")).toBeVisible();
	expectQueryParametersToBePreserved(page.url());

	// Correct username, wrong password.
	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByLabel(/Password/).fill("wrong password");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText("Wrong username or password.")).toBeVisible();
	expectQueryParametersToBePreserved(page.url());
});

test("Login should remove error query parameter once user inputs correct credentials", async ({
	page,
}) => {
	await page.goto(
		"/login?client_id=123&response_type=code&redirect_uri=https://www.example.com&scope=openid",
	);

	// Cause the error by submitting invalid data.
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText("Wrong username or password.")).toBeVisible();
	expect(page.url()).toContain("error=1");

	// Enter correct credentials.
	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByLabel(/Password/).fill("test");
	await page.getByRole("button", { name: "Sign in" }).click();
	expectQueryParametersToBePreserved(page.url());
	expect(page.url()).not.toContain("error=1");
});

function expectQueryParametersToBePreserved(url: string) {
	const loginPageSearchParams = new URL(url).searchParams;
	expect(loginPageSearchParams.get("client_id")).toEqual("123");
	expect(loginPageSearchParams.get("response_type")).toEqual("code");
	expect(loginPageSearchParams.get("redirect_uri")).toEqual("https://www.example.com");
	expect(loginPageSearchParams.get("scope")).toEqual("openid");
}

test("Create new account happy path", async ({ page, browserName }) => {
	await page.goto("/");

	await page.getByRole("link", { name: "Create new account" }).click();
	await page.waitForURL("/register");

	await page.getByLabel(/Name/).fill("Jane");
	await page.getByLabel(/Surname/).fill("Doe");
	// Create a different user for each browser context to avoid duplicate username errors.
	await page.getByLabel(/Username/).fill(`jDoe_${browserName}`);
	await page.getByLabel(/Password/).fill("12345");
	await page.getByRole("button", { name: "Create account" }).click();

	await page.waitForURL("/");
	await expect(page.getByRole("heading", { name: "Welcome Jane Doe! 🎉" })).toBeVisible();
});

test("Create new account validation errors", async ({ page, browserName }) => {
	await page.goto("/");

	await page.getByRole("link", { name: "Create new account" }).click();
	await page.waitForURL("/register");

	await page.getByLabel(/Username/).fill("MarkS");
	await page.getByRole("button", { name: "Create account" }).click();

	// Still on the same page.
	await expect(page).toHaveURL(/\/register/);
	await expect(page.getByText("Name must not be empty", { exact: true })).toBeVisible();
	await expect(page.getByText("Surname must not be empty")).toBeVisible();
	await expect(page.getByText("Username already taken")).toBeVisible();
	await expect(page.getByText("Password must not be empty")).toBeVisible();
});
