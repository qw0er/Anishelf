import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { ApiClientError, createApiClient } from "@anishelf/client-core";
import type {
	DeviceLoginResponse,
	DeviceSession,
} from "@anishelf/contracts/http";
import { safeStorage } from "electron";

const devicePath = "/api/auth/device-sessions";
const currentPath = `${devicePath}/current`;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export type DesktopDeviceSession = Awaited<
	ReturnType<typeof createDesktopDeviceSession>
>;

export async function createDesktopDeviceSession(
	target: URL,
	userData: string,
) {
	const directory = join(userData, "device-sessions");
	const id = createHash("sha256").update(target.origin).digest("hex");
	const path = join(directory, id);
	const persistent =
		(process.platform !== "linux" ||
			safeStorage.getSelectedStorageBackend() !== "basic_text") &&
		(await safeStorage.isAsyncEncryptionAvailable().catch(() => false));
	let token: string | undefined;
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
				console.warn("desktop.device_session_restore_failed", {
					server: target.origin,
				});
		}
	} else {
		console.info("desktop.device_session_memory_only", {
			server: target.origin,
		});
	}

	async function save(value: string | undefined) {
		if (!value) {
			token = undefined;
			await rm(path, { force: true }).catch(() => {
				console.warn("desktop.device_session_delete_failed", {
					server: target.origin,
				});
			});
			return;
		} else if (persistent) {
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
		token = value;
	}

	const requestServer = (pathname: string, init: RequestInit) =>
		fetch(new URL(pathname, target), {
			...init,
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
	const api = createApiClient({
		fetch: requestServer,
		policy: {
			headers: () => (token ? { Authorization: `Bearer ${token}` } : undefined),
		},
	});
	const loginApi = createApiClient({ fetch: requestServer });

	let pending: Promise<unknown> = Promise.resolve();
	function serialize<T>(action: () => Promise<T>) {
		const task = pending.then(action);
		pending = task.catch(() => {});
		return task;
	}

	async function current() {
		if (!token) return { authenticated: false };
		try {
			await api.request<DeviceSession>(currentPath, "GET");
			return { authenticated: true };
		} catch (error) {
			if (!(error instanceof ApiClientError && error.status === 401))
				throw error;
			await save(undefined);
			return { authenticated: false };
		}
	}

	return {
		authorization: () => (token ? `Bearer ${token}` : undefined),
		getSession: () => serialize(current),
		signIn: (password: string) =>
			serialize(async () => {
				if ((await current()).authenticated) return;
				const name = `Anishelf Desktop (${hostname()})`
					.replace(/[\p{Cc}\p{Cf}]/gu, "")
					.slice(0, 80);
				const login = await loginApi.request<DeviceLoginResponse>(
					devicePath,
					"POST",
					{},
					{ name, password },
				);
				if (!tokenPattern.test(login.token))
					throw new Error("The server returned an invalid device token.");
				try {
					await save(login.token);
				} catch {
					token = login.token;
					console.warn("desktop.device_session_persist_failed", {
						server: target.origin,
					});
				}
				console.info("desktop.device_signed_in", { server: target.origin });
			}),
		signOut: () =>
			serialize(async () => {
				if (token) {
					try {
						await api.request(currentPath, "DELETE");
					} catch (error) {
						if (!(error instanceof ApiClientError && error.status === 401))
							throw error;
					}
				}
				await save(undefined);
				console.info("desktop.device_signed_out", { server: target.origin });
			}),
	};
}
