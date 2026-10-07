import { writeSync } from "node:fs";
import {
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createStream } from "rotating-file-stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { deploymentDefaults } from "../src/contracts/defaults.js";
import { ApplicationLogging } from "../src/platform/logging/index.js";

let fixture: string;
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, writeSync: vi.fn(actual.writeSync) };
});
vi.mock("rotating-file-stream", async (importOriginal) => {
	const actual = await importOriginal<typeof import("rotating-file-stream")>();
	return { ...actual, createStream: vi.fn(actual.createStream) };
});
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

test("unusable file output falls back at startup and can be explicitly recovered", async () => {
	const output = vi.mocked(writeSync).mockImplementation(() => 1);
	const parent = join(fixture, "occupied");
	await writeFile(parent, "occupied");
	const instance = create({
		level: "info",
		destination: "file",
		path: join(parent, "log"),
		rotation,
	});
	const child = instance.logger.child({ module: "test" });
	child.info({ event: "fallback" });
	expect(output.mock.calls.some((call) => call[0] === 2)).toBe(true);
	await rm(parent);
	await instance.reopen();
	child.info({ event: "recovered" });
	expect((await records(join(parent, "log")))[0]?.event).toBe("recovered");
});

test("both writes the same redacted record to stdout and file", async () => {
	const lines: string[] = [];
	vi.mocked(writeSync).mockImplementation((_fd, buffer) => {
		lines.push(buffer.toString());
		return Buffer.byteLength(buffer.toString());
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

test("reopening after external rotation preserves existing child loggers", async () => {
	const instance = await logging();
	const child = instance.logger.child({ module: "same-child" });
	child.info({ event: "before" });
	await instance.flush();
	await rename(instance.path, `${instance.path}.old`);
	await instance.reopen();
	child.info({ event: "after" });
	expect((await records(instance.path))[0]?.event).toBe("after");
	expect((await records(`${instance.path}.old`))[0]?.event).toBe("before");
});

test("file stream errors redirect subsequent child records and keep stdout working", async () => {
	const writes: { fd: number; line: string }[] = [];
	vi.mocked(writeSync).mockImplementation((fd, buffer) => {
		writes.push({ fd, line: buffer.toString() });
		return Buffer.byteLength(buffer.toString());
	});
	vi.mocked(createStream).mockReturnValueOnce(
		new Writable({
			write(_chunk, _encoding, callback) {
				callback(new Error("disk failure"));
			},
		}) as ReturnType<typeof createStream>,
	);
	const instance = create({
		level: "info",
		destination: "both",
		path: join(fixture, "failed.log"),
		rotation,
	});
	const child = instance.logger.child({ module: "child" });
	child.info({ event: "first" });
	await instance.flush();
	child.info({ event: "second" });
	expect(
		writes
			.filter((record) => record.fd === 1)
			.map((record) => JSON.parse(record.line).event),
	).toEqual(["first", "second"]);
	expect(
		writes
			.filter((record) => record.fd === 2)
			.map((record) => JSON.parse(record.line).event),
	).toContain("second");
});

test("stdout EPIPE is contained and file output continues", async () => {
	const fallback: string[] = [];
	vi.mocked(writeSync).mockImplementation((fd, buffer) => {
		if (fd === 1)
			throw Object.assign(new Error("broken pipe"), { code: "EPIPE" });
		fallback.push(buffer.toString());
		return Buffer.byteLength(buffer.toString());
	});
	const path = join(fixture, "working.log");
	const instance = create({
		level: "info",
		destination: "both",
		path,
		rotation,
	});
	instance.logger.info({ event: "first" });
	instance.logger.info({ event: "second" });
	expect((await records(path)).map((record) => record.event)).toEqual([
		"first",
		"second",
	]);
	expect(fallback.map((line) => JSON.parse(line).event)).toContain("second");
});

test("slow output bounds the queue and reports overflow to stderr", async () => {
	vi.mocked(writeSync).mockImplementation((_fd, buffer) =>
		Buffer.byteLength(buffer.toString()),
	);
	let complete: ((error?: Error | null) => void) | undefined;
	vi.mocked(createStream).mockReturnValueOnce(
		new Writable({
			write(_chunk, _encoding, callback) {
				complete = callback;
			},
		}) as ReturnType<typeof createStream>,
	);
	const instance = create({
		level: "info",
		destination: "file",
		path: join(fixture, "slow.log"),
		rotation,
	});
	instance.logger.info({ event: "large", message: "x".repeat(700_000) });
	instance.logger.info({ event: "overflow", message: "x".repeat(700_000) });
	expect(
		vi
			.mocked(writeSync)
			.mock.calls.some((call) =>
				call[1].toString().includes("logging.buffer_overflow"),
			),
	).toBe(true);
	complete?.();
	await instance.close();
});

test("time rotation archives a file below the size threshold", async () => {
	const actual = await vi.importActual<typeof import("rotating-file-stream")>(
		"rotating-file-stream",
	);
	vi.mocked(createStream).mockImplementationOnce((filename, options) => {
		expect(options?.interval).toBe("1h");
		return actual.createStream(filename, { ...options, interval: "1s" });
	});
	const path = join(fixture, "hourly.log");
	const instance = create({
		level: "info",
		destination: "file",
		path,
		rotation: { ...rotation, interval: "1h" },
	});
	instance.logger.info({ event: "before" });
	await instance.flush();
	await new Promise((resolve) => setTimeout(resolve, 1100));
	instance.logger.info({ event: "after" });
	await instance.flush();
	expect((await records(path)).map((record) => record.event)).toEqual([
		"after",
	]);
	await instance.close();
	const archives = (await readdir(fixture)).filter((name) =>
		name.endsWith("-hourly.log"),
	);
	expect(archives).toHaveLength(1);
});

test("SIGHUP reopens a renamed file and closing removes the handler", async () => {
	const initial = process.listenerCount("SIGHUP");
	const instance = await logging();
	instance.logger.info({ event: "before" });
	await instance.flush();
	await rename(instance.path, `${instance.path}.old`);
	process.emit("SIGHUP");
	await instance.flush();
	instance.logger.info({ event: "after" });
	expect((await records(instance.path))[0]?.event).toBe("after");
	await instance.close();
	expect(process.listenerCount("SIGHUP")).toBe(initial);
});

test("shutdown flushes pending records without an explicit flush", async () => {
	const instance = await logging();
	instance.logger.info({ event: "pending" });
	await instance.close();
	expect((await records(instance.path))[0]?.event).toBe("pending");
});

test("a stalled output times out during shutdown and reports potential loss", async () => {
	vi.useFakeTimers();
	vi.mocked(writeSync).mockImplementation((_fd, buffer) =>
		Buffer.byteLength(buffer.toString()),
	);
	vi.mocked(createStream).mockReturnValueOnce(
		new Writable({ write() {} }) as ReturnType<typeof createStream>,
	);
	const instance = create({
		level: "info",
		destination: "file",
		path: join(fixture, "stalled.log"),
		rotation,
	});
	instance.logger.info({ event: "pending" });
	const closing = instance.close();
	await vi.advanceTimersByTimeAsync(2000);
	await closing;
	const diagnostics = vi
		.mocked(writeSync)
		.mock.calls.map((call) => JSON.parse(call[1].toString()));
	expect(diagnostics).toContainEqual(
		expect.objectContaining({
			event: "logging.shutdown_timeout",
			potentialLostBytes: expect.any(Number),
		}),
	);
});

test("stderr failure is contained after stdout failure", () => {
	vi.mocked(writeSync).mockImplementation(() => {
		throw Object.assign(new Error("broken pipe"), { code: "EPIPE" });
	});
	const instance = create({ level: "info", destination: "stdout" });
	expect(() => {
		instance.logger.info({ event: "first" });
		instance.logger.info({ event: "second" });
	}).not.toThrow();
});

test("file failure reports the uncertain record and redirects queued records", async () => {
	const lines: string[] = [];
	vi.mocked(writeSync).mockImplementation((_fd, buffer) => {
		lines.push(buffer.toString());
		return Buffer.byteLength(buffer.toString());
	});
	let complete: ((error?: Error | null) => void) | undefined;
	vi.mocked(createStream).mockReturnValueOnce(
		new Writable({
			write(_chunk, _encoding, callback) {
				complete = callback;
			},
		}) as ReturnType<typeof createStream>,
	);
	const instance = create({
		level: "info",
		destination: "file",
		path: join(fixture, "queued.log"),
		rotation,
	});
	instance.logger.info({ event: "uncertain" });
	instance.logger.info({ event: "queued" });
	complete?.(Object.assign(new Error("full"), { code: "ENOSPC" }));
	await instance.flush();
	const events = lines.map((line) => JSON.parse(line));
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "logging.output_failed",
			errorCode: "ENOSPC",
			potentialLostBytes: expect.any(Number),
		}),
	);
	expect(events.map((event) => event.event)).toContain("queued");
	expect(events.map((event) => event.event)).not.toContain("uncertain");
});
