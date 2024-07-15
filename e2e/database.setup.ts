import { test as setup } from "@playwright/test";
import { createDummyData } from "../database/createDummyData.ts";

setup("create new database", async () => {
	await createDummyData();
});
