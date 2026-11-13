import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["test/setup.ts"],
		maxWorkers: Math.min(8, availableParallelism()),
		include: ["test/**/*.test.{ts,tsx}"],
	},
});
