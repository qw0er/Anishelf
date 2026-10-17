import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	link,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { Check } from "typebox/value";
import { preparationConstraints } from "../../../../contracts/defaults.js";
import {
	PreparationModeSchema,
	TranscodeProfileIdSchema,
} from "../../../../contracts/schemas/transcode-profiles.js";
import { canonicalPath } from "../../../../platform/canonical-path.js";
import { storageRules } from "../../../../platform/storage.js";
import { DomainError } from "../../../../shared/errors.js";
import type { PersistentSettings } from "../domain/model.js";
import { configurationPolicy } from "../policy.js";

export function parsePersistentSettings(
	source: string,
	maximumIntervalMinutes = configurationPolicy.library
		.maximumScanIntervalMinutes,
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
	maximumIntervalMinutes = configurationPolicy.library
		.maximumScanIntervalMinutes,
): PersistentSettings {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json must contain a JSON object.",
		);
	}
	const settings = value as Record<string, unknown>;
	if (
		Object.hasOwn(settings, "resourceRoots") &&
		Object.hasOwn(settings, "resourceRoot")
	)
		throw new DomainError(
			"CONFIG_INVALID",
			"Use resourceRoots or legacy resourceRoot, not both.",
		);
	for (const key of Object.keys(settings)) {
		if (
			key !== "resourceRoots" &&
			key !== "resourceRoot" &&
			key !== "scanIntervalMinutes" &&
			key !== "defaultTranscodeProfileId" &&
			key !== "preparationMode" &&
			key !== "transcodeCacheBudgetGiB"
		)
			throw new DomainError(
				"CONFIG_INVALID",
				`Unknown persistent setting: ${key}.`,
			);
	}
	const preparationMode = settings.preparationMode;
	if (
		preparationMode !== undefined &&
		!Check(PreparationModeSchema, preparationMode)
	)
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json preparationMode must be compatible or fast.",
		);
	const mode = preparationMode === undefined ? {} : { preparationMode };
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
	const roots =
		settings.resourceRoots ??
		(settings.resourceRoot === null
			? []
			: typeof settings.resourceRoot === "string"
				? [settings.resourceRoot]
				: undefined);
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
	if (
		!Array.isArray(roots) ||
		roots.length > 64 ||
		roots.some(
			(root) =>
				typeof root !== "string" ||
				root.trim() === "" ||
				root.includes("\0") ||
				!isAbsolute(root),
		)
	) {
		throw new DomainError(
			"CONFIG_INVALID",
			"settings.json resourceRoots must contain at most 64 absolute filesystem paths.",
		);
	}
	if (new Set(roots).size !== roots.length)
		throw new DomainError("CONFIG_INVALID", "Resource paths must be distinct.");
	return {
		resourceRoots: [...roots],
		...scheduling,
		...profile,
		...cache,
		...mode,
	};
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
	initialResourceRoot?: string | readonly string[],
): Promise<PersistentSettings> {
	const path = join(dataDir, storageRules.settingsFile);
	let source: string;
	try {
		source = await readFile(path, "utf8");
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
			if (initialResourceRoot === undefined) return { resourceRoots: [] };
			const settings = validatePersistentSettings(
				{
					resourceRoots:
						typeof initialResourceRoot === "string"
							? [initialResourceRoot]
							: [...initialResourceRoot],
				},
				maximumIntervalMinutes,
			);
			await validateResourceDirectories(dataDir, settings.resourceRoots);
			try {
				for (const root of settings.resourceRoots) {
					if (!(await stat(root)).isDirectory())
						throw new Error("Not a directory");
					await access(root, constants.R_OK | constants.X_OK);
				}
			} catch (cause) {
				throw new DomainError(
					"CONFIG_INVALID",
					"Resource initializers must point to accessible, readable directories.",
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
	await validateResourceDirectories(dataDir, settings.resourceRoots);
	return settings;
}

async function checkDirectorySeparation(
	dataDir: string,
	resourceRoots: string,
): Promise<void> {
	const [data, root] = await Promise.all([
		canonicalPath(dataDir),
		canonicalPath(resourceRoots),
	]);
	if (contains(data, root) || contains(root, data)) {
		throw new DomainError(
			"CONFIG_INVALID",
			"dataDir and resourceRoots must be separate directories; neither may contain the other.",
		);
	}
}

async function validateResourceDirectories(
	dataDir: string,
	roots: readonly string[],
): Promise<void> {
	const canonical = await Promise.all(roots.map(canonicalPath));
	for (let index = 0; index < roots.length; index++) {
		await checkDirectorySeparation(dataDir, roots[index] as string);
		for (let other = 0; other < index; other++) {
			if (
				contains(canonical[index] as string, canonical[other] as string) ||
				contains(canonical[other] as string, canonical[index] as string)
			)
				throw new DomainError(
					"CONFIG_INVALID",
					"Resource paths must not duplicate or contain one another.",
				);
		}
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
		maximumIntervalMinutes = configurationPolicy.library
			.maximumScanIntervalMinutes,
		initialResourceRoot?: string | readonly string[],
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
		return Object.freeze({
			...this.current,
			resourceRoots: [...this.current.resourceRoots],
		});
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
			await validateResourceDirectories(this.dataDir, next.resourceRoots);
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
