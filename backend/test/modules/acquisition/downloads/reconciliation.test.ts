import { expect, test, vi } from "vitest";
import {
	DownloadContext,
	DownloadExecution,
} from "../../../../src/modules/acquisition/downloads/application/context.js";
import { DownloadTransfers } from "../../../../src/modules/acquisition/downloads/transfers/application.js";
import { TorrentError } from "../../../../src/modules/acquisition/torrent-clients/public.js";

import {
	fixture,
	key,
	logger,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();

test("remote add success followed by a timeout binds after restart without resending", async () => {
	const f = await fixture(true);
	await f.configure();
	await f.authorize();
	const actual = f.add.getMockImplementation();
	f.add.mockImplementationOnce(async (input) => {
		await actual?.(input);
		throw new TorrentError("timeout", "unknown");
	});
	await f.worker.tick();
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items[0]?.state).toBe(
		"unknown",
	);
	await f.restart();
	f.advance();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items[0]?.state).toBe(
		"bound",
	);
});

test("successful add without a matching remote task stays unknown and is not resent", async () => {
	const f = await fixture(true);
	await f.configure();
	await f.authorize();
	f.add.mockResolvedValueOnce(undefined);
	await f.worker.tick();
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items[0]?.state).toBe(
		"unknown",
	);
	await f.restart();
	f.advance();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items[0]?.state).toBe(
		"unknown",
	);
});

test("uncertain absent submissions are not retried automatically; explicit retry is idempotent", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.add.mockRejectedValueOnce(new TorrentError("timeout", "unknown"));
	await f.worker.tick();
	f.advance();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	f.worker.retry(item.id, item.revision, "manual", "acquisition");
	f.worker.retry(item.id, item.revision, "manual", "acquisition");
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(2);
});

test("external pause remains paused and external removal suppresses acquisition across restart", async () => {
	const f = await fixture(true);
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	if (!f.state.task) throw new Error();
	f.state.task.state = "paused";
	await f.worker.tick();
	expect(f.state.task.state).toBe("paused");
	f.state.task = null;
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.state).toBe("missing");
	await f.restart();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("disconnection is not task removal and account replacement does not control new account tasks", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	vi.mocked(f.client.task).mockRejectedValueOnce(
		new TorrentError("unavailable", "read"),
	);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.state).toBe("bound");
	f.changeAccount();
	f.advance();
	await f.worker.tick();
	expect(f.worker.activity(key).authorized).toBe(false);
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("account changes block stale bindings until explicit recovery reconciles the owned hash in the new connection", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.changeAccount();
	await f.worker.tick();
	let item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	expect(item).toMatchObject({
		state: "blocked",
		error: "downloader_configuration_changed",
	});
	expect((await f.worker.settings()).destination?.validated).toBe(false);
	await f.configure();
	await f.authorize();
	item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	f.worker.retry(item.id, item.revision, "recover-connection", "acquisition");
	await f.worker.tick();
	expect(
		f.db.acquisitionDownloads.activity(key, 1, 100).items[0],
	).toMatchObject({
		state: "bound",
		destination: { connectionGeneration: "account-2" },
	});
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("late remote failures cannot overwrite a newer explicit acquisition retry", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.add.mockRejectedValueOnce(new TorrentError("timeout", "unknown"));
	await f.worker.tick();
	f.advance();
	vi.mocked(f.client.task).mockImplementationOnce(async () => {
		const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
		if (!item) throw new Error();
		f.worker.retry(item.id, item.revision, "newer-command", "acquisition");
		throw new TorrentError("unavailable", "read");
	});
	await f.worker.tick();
	expect(
		f.db.acquisitionDownloads.activity(key, 1, 100).items[0],
	).toMatchObject({
		state: "pending",
		error: null,
		nextAttemptAt: 0,
		lastCommand: { id: "newer-command" },
	});
	expect(f.add).toHaveBeenCalledTimes(1);
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(2);
});

test("transfer reconciles uncertain attempts without consulting subscription admission or resending", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.add.mockRejectedValueOnce(new TorrentError("timeout", "unknown"));
	await f.worker.tick();
	const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error("Missing intent");
	expect(item.state).toBe("unknown");
	const context = new DownloadContext({
		store: f.db.acquisitionDownloads,
		transport: f.reader,
		connectionGeneration: () => item.destination.connectionGeneration,
		withClient: async (_generation, operation) => operation(f.client),
		logger,
	});
	const authorize = vi.fn(async () => {
		throw new Error("Admission must not run for uncertain attempts");
	});
	const transfer = new DownloadTransfers(context, { authorize });
	expect(await transfer.run(new DownloadExecution(context, item))).toBeNull();
	expect(authorize).not.toHaveBeenCalled();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.db.acquisitionDownloads.intent(item.id)?.state).toBe("unknown");
});
