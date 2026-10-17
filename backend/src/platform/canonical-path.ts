import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
/** Resolve existing ancestors even when a configured directory is unavailable. */
export async function canonicalPath(path: string): Promise<string> {
	const absolute = resolve(path);
	let candidate = absolute;
	const suffix: string[] = [];
	while (true) {
		try {
			return join(await realpath(candidate), ...suffix);
		} catch {
			const parent = dirname(candidate);
			if (parent === candidate) return absolute;
			suffix.unshift(basename(candidate));
			candidate = parent;
		}
	}
}
