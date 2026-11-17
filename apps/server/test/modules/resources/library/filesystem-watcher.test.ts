import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AsyncSubscription,
	type SubscribeCallback,
	subscribe,
} from "@parcel/watcher";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { FilesystemWatcher } from "../../../../src/modules/resources/library/infrastructure/filesystem-watcher.js";
import { libraryPolicy } from "../../../../src/modules/resources/library/policy.js";

vi.mock("@parcel/watcher", () => ({ subscribe: vi.fn() }));

test("closing waits for an opening subscription and releases it once", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "anishelf-subscription-"));
	const root = await realpath(temporary);
	const pending = Promise.withResolvers<AsyncSubscription>();
	const called = Promise.withResolvers<SubscribeCallback>();
	const unsubscribe = vi.fn(async () => {});
	vi.mocked(subscribe).mockImplementationOnce(async (_root, callback) => {
		called.resolve(callback);
		return pending.promise;
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
		const callback = await called.promise;
		expect(watcher.state.status).toBe("starting");
		const closing = watcher.close();
		expect(unsubscribe).not.toHaveBeenCalled();
		callback(null, [{ type: "delete", path: join(root, "gone.mkv") }]);
		callback(new Error("Callback from a closed subscription"), []);
		pending.resolve({ unsubscribe });
		await Promise.all([starting, closing]);
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(watcher.state.status).toBe("disabled");
		expect(onChange).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	} finally {
		pending.resolve({ unsubscribe });
		await watcher.close();
		await rm(temporary, { recursive: true, force: true });
	}
});
