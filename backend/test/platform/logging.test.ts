import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { deploymentDefaults } from "../../src/contracts/defaults.js";
import { ApplicationLogging } from "../../src/platform/logging/index.js";

let fixture: string;
const instances: ApplicationLogging[] = [];
const rotation = {
	maxSizeBytes: deploymentDefaults.logMaxSizeBytes,
	maxFiles: deploymentDefaults.logMaxFiles,
	interval: "1d" as const,
};
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-log-"));
});
afterEach(async () => {
	await Promise.all(instances.splice(0).map((instance) => instance.close()));
	vi.useRealTimers();
	vi.restoreAllMocks();
	await rm(fixture, { recursive: true, force: true });
});
function create(config: Parameters<typeof ApplicationLogging.create>[0]) {
	const instance = ApplicationLogging.create(config);
	instances.push(instance);
	return instance;
}
async function logging(level: "info" | "debug" | "silent" = "info") {
	const path = join(fixture, "nested", "application.log");
	const instance = create({
		level,
		destination: "file",
		path,
		rotation,
	});
	return Object.assign(instance, { path });
}
async function records(path: string): Promise<Record<string, unknown>[]> {
	await Promise.all(instances.map((instance) => instance.flush()));
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
	await first.flush();
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
	await instance.flush();
	const text = await readFile(instance.path, "utf8");
	expect(text).not.toContain("secret");
	expect((await records(instance.path))[0]?.err).toMatchObject({
		message: "disk failure",
		type: "Error",
	});
});

test("both writes the same redacted record to stdout and file", async () => {
	const lines: string[] = [];
	vi.spyOn(process.stdout, "write").mockImplementation((buffer) => {
		lines.push(buffer.toString());
		return true;
	});
	const path = join(fixture, "both.log");
	const instance = create({
		level: "info",
		destination: "both",
		path,
		rotation,
	});
	instance.logger
		.child({ module: "test" })
		.info({ event: "both", token: "private" });
	const file = await records(path);
	expect(JSON.parse(lines[0] ?? "null")).toEqual(file[0]);
	expect(lines.join("")).not.toContain("private");
});

test("size rotation retains only the configured number of archives", async () => {
	const path = join(fixture, "rotated.log");
	const instance = create({
		level: "info",
		destination: "file",
		path,
		rotation: { ...rotation, maxSizeBytes: 1, maxFiles: 2 },
	});
	for (let i = 0; i < 5; i++) {
		instance.logger.info({ event: "rotate", index: i });
		await instance.flush();
	}
	await instance.close();
	const files = (await readdir(fixture)).filter(
		(name) => name !== "rotated.log" && name !== "rotated.log.txt",
	);
	expect(files).toHaveLength(2);
	const archives = await Promise.all(
		files.map((name) => records(join(fixture, name))),
	);
	expect(
		archives
			.flat()
			.map((record) => record.index)
			.sort(),
	).toEqual([3, 4]);
});

test("shutdown flushes pending records without an explicit flush", async () => {
	const instance = await logging();
	instance.logger.info({ event: "pending" });
	await instance.close();
	expect((await records(instance.path))[0]?.event).toBe("pending");
});
