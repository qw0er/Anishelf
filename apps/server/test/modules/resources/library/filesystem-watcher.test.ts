import { EventEmitter } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { FilesystemWatcher } from "../../../../src/modules/resources/library/infrastructure/filesystem-watcher.js";
import { libraryPolicy } from "../../../../src/modules/resources/library/policy.js";

vi.mock("chokidar", () => ({ watch: vi.fn() }));

test("closing before Chokidar is ready releases it once and ignores late events", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "anishelf-subscription-"));
	const root = await realpath(temporary);
	const opened = Promise.withResolvers<void>();
	const native = Object.assign(new EventEmitter(), {
		close: vi.fn(async () => {}),
	});
	vi.mocked(watch).mockImplementationOnce(() => {
		opened.resolve();
		return native as unknown as FSWatcher;
	});
	const onChange = vi.fn();
	const onError = vi.fn();
	const watcher = new FilesystemWatcher({
		policy: libraryPolicy,
		logger: pino({ enabled: false }),
		onChange,
		onError,
	});
	const starting = watcher.start(root);
	try {
		await opened.promise;
		expect(watcher.state.status).toBe("starting");
		const closing = watcher.close();
		native.emit("all", "unlink", join(root, "gone.mkv"));
		native.emit("error", new Error("Callback from a closed watcher"));
		await Promise.all([starting, closing]);
		native.emit("ready");
		expect(native.close).toHaveBeenCalledTimes(1);
		expect(watcher.state.status).toBe("disabled");
		expect(onChange).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	} finally {
		await watcher.close();
		await rm(temporary, { recursive: true, force: true });
	}
});
