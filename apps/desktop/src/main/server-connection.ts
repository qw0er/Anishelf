import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { net } from "electron";
import { parseServerOrigin } from "./server-address.js";

const settingsFile = "server-origin";

export async function readServerOrigin(
	profile: string,
): Promise<string | null> {
	try {
		const saved = await readFile(join(profile, settingsFile), "utf8");
		const origin = parseServerOrigin(saved);
		if (origin) return origin;
		console.warn("desktop.saved_server_invalid");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			console.warn("desktop.saved_server_read_failed");
	}
	return null;
}

export async function writeServerOrigin(
	profile: string,
	origin: string | null,
) {
	const path = join(profile, settingsFile);
	if (origin === null) {
		await rm(path, { force: true });
		return;
	}
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${origin}\n`, { mode: 0o600, flag: "wx" });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true }).catch(() => {
			console.warn("desktop.server_settings_cleanup_failed");
		});
	}
}

export async function checkServerConnection(
	origin: string,
): Promise<"ok" | "invalidResponse" | "unreachable"> {
	try {
		const response = await net.fetch(`${origin}/api/health`, {
			credentials: "omit",
			redirect: "error",
			cache: "no-store",
			signal: AbortSignal.timeout(5_000),
		});
		if (response.ok) {
			const body: unknown = await response.json().catch((error: unknown) => {
				if (error instanceof SyntaxError) return null;
				throw error;
			});
			if (
				body &&
				typeof body === "object" &&
				"status" in body &&
				body.status === "ok"
			)
				return "ok";
		} else {
			await response.body?.cancel();
		}
		console.warn("desktop.server_check_invalid_response", {
			origin,
			status: response.status,
		});
		return "invalidResponse";
	} catch {
		console.warn("desktop.server_check_unreachable", { origin });
		return "unreachable";
	}
}
