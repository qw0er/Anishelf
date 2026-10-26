import pino from "pino";
import { expect, test } from "vitest";
import { mediaToolPolicy } from "../src/platform/media/policy.js";
import { runTool } from "../src/platform/media/process.js";
import { createHttpApp } from "./support/http.js";

function capture(level: string) {
	const records: Record<string, unknown>[] = [];
	const logger = pino(
		{ level },
		{ write: (line: string) => records.push(JSON.parse(line)) },
	);
	return { logger, records };
}

test("successful HTTP requests stay quiet at info and expose safe correlation at trace", async () => {
	for (const level of ["info", "trace"]) {
		const { logger, records } = capture(level);
		const app = createHttpApp({
			logger,
			config: { host: "127.0.0.1", port: 3000 },
		});
		try {
			await app.ready();
			expect(records).toEqual([
				expect.objectContaining({
					event: "http.proxy_configured",
					level: 30,
					trustedProxies: ["loopback"],
				}),
			]);
			// Startup diagnostics are expected; successful requests stay quiet at info.
			records.length = 0;
			const response = await app.inject({
				url: "/api/health?token=private-query",
				headers: { host: "127.0.0.1:3000", authorization: "private-header" },
			});
			expect(response.statusCode).toBe(200);
			if (level === "info") expect(records).toHaveLength(0);
			else {
				expect(records).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							event: "http.request_completed",
							level: 10,
							route: "/api/health",
							statusCode: 200,
							reqId: response.headers["x-request-id"],
						}),
					]),
				);
			}
			expect(JSON.stringify(records)).not.toContain("private-");
		} finally {
			await app.close();
		}
	}
});

test("external tool logs completion metadata without arguments or output", async () => {
	const { logger, records } = capture("debug");
	const output = await runTool(
		process.execPath,
		["-e", "process.stdout.write('private-output')"],
		{},
		mediaToolPolicy,
		logger,
	);
	expect(output).toBe("private-output");
	expect(records).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				event: "media.tool_completed",
				level: 20,
				outputBytes: 14,
			}),
		]),
	);
	expect(JSON.stringify(records)).not.toContain("private-output");
});

test("external tool failures remain visible at info with exit status", async () => {
	const { logger, records } = capture("info");
	await expect(
		runTool(
			process.execPath,
			["-e", "process.exit(7)"],
			{},
			mediaToolPolicy,
			logger,
		),
	).rejects.toMatchObject({ code: "TOOL_FAILED" });
	expect(records).toEqual([
		expect.objectContaining({
			event: "media.tool_failed",
			level: 40,
			exitCode: 7,
		}),
	]);
});
