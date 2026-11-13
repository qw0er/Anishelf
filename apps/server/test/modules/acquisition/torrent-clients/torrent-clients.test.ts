import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { TorrentClientConnection } from "../../../../src/modules/acquisition/torrent-clients/application/connection.js";
import { createTorrentClientsModule } from "../../../../src/modules/acquisition/torrent-clients/create.js";
import {
	type TorrentClient,
	type TorrentConnectionStatus,
	TorrentError,
} from "../../../../src/modules/acquisition/torrent-clients/public.js";

const logger = pino({ enabled: false });
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
function engine() {
	return {
		probe: vi.fn<TorrentClient["probe"]>(async () => ({
			version: "alternative-engine",
			incompleteDirectory: "/staging",
		})),
		tasks: vi.fn<TorrentClient["tasks"]>(async () => []),
		task: vi.fn<TorrentClient["task"]>(async () => null),
		files: vi.fn<TorrentClient["files"]>(async () => []),
		add: vi.fn<TorrentClient["add"]>(async () => {}),
		close: vi.fn<TorrentClient["close"]>(async () => {}),
	};
}
function fixture() {
	const status: TorrentConnectionStatus = {
		generation: "first",
		state: "configured",
	};
	const client = engine();
	const createClient = vi.fn(() => client);
	const connection = new TorrentClientConnection(
		{ settings: () => status, createClient },
		logger,
	);
	cleanup.push(() => connection.close());
	return { status, client, createClient, connection };
}

test("provider-independent connection reuses clients and fences replaced accounts", async () => {
	const f = fixture();
	expect((await f.connection.probe("first")).version).toBe(
		"alternative-engine",
	);
	await f.connection.withClient("first", (client) => client.tasks());
	expect(f.createClient).toHaveBeenCalledTimes(1);
	f.status.generation = "second";
	await f.connection.invalidate();
	expect(f.client.close).toHaveBeenCalledTimes(1);
	const next = engine();
	f.createClient.mockReturnValue(next);
	await expect(
		f.connection.withClient("first", (client) => client.tasks()),
	).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
	await f.connection.probe("second");
	expect(next.probe).toHaveBeenCalledTimes(1);
	expect(f.createClient).toHaveBeenCalledTimes(2);
});

test("late client results cannot acknowledge a replaced generation", async () => {
	const f = fixture();
	let release = () => {};
	const pending = f.connection.withClient(
		"first",
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const assertion = expect(pending).rejects.toMatchObject({
		code: "ACQUISITION_CONFLICT",
	});
	f.status.generation = "second";
	await f.connection.invalidate();
	release();
	await assertion;
});

test("unconfigured, unavailable and failed snapshots stay distinct", async () => {
	const f = fixture();
	f.status.state = "unconfigured";
	expect(
		await f.connection.activeHashes(new AbortController().signal),
	).toBeNull();
	expect(f.createClient).not.toHaveBeenCalled();
	f.status.state = "unavailable";
	await expect(
		f.connection.activeHashes(new AbortController().signal),
	).rejects.toMatchObject({ code: "ACQUISITION_UNAVAILABLE" });
	f.status.state = "configured";
	f.client.tasks.mockRejectedValueOnce(new TorrentError("timeout", "read"));
	await expect(
		f.connection.activeHashes(new AbortController().signal),
	).rejects.toMatchObject({ code: "timeout", outcome: "read" });
	expect(await f.connection.activeHashes(new AbortController().signal)).toEqual(
		[],
	);
});

test("connection probes serialize and preserve normalized failure codes", async () => {
	const f = fixture();
	let release = () => {};
	f.client.probe.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = () =>
					resolve({ version: "alternative-engine", incompleteDirectory: null });
			}),
	);
	const pending = f.connection.probe("first");
	await expect(f.connection.probe("first")).rejects.toMatchObject({
		code: "ACQUISITION_UNAVAILABLE",
	});
	release();
	expect((await pending).available).toBe(true);
	f.client.probe.mockRejectedValueOnce(
		new TorrentError("unauthorized", "read"),
	);
	expect(await f.connection.probe("first")).toMatchObject({
		available: false,
		version: null,
		code: "unauthorized",
	});
});

test("TorrentClients starts and shuts down without Downloads or any database", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "anishelf-torrent-clients-"));
	cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
	const client = engine();
	const logs: string[] = [];
	const createClient = vi.fn(() => client);
	const module = await createTorrentClientsModule({
		dataDir,
		createClient,
		logger: pino({ level: "debug" }, { write: (line) => logs.push(line) }),
	});
	cleanup.push(() => module.runtime.close());
	expect(createClient).not.toHaveBeenCalled();
	const saved = await module.api.connection.save({
		generation: module.api.connectionGeneration(),
		url: "http://downloader:8080",
		username: "secret-user",
		password: "secret-password",
	});
	await module.api.withClient(saved.generation, (active) => active.tasks());
	expect(createClient).toHaveBeenCalledTimes(1);
	expect(client.add).not.toHaveBeenCalled();
	const closing = module.runtime.close();
	expect(module.runtime.close()).toBe(closing);
	await closing;
	expect(client.close).toHaveBeenCalledTimes(1);
	await expect(
		module.api.withClient(saved.generation, (active) => active.tasks()),
	).rejects.toMatchObject({ code: "ACQUISITION_UNAVAILABLE" });
	await expect(
		module.api.connection.clear(saved.generation),
	).rejects.toMatchObject({ code: "ACQUISITION_UNAVAILABLE" });
	expect(logs.join("")).toContain("torrent_clients.initialized");
	expect(logs.join("")).toContain("torrent_clients.stopped");
	expect(logs.join("")).not.toMatch(/secret-user|secret-password/);
});
