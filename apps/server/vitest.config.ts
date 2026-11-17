import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		maxWorkers: Math.min(8, availableParallelism()),
		// Integration fixtures perform filesystem scans, database writes, and process startup.
		testTimeout: 15_000,
		include: ["test/**/*.test.ts"],
	},
});
