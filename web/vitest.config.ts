import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["test/setup.ts"],
		maxWorkers: 4,
		include: ["test/**/*.test.{ts,tsx}"],
	},
});
