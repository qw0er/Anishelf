import { randomUUID } from "node:crypto";
import { lstat, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { lock } from "proper-lockfile";
import { removeFile, renameFile } from "./filesystem.js";
import { storageRules } from "./storage.js";

async function lockStateFile(path: string) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await lock(path, { realpath: false });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || attempt >= 15)
				throw error;
			await delay(Math.min(50 * 2 ** attempt, 1_000));
		}
	}
}

/** Serialize writers and publish complete state by rename. Readers need no lock. */
export async function writeStateFile(
	path: string,
	content: string,
	{ createOnly = false }: { createOnly?: boolean } = {},
): Promise<boolean> {
	const release = await lockStateFile(path);
	const temporary = `${path}.${randomUUID()}.pending`;
	try {
		if (createOnly) {
			const existing = await lstat(path).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT") throw error;
				},
			);
			if (existing) return false;
		}
		await writeFile(temporary, content, {
			flag: "wx",
			mode: storageRules.fileMode,
			flush: true,
		});
		await renameFile(temporary, path);
		return true;
	} finally {
		await removeFile(temporary, { force: true }).catch(() => {});
		await release().catch(() =>
			process.emitWarning("Could not release a state file lock.", {
				code: "STATE_FILE_LOCK_RELEASE_FAILED",
			}),
		);
	}
}
