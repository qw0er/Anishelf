import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	link,
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
import { Check } from "typebox/value";
import { preparationConstraints } from "../../../contracts/defaults.js";
import { TranscodeProfileIdSchema } from "../../../contracts/schemas/transcode-profiles.js";
import { storageRules } from "../../../platform/storage.js";
import { DomainError } from "../../../shared/errors.js";
import type { PersistentSettings } from "../domain/model.js";
import { builtinPolicy } from "../policy.js";

export function parsePersistentSettings(
	source: string,
	maximumIntervalMinutes = builtinPolicy.library.maximumScanIntervalMinutes,
): PersistentSettings {
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch {
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json is not valid JSON. Check its syntax.",
		);
	}
	return validatePersistentSettings(value, maximumIntervalMinutes);
}

function validatePersistentSettings(
	value: unknown,
	maximumIntervalMinutes = builtinPolicy.library.maximumScanIntervalMinutes,
): PersistentSettings {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json must contain a JSON object.",
		);
	}
	const settings = value as Record<string, unknown>;
	for (const key of Object.keys(settings)) {
		if (
			key !== "resourceRoot" &&
			key !== "scanIntervalMinutes" &&
			key !== "defaultTranscodeProfileId" &&
			key !== "transcodeCacheBudgetGiB"
		)
			throw new DomainError(
				"CONFIG_INVALID",
				`Unknown persistent setting: ${key}.`,
			);
	}
	const cacheBudget = settings.transcodeCacheBudgetGiB;
	if (
		cacheBudget !== undefined &&
		(typeof cacheBudget !== "number" ||
			!Number.isSafeInteger(cacheBudget) ||
			cacheBudget < 1 ||
			cacheBudget > preparationConstraints.maximumCacheBudgetGiB)
	)
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json transcodeCacheBudgetGiB must be a positive integer within the safe byte budget.",
		);
	const cache =
		cacheBudget === undefined
			? {}
			: { transcodeCacheBudgetGiB: cacheBudget as number };
	const profileId = settings.defaultTranscodeProfileId;
	if (profileId !== undefined && !Check(TranscodeProfileIdSchema, profileId))
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json defaultTranscodeProfileId must be a valid profile ID.",
		);
	const profile =
		profileId === undefined
			? {}
			: { defaultTranscodeProfileId: profileId as string };
	const root = settings.resourceRoot;
	const interval = settings.scanIntervalMinutes;
	if (
		interval !== undefined &&
		(typeof interval !== "number" ||
			!Number.isSafeInteger(interval) ||
			interval < 0 ||
			interval > maximumIntervalMinutes)
	)
		throw new DomainError(
			"CONFIG_INVALID",
			`settings.json scanIntervalMinutes must be an integer from 0 to ${maximumIntervalMinutes}; 0 disables scheduled scans.`,
		);
	const scheduling =
		interval === undefined ? {} : { scanIntervalMinutes: interval as number };
	if (root === null)
		return { resourceRoot: null, ...scheduling, ...profile, ...cache };
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
	return { resourceRoot: root, ...scheduling, ...profile, ...cache };
}

function contains(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return (
		path === "" ||
		(path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
	);
}

/** Existing settings win; missing settings may be initialized before setup mode. */
async function loadPersistentSettings(
	dataDir: string,
	maximumIntervalMinutes: number,
	initialResourceRoot?: string,
): Promise<PersistentSettings> {
	const path = join(dataDir, storageRules.settingsFile);
	let source: string;
	try {
		source = await readFile(path, "utf8");
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
			if (initialResourceRoot === undefined) return { resourceRoot: null };
			const settings = validatePersistentSettings(
				{ resourceRoot: initialResourceRoot },
				maximumIntervalMinutes,
			);
			await checkDirectorySeparation(dataDir, initialResourceRoot);
			try {
				if (!(await stat(initialResourceRoot)).isDirectory())
					throw new Error("Not a directory");
				await access(initialResourceRoot, constants.R_OK | constants.X_OK);
			} catch (cause) {
				throw new DomainError(
					"CONFIG_INVALID",
					"ANISHELF_INITIAL_RESOURCE_ROOT must point to an accessible, readable directory.",
					{ cause },
				);
			}
			if (await writePersistentSettings(dataDir, settings, true))
				return settings;
			// Another initializer created settings first; preserve and load its result.
			return loadPersistentSettings(dataDir, maximumIntervalMinutes);
		}
		throw new DomainError(
			"CONFIG_INVALID",
			`Cannot read ${path}. Check the file permissions.`,
		);
	}
	const settings = parsePersistentSettings(source, maximumIntervalMinutes);
	if (settings.resourceRoot !== null)
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

	private constructor(
		dataDir: string,
		current: PersistentSettings,
		private readonly maximumIntervalMinutes: number,
	) {
		this.dataDir = dataDir;
		this.current = current;
	}

	static async load(
		dataDir: string,
		maximumIntervalMinutes = builtinPolicy.library.maximumScanIntervalMinutes,
		initialResourceRoot?: string,
	): Promise<PersistentConfiguration> {
		return new PersistentConfiguration(
			dataDir,
			await loadPersistentSettings(
				dataDir,
				maximumIntervalMinutes,
				initialResourceRoot,
			),
			maximumIntervalMinutes,
		);
	}

	get settings(): Readonly<PersistentSettings> {
		return Object.freeze({ ...this.current });
	}

	/** Replace the settings. Calls are serialized; rejected writes leave state unchanged. */
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>> {
		let next: PersistentSettings;
		try {
			next = validatePersistentSettings(settings, this.maximumIntervalMinutes);
		} catch (error) {
			return Promise.reject(error);
		}
		const result = this.pendingWrite.then(async () => {
			if (next.resourceRoot !== null)
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
	createOnly = false,
): Promise<boolean> {
	const target = join(dataDir, storageRules.settingsFile);
	const temporary = join(dataDir, `.settings-${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
			flag: "wx",
			mode: storageRules.fileMode,
		});
		if (createOnly) {
			// Publish a complete file atomically without replacing existing settings.
			await link(temporary, target);
		} else {
			await rename(temporary, target);
		}
		return true;
	} catch (cause) {
		if (createOnly && (cause as NodeJS.ErrnoException).code === "EEXIST")
			return false;
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
