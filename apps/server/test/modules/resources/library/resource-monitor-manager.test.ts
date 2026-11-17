import pino from "pino";
import { expect, test, vi } from "vitest";
import { RootMonitorManager } from "../../../../src/modules/resources/library/application/root-monitor-manager.js";
import { FilesystemWatcher } from "../../../../src/modules/resources/library/infrastructure/filesystem-watcher.js";
import { libraryPolicy } from "../../../../src/modules/resources/library/policy.js";

test("periodic refresh waits for idle, never overlaps, and drains on reset", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const manager = new RootMonitorManager({
		policy: { ...libraryPolicy, periodicRefreshMs: 100, monitorRetryMs: 10 },
		logger: pino({ enabled: false }),
		mode: "periodic",
	});
	const complete = Promise.withResolvers<void>();
	const refresh = vi.fn<Parameters<RootMonitorManager["sync"]>[1]["refresh"]>(
		() => complete.promise,
	);
	let busy = true;
	try {
		await manager.sync(
			[{ scopeId: "media", path: "/media", name: "Media", error: null }],
			{
				isBusy: () => busy,
				apply: async () => true,
				reconcile: async () => {},
				refresh,
			},
		);
		await vi.advanceTimersByTimeAsync(100);
		expect(refresh).not.toHaveBeenCalled();
		busy = false;
		await vi.advanceTimersByTimeAsync(10);
		expect(refresh).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(200);
		expect(refresh).toHaveBeenCalledOnce();
		const signal = refresh.mock.calls[0]?.[1];
		const drained = vi.fn();
		const resetting = manager.reset().then(drained);
		expect(signal?.aborted).toBe(true);
		expect(drained).not.toHaveBeenCalled();
		complete.resolve();
		await resetting;
		expect(manager.state.status).toBe("disabled");
		await vi.advanceTimersByTimeAsync(200);
		expect(refresh).toHaveBeenCalledOnce();
	} finally {
		complete.resolve();
		await manager.close();
		vi.useRealTimers();
	}
});

test("shutdown during watcher initialization prevents opening subsequent roots or restarting monitoring", async () => {
	const manager = new RootMonitorManager({
		policy: libraryPolicy,
		logger: pino({ enabled: false }),
		mode: "events",
	});
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered = () => {};
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const original = FilesystemWatcher.prototype.start;
	const start = vi
		.spyOn(FilesystemWatcher.prototype, "start")
		.mockImplementationOnce(async function (
			this: FilesystemWatcher,
			path,
			restart,
		) {
			entered();
			await gate;
			return original.call(this, path, restart);
		});
	const roots = [
		{
			scopeId: "first",
			path: "/unavailable/first",
			name: "First",
			error: null,
		},
		{
			scopeId: "second",
			path: "/unavailable/second",
			name: "Second",
			error: null,
		},
	];
	const actions = {
		isBusy: () => false,
		apply: async () => true,
		reconcile: async () => {},
		refresh: async () => {},
	};
	const syncing = manager.sync(roots, actions);
	try {
		await started;
		const closing = manager.close();
		release();
		await Promise.all([syncing, closing]);
		expect(start).toHaveBeenCalledTimes(1);
		expect(manager.state.status).toBe("disabled");
		await manager.sync(roots, actions);
		expect(start).toHaveBeenCalledTimes(1);
	} finally {
		release();
		await manager.close();
		await syncing;
		start.mockRestore();
	}
});
