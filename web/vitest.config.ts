import { defineConfig } from "vitest/config";

export default defineConfig({
	define: {
		__ANISHELF_BUILD__: JSON.stringify({
			version: "1.0.2",
			commit: "test",
			channel: "development",
			builtAt: null,
		}),
	},
	test: {
		environment: "node",
		setupFiles: ["test/setup.ts"],
		maxWorkers: 4,
		include: ["test/**/*.test.{ts,tsx}"],
	},
});
