import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApplicationLogging } from "../src/platform/logging/index.js";

let fixture: string;
const outputs: ReturnType<typeof pino.destination>[] = [];
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-log-"));
	const original = pino.destination;
	vi.spyOn(pino, "destination").mockImplementation((options) => {
		const output = original(options);
		outputs.push(output);
		return output;
	});
});
afterEach(async () => {
	// Tests create many destinations in one process; release fixtures explicitly.
	await Promise.all(
		outputs.splice(0).map(
			(output) =>
				new Promise<void>((resolve) => {
					output.once("close", resolve);
					output.end();
				}),
		),
	);
	vi.restoreAllMocks();
	await rm(fixture, { recursive: true, force: true });
});
async function logging(level: "info" | "debug" | "silent" = "info") {
	const path = join(fixture, "nested", "application.log");
	const instance = ApplicationLogging.create({
		level,
		destination: "file",
		path,
	});
	return Object.assign(instance, { path });
}
async function records(path: string): Promise<Record<string, unknown>[]> {
	const text = await readFile(path, "utf8");
	return text.trim()
		? text
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>)
		: [];
}

test("creates parent directories, filters levels and writes JSON context", async () => {
	const instance = await logging();
	instance.logger.debug({ event: "hidden" }, "Hidden");
	const child = instance.logger.child({
		module: "scanner",
		requestId: "request-1",
	});
	child.info({ event: "scan.completed", count: 2 }, "Completed");
	const output = await records(instance.path);
	expect(output).toHaveLength(1);
	expect(output[0]).toMatchObject({
		level: 30,
		event: "scan.completed",
		module: "scanner",
		requestId: "request-1",
		count: 2,
	});
	expect(output[0]?.time).toEqual(expect.stringMatching(/^\d{4}-.*Z$/));
});

test("debug level enables debug and silent produces no normal logs", async () => {
	const debug = await logging("debug");
	debug.logger.debug({ event: "debug" }, "Debug");
	expect(await records(debug.path)).toHaveLength(1);
	const silent = await logging("silent");
	silent.logger.fatal({ event: "hidden" }, "Hidden");
	expect(await records(silent.path)).toHaveLength(1); // The earlier record is retained; nothing appended.
});

test("separate logger instances append to the same file", async () => {
	const first = await logging();
	first.logger.info({ event: "first" }, "First");
	const second = await logging();
	second.logger.info({ event: "second" }, "Second");
	expect((await records(first.path)).map((record) => record.event)).toEqual([
		"first",
		"second",
	]);
});

test("redacts common sensitive fields and serializes errors", async () => {
	const instance = await logging();
	instance.logger.error(
		{
			event: "failure",
			err: new Error("disk failure"),
			token: "secret",
			config: { token: "secret" },
			req: {
				headers: { authorization: "secret", cookie: "secret" },
				body: "secret",
			},
		},
		"Failed",
	);
	const text = await readFile(instance.path, "utf8");
	expect(text).not.toContain("secret");
	expect((await records(instance.path))[0]?.err).toMatchObject({
		message: "disk failure",
		type: "Error",
	});
});

test("file output requires a usable parent directory", async () => {
	const parent = join(fixture, "file");
	await writeFile(parent, "occupied");
	expect(() =>
		ApplicationLogging.create({
			level: "info",
			destination: "file",
			path: join(parent, "log"),
		}),
	).toThrow();
});
