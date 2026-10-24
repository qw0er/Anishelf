import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { SourceCooldownFile } from "../src/modules/acquisition/sources/infrastructure/cooldown-file.js";
import { SourceRequestGate } from "../src/modules/acquisition/sources/infrastructure/request-gate.js";
import {
	jackettConnectionKey,
	jackettIndexerKey,
	sourceOriginKey,
} from "../src/modules/acquisition/sources/infrastructure/request-keys.js";
import { outboundCooldownOverflowKey } from "../src/platform/network/request-scheduler.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-source-cooldowns-"));
	directories.push(directory);
	const acquisition = join(directory, "acquisition");
	const path = join(acquisition, "source-cooldowns.json");
	const logger = pino({ level: "silent" });
	let now = 1000;
	return {
		directory,
		acquisition,
		path,
		logger,
		now: () => now,
		advance: (milliseconds: number) => {
			now += milliseconds;
		},
		open: () => new SourceCooldownFile(directory, logger, () => now),
		seed: async (content: string) => {
			await mkdir(acquisition, { recursive: true });
			await writeFile(path, content, { mode: 0o644 });
		},
	};
}

test("close drains opaque cooldown writes and reopened gates enforce the saved deadline", async () => {
	const f = await fixture();
	const file = f.open();
	expect(await file.read()).toEqual({});
	const connection = jackettConnectionKey("http://jackett:9117");
	const indexer = jackettIndexerKey("http://jackett:9117", "example");
	const gate = new SourceRequestGate(0, f.now, {
		onCooldown: (key, until) => file.set(key, until),
	});
	gate.cooldown(connection, 10_000);
	gate.cooldown(indexer, 12_000);
	gate.cooldown(connection, 8000);
	await file.close();
	const reopened = f.open();
	const cooldowns = await reopened.read();
	expect(cooldowns).toEqual({ [connection]: 10_000, [indexer]: 12_000 });
	const restored = new SourceRequestGate(0, f.now, { cooldowns });
	const operation = vi.fn(async () => "fetched");
	await expect(
		restored.runMany(
			[connection, indexer],
			new AbortController().signal,
			operation,
		),
	).rejects.toMatchObject({
		code: "rate_limited",
		retryAt: 12_000,
	});
	expect(operation).not.toHaveBeenCalled();
	f.advance(11_000);
	await expect(
		restored.runMany(
			[connection, indexer],
			new AbortController().signal,
			operation,
		),
	).resolves.toBe("fetched");
	await reopened.close();
});

test("prunes expired persisted cooldowns on restore and subsequent writes", async () => {
	const f = await fixture();
	const expired = sourceOriginKey("https://expired.example/feed");
	const active = sourceOriginKey("https://active.example/feed");
	await f.seed(
		JSON.stringify({
			version: 1,
			cooldowns: { [expired]: 1000, [active]: 2000 },
		}),
	);
	const file = f.open();
	expect(await file.read()).toEqual({ [active]: 2000 });
	f.advance(1000);
	const next = sourceOriginKey("https://next.example/feed");
	file.set(next, 3000);
	await file.close();
	expect(JSON.parse(await readFile(f.path, "utf8"))).toEqual({
		version: 1,
		cooldowns: { [next]: 3000 },
	});
});

const invalidFiles = [
	["malformed JSON", "{"],
	["unsupported version", JSON.stringify({ version: 2, cooldowns: {} })],
	[
		"raw identity",
		JSON.stringify({
			version: 1,
			cooldowns: { "https://private.example/?apikey=secret": 2000 },
		}),
	],
	[
		"invalid deadline",
		JSON.stringify({
			version: 1,
			cooldowns: { [sourceOriginKey("https://example.com")]: "later" },
		}),
	],
	[
		"too many entries",
		JSON.stringify({
			version: 1,
			cooldowns: Object.fromEntries(
				Array.from({ length: 4098 }, (_, index) => [
					`origin:${index.toString(16).padStart(64, "0")}`,
					2000,
				]),
			),
		}),
	],
	["oversized file", " ".repeat(512 * 1024 + 1)],
] as const;

test.each(invalidFiles)(
	"%s defers all source requests for 60 seconds",
	async (_name, content) => {
		const f = await fixture();
		await f.seed(content);
		const warning = vi.spyOn(f.logger, "warn");
		const file = f.open();
		const cooldowns = await file.read();
		expect(cooldowns).toEqual({ [outboundCooldownOverflowKey]: 61_000 });
		expect(warning).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "acquisition.cooldown_restore_failed",
				retryAt: 61_000,
			}),
			expect.any(String),
		);
		const gate = new SourceRequestGate(0, f.now, { cooldowns });
		const operation = vi.fn(async () => "fetched");
		await expect(
			gate.run(
				sourceOriginKey("https://unrelated.example"),
				new AbortController().signal,
				operation,
			),
		).rejects.toMatchObject({ code: "rate_limited", retryAt: 61_000 });
		expect(operation).not.toHaveBeenCalled();
		f.advance(60_000);
		await expect(
			gate.run(
				sourceOriginKey("https://unrelated.example"),
				new AbortController().signal,
				operation,
			),
		).resolves.toBe("fetched");
		await file.close();
	},
);

test("persists only opaque identities and creates private directories and files", async () => {
	const f = await fixture();
	const file = f.open();
	const privateUrl = "https://user:password@private.example/feed?apikey=secret";
	const key = sourceOriginKey(privateUrl);
	file.set(privateUrl, 10_000);
	file.set("origin:private.example", 10_000);
	file.set(key, 10_000);
	await file.close();
	const content = await readFile(f.path, "utf8");
	expect(content).not.toMatch(/private\.example|user|password|apikey|secret/);
	expect(JSON.parse(content)).toEqual({
		version: 1,
		cooldowns: { [key]: 10_000 },
	});
	expect((await stat(f.path)).mode & 0o777).toBe(0o600);
	expect((await stat(f.acquisition)).mode & 0o777).toBe(0o700);
});

test("tightens permissions on an existing cooldown file", async () => {
	const f = await fixture();
	await f.seed(JSON.stringify({ version: 1, cooldowns: {} }));
	const file = f.open();
	await file.read();
	expect((await stat(f.path)).mode & 0o777).toBe(0o600);
	await file.close();
});

test("bounds persisted cooldowns without discarding the longest active deadline", async () => {
	const f = await fixture();
	const file = f.open();
	for (let index = 0; index < 4098; index++)
		file.set(`origin:${index.toString(16).padStart(64, "0")}`, 2000 + index);
	await file.close();
	const saved = JSON.parse(await readFile(f.path, "utf8"));
	expect(saved.cooldowns).toEqual({ [outboundCooldownOverflowKey]: 6097 });
	const reopened = f.open();
	const cooldowns = await reopened.read();
	const gate = new SourceRequestGate(0, f.now, { cooldowns });
	await expect(
		gate.run(null, new AbortController().signal, async () => undefined),
	).rejects.toMatchObject({ code: "rate_limited", retryAt: 6097 });
	await reopened.close();
});
