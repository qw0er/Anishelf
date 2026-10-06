import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["test/query-setup.ts"],
		include: ["test/**/*.test.{ts,tsx}"],
	},
});
