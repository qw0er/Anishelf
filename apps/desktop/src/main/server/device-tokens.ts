import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeStorage } from "electron";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export async function openDeviceTokenStore(server: string, userData: string) {
	const directory = join(userData, "device-sessions");
	const id = createHash("sha256").update(server).digest("hex");
	const path = join(directory, id);
	const persistent =
		(process.platform !== "linux" ||
			safeStorage.getSelectedStorageBackend() !== "basic_text") &&
		(await safeStorage.isAsyncEncryptionAvailable().catch(() => false));
	let token: string | null = null;
	if (persistent) {
		try {
			const { result } = await safeStorage.decryptStringAsync(
				await readFile(path),
			);
			if (tokenPattern.test(result)) token = result;
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				console.warn("desktop.device_session_restore_failed", { server });
		}
	} else {
		console.info("desktop.device_session_memory_only", { server });
	}

	async function persist(value: string | null) {
		if (!value) {
			await rm(path, { force: true });
			return;
		}
		if (!persistent) return;
		const data = await safeStorage.encryptStringAsync(value);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}

	let pending = Promise.resolve();
	return {
		authorization: () => (token ? `Bearer ${token}` : undefined),
		set(value: unknown) {
			if (
				value !== null &&
				(typeof value !== "string" || !tokenPattern.test(value))
			)
				throw new Error("Invalid device credential.");
			if (token === value) return pending;
			token = value;
			pending = pending
				.then(() => persist(value))
				.catch(() => {
					console.warn("desktop.device_session_persist_failed", { server });
				});
			return pending;
		},
	};
}
