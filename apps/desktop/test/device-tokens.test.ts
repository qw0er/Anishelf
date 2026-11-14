import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { openDeviceTokenStore } from "../src/main/server/device-tokens.js";

const storage = vi.hoisted(() => ({
	getSelectedStorageBackend: () => "kwallet6",
	isAsyncEncryptionAvailable: vi.fn(async () => true),
	encryptStringAsync: vi.fn(async (token: string) => Buffer.from(token)),
	decryptStringAsync: async (bytes: Buffer) => ({ result: bytes.toString() }),
}));
vi.mock("electron", () => ({ safeStorage: storage }));

test("device credentials restore after a failed write and clear in order", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-device-session-"));
	const origin = "https://example.test";
	try {
		const store = await openDeviceTokenStore(origin, directory);
		const first = "a".repeat(43);
		const second = "b".repeat(43);
		storage.encryptStringAsync.mockRejectedValueOnce(new Error("Unavailable"));
		const failed = store.set(first);
		const written = store.set(second);
		expect(store.authorization()).toBe(`Bearer ${second}`);
		await Promise.all([failed, written]);
		const restored = await openDeviceTokenStore(origin, directory);
		expect(restored.authorization()).toBe(`Bearer ${second}`);

		await Promise.all([restored.set(first), restored.set(null)]);
		expect(
			(await openDeviceTokenStore(origin, directory)).authorization(),
		).toBeUndefined();

		storage.isAsyncEncryptionAvailable.mockResolvedValueOnce(false);
		const memoryOnly = await openDeviceTokenStore(origin, directory);
		await memoryOnly.set(second);
		expect(memoryOnly.authorization()).toBe(`Bearer ${second}`);
		expect(
			(await openDeviceTokenStore(origin, directory)).authorization(),
		).toBeUndefined();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
