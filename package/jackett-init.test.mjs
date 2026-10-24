import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initialize } from "./jackett-init.mjs";

test("empty configuration is authorized before Jackett starts and survives reruns", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-jackett-init-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	assert.equal(await initialize(directory), "initialized");
	await mkdir(join(directory, "Jackett"));
	await writeFile(
		join(directory, "Jackett/ServerConfig.json"),
		"native-config",
	);
	assert.equal(await initialize(directory), "authorized");
	assert.deepEqual(
		JSON.parse(
			await readFile(join(directory, ".anishelf-bootstrap.json"), "utf8"),
		),
		{ version: 1, initialize: true },
	);
	assert.equal(
		await readFile(join(directory, "Jackett/ServerConfig.json"), "utf8"),
		"native-config",
	);
});

test("existing installations never acquire first-run authorization", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-jackett-existing-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await mkdir(join(directory, "Jackett"));
	assert.equal(await initialize(directory), "existing");
	await assert.rejects(readFile(join(directory, ".anishelf-bootstrap.json")), {
		code: "ENOENT",
	});
});

test("an interrupted marker write can be recovered before the service starts", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-jackett-pending-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(join(directory, ".anishelf-bootstrap.json.pending"), "{");
	assert.equal(await initialize(directory), "initialized");
});
