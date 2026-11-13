import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "happy-dom",
		maxWorkers: Math.min(8, availableParallelism()),
		include: ["test/**/*.test.ts"],
	},
});
