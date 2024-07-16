import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["dotenv/config"],
		exclude: [...configDefaults.exclude, "e2e/*"],
	},
});
