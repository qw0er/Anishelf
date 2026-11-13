import pino from "pino";
import { expect, test, vi } from "vitest";
import { RootMonitorManager } from "../../../../src/modules/resources/library/application/root-monitor-manager.js";
import { FilesystemWatcher } from "../../../../src/modules/resources/library/infrastructure/filesystem-watcher.js";
import { libraryPolicy } from "../../../../src/modules/resources/library/policy.js";

test("shutdown during watcher initialization prevents opening subsequent roots or restarting monitoring", async () => {
	const manager = new RootMonitorManager({
		policy: libraryPolicy,
		logger: pino({ enabled: false }),
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
