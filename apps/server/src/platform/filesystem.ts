import type { RmOptions } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const sharingErrors = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

export function isWindowsSharingError(error: unknown): boolean {
	return (
		process.platform === "win32" &&
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string" &&
		sharingErrors.has(error.code)
	);
}

/** Windows background processes can briefly hold files open during publication. */
async function retryWindowsFileOperation<T>(
	operation: () => Promise<T>,
): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (attempt >= 3 || !isWindowsSharingError(error)) throw error;
			await delay(50 * 2 ** attempt);
		}
	}
}

export function renameFile(source: string, target: string): Promise<void> {
	return retryWindowsFileOperation(() => rename(source, target));
}

export function removeFile(path: string, options?: RmOptions): Promise<void> {
	return retryWindowsFileOperation(() => rm(path, options));
}

/** Windows has no directory equivalent of the POSIX directory fsync used here. */
export async function syncDirectory(path: string): Promise<void> {
	if (process.platform === "win32") return;
	const directory = await open(path, "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}
