import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeStorage } from "electron";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function isDeviceToken(value: unknown): value is string {
	return typeof value === "string" && tokenPattern.test(value);
}

export async function openDeviceTokenStore(
	server: string,
	userData: string,
): Promise<DeviceTokenStore> {
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
			if (isDeviceToken(result)) token = result;
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				console.warn("desktop.device_session_restore_failed", { server });
		}
	} else {
		console.info("desktop.device_session_memory_only", { server });
	}

	return new DeviceTokenStore({ server, directory, path, persistent }, token);
}

class DeviceTokenStore {
	private token: string | null;
	private pending = Promise.resolve();

	constructor(
		private readonly options: {
			server: string;
			directory: string;
			path: string;
			persistent: boolean;
		},
		token: string | null,
	) {
		this.token = token;
	}

	authorization(): string | undefined {
		return this.token ? `Bearer ${this.token}` : undefined;
	}

	set(value: unknown): Promise<void> {
		if (value !== null && !isDeviceToken(value))
			throw new Error("Invalid device credential.");
		if (this.token === value) return this.pending;

		this.token = value;
		this.pending = this.pending
			.then(() => this.persist(value))
			.catch(() => {
				console.warn("desktop.device_session_persist_failed", {
					server: this.options.server,
				});
			});
		return this.pending;
	}

	private async persist(value: string | null): Promise<void> {
		if (!value) {
			await rm(this.options.path, { force: true });
			return;
		}
		if (!this.options.persistent) return;
		const data = await safeStorage.encryptStringAsync(value);
		await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
		const temporary = `${this.options.path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
			await rename(temporary, this.options.path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
}
