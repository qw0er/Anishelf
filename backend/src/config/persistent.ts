import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import type { PersistentSettings } from "../contracts/config.js";
import type { LibraryIssue } from "../contracts/library.js";
import { DomainError } from "../errors.js";

export function parsePersistentSettings(source: string): PersistentSettings {
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch {
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json is not valid JSON. Check its syntax.",
		);
	}
	return validatePersistentSettings(value);
}

function validatePersistentSettings(value: unknown): PersistentSettings {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json must contain a JSON object.",
		);
	}
	const settings = value as Record<string, unknown>;
	for (const key of Object.keys(settings)) {
		if (key !== "resourceRoot")
			throw new DomainError(
				"CONFIG_INVALID",
				`Unknown persistent setting: ${key}.`,
			);
	}
	const root = settings.resourceRoot;
	if (
		typeof root !== "string" ||
		root.trim() === "" ||
		root.includes("\0") ||
		!isAbsolute(root)
	) {
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json resourceRoot must be an absolute filesystem path.",
		);
	}
	return { resourceRoot: root };
}

function contains(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return (
		path === "" ||
		(path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
	);
}

/** Read-only; missing settings require the user to supply the resource root. */
async function loadPersistentSettings(
	dataDir: string,
): Promise<PersistentSettings> {
	const path = join(dataDir, "settings.json");
	let source: string;
	try {
		source = await readFile(path, "utf8");
	} catch {
		throw new DomainError(
			"CONFIG_INVALID",
			`Cannot read ${path}. Create a readable settings.json containing an absolute resourceRoot.`,
		);
	}
	const settings = parsePersistentSettings(source);
	await checkDirectorySeparation(dataDir, settings.resourceRoot);
	return settings;
}

/** Resolve existing ancestors even when the configured directory is unavailable. */
async function canonicalSettingsPath(path: string): Promise<string> {
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

async function checkDirectorySeparation(
	dataDir: string,
	resourceRoot: string,
): Promise<void> {
	const [data, root] = await Promise.all([
		canonicalSettingsPath(dataDir),
		canonicalSettingsPath(resourceRoot),
	]);
	if (contains(data, root) || contains(root, data)) {
		throw new DomainError(
			"CONFIG_INVALID",
			"dataDir and resourceRoot must be separate directories; neither may contain the other.",
		);
	}
}

/** Owns the current settings; updates persist before becoming visible in memory. */
export class PersistentConfiguration {
	private pendingWrite: Promise<void> = Promise.resolve();
	private readonly dataDir: string;
	private current: PersistentSettings;

	private constructor(dataDir: string, current: PersistentSettings) {
		this.dataDir = dataDir;
		this.current = current;
	}

	static async load(dataDir: string): Promise<PersistentConfiguration> {
		return new PersistentConfiguration(
			dataDir,
			await loadPersistentSettings(dataDir),
		);
	}

	get settings(): Readonly<PersistentSettings> {
		return { ...this.current };
	}

	/** Replace the settings. Calls are serialized; rejected writes leave state unchanged. */
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>> {
		let next: PersistentSettings;
		try {
			next = validatePersistentSettings(settings);
		} catch (error) {
			return Promise.reject(error);
		}
		const result = this.pendingWrite.then(async () => {
			await checkDirectorySeparation(this.dataDir, next.resourceRoot);
			await writePersistentSettings(this.dataDir, next);
			this.current = next;
			return this.settings;
		});
		this.pendingWrite = result.then(
			() => {},
			() => {},
		);
		return result;
	}
}

async function writePersistentSettings(
	dataDir: string,
	settings: PersistentSettings,
): Promise<void> {
	const target = join(dataDir, "settings.json");
	const temporary = join(dataDir, `.settings-${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		await rename(temporary, target);
	} catch (cause) {
		throw new DomainError(
			"CONFIG_WRITE_FAILED",
			"Cannot save persistent settings. Check the data directory and permissions.",
			{ cause },
		);
	} finally {
		// Best-effort cleanup must not hide the original write error.
		await rm(temporary, { force: true }).catch(() => {});
	}
}

/** Root availability is recoverable and must be checked again before scanning. */
export async function checkResourceRoot(
	settings: PersistentSettings,
): Promise<LibraryIssue | null> {
	try {
		if (!(await stat(settings.resourceRoot)).isDirectory())
			throw new Error("Not a directory");
		await access(settings.resourceRoot, constants.R_OK | constants.X_OK);
		return null;
	} catch {
		return {
			code: "RESOURCE_ROOT_UNAVAILABLE",
			message:
				"The configured resource directory is missing or unreadable. Fix the directory and scan again.",
		};
	}
}
