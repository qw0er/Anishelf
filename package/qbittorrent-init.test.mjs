import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import {
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initialize } from "./qbittorrent-init.mjs";

test("initializes compatible credentials, resumes publication, and preserves user configuration", async () => {
	const root = await mkdtemp(join(tmpdir(), "anishelf-bootstrap-"));
	try {
		const config = join(root, "config"),
			credentials = join(root, "credentials");
		const file = join(config, "qBittorrent/qBittorrent.conf");
		const secret = join(credentials, "connection.json");
		assert.equal(
			await initialize(config, credentials, process.getuid()),
			"initialized",
		);
		const saved = JSON.parse(await readFile(secret, "utf8"));
		const content = await readFile(file, "utf8");
		const [, salt, expected] = content.match(
			/Password_PBKDF2="([^:]+):([^"]+)"/,
		);
		assert.equal(
			pbkdf2Sync(
				saved.connection.password,
				Buffer.from(salt, "base64"),
				100000,
				64,
				"sha512",
			).toString("base64"),
			expected,
		);
		assert.match(content, /Session\\TempPathEnabled=true/);
		assert.equal((await stat(secret)).mode & 0o777, 0o600);
		assert.equal((await stat(credentials)).mode & 0o777, 0o700);
		await rename(secret, join(credentials, "connection.pending.json"));
		assert.equal(
			await initialize(config, credentials, process.getuid()),
			"initialized",
		);
		assert.deepEqual(JSON.parse(await readFile(secret, "utf8")), saved);
		await writeFile(file, "user changed settings");
		assert.equal(
			await initialize(config, credentials, process.getuid()),
			"existing",
		);
		assert.equal(await readFile(file, "utf8"), "user changed settings");
		await rm(secret);
		assert.equal(
			await initialize(config, credentials, process.getuid()),
			"manual",
		);
		assert.equal(await readFile(file, "utf8"), "user changed settings");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("refuses a lost configuration volume without resetting published credentials", async () => {
	const root = await mkdtemp(join(tmpdir(), "anishelf-bootstrap-loss-"));
	try {
		const config = join(root, "config"),
			credentials = join(root, "credentials");
		await initialize(config, credentials, process.getuid());
		const before = await readFile(join(credentials, "connection.json"), "utf8");
		await rm(config, { recursive: true, force: true });
		await assert.rejects(
			initialize(config, credentials, process.getuid()),
			/configuration is missing/,
		);
		assert.equal(
			await readFile(join(credentials, "connection.json"), "utf8"),
			before,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
