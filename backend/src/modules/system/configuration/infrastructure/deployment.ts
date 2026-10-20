import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, join } from "node:path";
import { userDataDir, userLogDir } from "platformdirs";
import {
	deploymentDefaults,
	logLevels,
} from "../../../../contracts/defaults.js";
import type {
	LoggingConfig,
	LogLevel,
} from "../../../../platform/logging/config.js";
import { storageRules } from "../../../../platform/storage.js";
import { DomainError } from "../../../../shared/errors.js";
import type { DeploymentConfig } from "../domain/model.js";
import { normalizeQbittorrentWebUiUrl } from "../domain/webui-url.js";

type Environment = Readonly<Record<string, string | undefined>>;

function invalid(message: string, cause?: unknown): never {
	throw new DomainError("CONFIG_INVALID", message, { cause });
}

function absolutePath(value: string, name: string): string {
	if (value.trim() === "" || value.includes("\0") || !isAbsolute(value)) {
		invalid(`${name} must be an absolute filesystem path.`);
	}
	return value;
}

function initialRoots(env: Environment): string[] | undefined {
	if (env.ANISHELF_INITIAL_RESOURCE_ROOTS === undefined) return undefined;
	if (env.ANISHELF_INITIAL_RESOURCE_ROOT !== undefined)
		invalid(
			"Set only one resource initializer: ANISHELF_INITIAL_RESOURCE_ROOTS or ANISHELF_INITIAL_RESOURCE_ROOT.",
		);
	let value: unknown;
	try {
		value = JSON.parse(env.ANISHELF_INITIAL_RESOURCE_ROOTS);
	} catch {
		invalid(
			"ANISHELF_INITIAL_RESOURCE_ROOTS must be a JSON array of absolute paths.",
		);
	}
	if (
		!Array.isArray(value) ||
		value.length > 64 ||
		value.some((path) => typeof path !== "string")
	)
		invalid(
			"ANISHELF_INITIAL_RESOURCE_ROOTS must be a JSON array of at most 64 absolute paths.",
		);
	return (value as string[]).map((path) =>
		absolutePath(path, "ANISHELF_INITIAL_RESOURCE_ROOTS"),
	);
}

function initialQbittorrentWebUiUrl(env: Environment): string | undefined {
	const value = env.ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL;
	if (value === undefined || !value.trim()) return undefined;
	try {
		const url = normalizeQbittorrentWebUiUrl(value);
		if (url) return url;
	} catch {
		// Report the initializer name without including the supplied URL.
	}
	invalid(
		"ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL must be an absolute HTTP(S) URL without credentials.",
	);
}

function qbittorrentApiUrl(env: Environment): string | undefined {
	const value = env.ANISHELF_QBITTORRENT_API_URL;
	if (value === undefined || !value.trim()) return undefined;
	try {
		const normalized = normalizeQbittorrentWebUiUrl(value);
		if (normalized) {
			const url = new URL(normalized);
			if (!url.search && !url.hash) {
				url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
				return url.href;
			}
		}
	} catch {
		// Keep credential-bearing input out of diagnostics.
	}
	invalid(
		"ANISHELF_QBITTORRENT_API_URL must be an absolute HTTP(S) URL without credentials, query or fragment.",
	);
}

function defaultDataDir(): string {
	return userDataDir("anishelf", false);
}

function positiveInteger(
	value: string | undefined,
	fallback: number,
	name: string,
): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
		invalid(`${name} must be a positive safe integer.`);
	}
	return parsed;
}

function parseHttpOrigin(value: string, name: string): string {
	try {
		const url = new URL(value);
		if (
			!/^https?:\/\/[^/?#\s\\]+\/?$/.test(value) ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		) {
			throw new Error("Expected an HTTP(S) origin");
		}
		return url.origin;
	} catch (cause) {
		invalid(
			`${name} must be an HTTP(S) origin without credentials, path, query or fragment.`,
			cause,
		);
	}
}

/** Resolve and validate startup environment variables without filesystem effects. */
export function parseDeploymentConfig(
	env: Environment = process.env,
): DeploymentConfig {
	if (env.ANISHELF_CONFIG !== undefined) {
		invalid(
			"ANISHELF_CONFIG is no longer supported. Set ANISHELF_DATA_DIR to your existing data directory and migrate other TOML settings to environment variables.",
		);
	}
	const host = env.ANISHELF_HOST ?? deploymentDefaults.host;
	if (!isIP(host)) {
		invalid("ANISHELF_HOST must be an IPv4 or IPv6 address.");
	}
	const rawPort = env.ANISHELF_PORT ?? String(deploymentDefaults.port);
	const port = Number(rawPort);
	if (
		!/^\d+$/.test(rawPort) ||
		!Number.isInteger(port) ||
		port < 1 ||
		port > 65535
	) {
		invalid("ANISHELF_PORT must be an integer between 1 and 65535.");
	}
	const dataDir =
		env.ANISHELF_DATA_DIR === undefined
			? defaultDataDir()
			: absolutePath(env.ANISHELF_DATA_DIR, "ANISHELF_DATA_DIR");
	const level = env.ANISHELF_LOG_LEVEL ?? deploymentDefaults.logLevel;
	if (!(logLevels as readonly string[]).includes(level)) {
		invalid(`ANISHELF_LOG_LEVEL must be one of: ${logLevels.join(", ")}.`);
	}
	const destination =
		env.ANISHELF_LOG_DESTINATION ?? deploymentDefaults.logDestination;
	let logging: LoggingConfig;
	if (destination === "stdout") {
		if (env.ANISHELF_LOG_PATH !== undefined)
			invalid(
				"ANISHELF_LOG_PATH requires ANISHELF_LOG_DESTINATION=file or both.",
			);
		for (const name of [
			"ANISHELF_LOG_MAX_SIZE_BYTES",
			"ANISHELF_LOG_MAX_FILES",
			"ANISHELF_LOG_ROTATE_INTERVAL",
		]) {
			if (env[name] !== undefined) invalid(`${name} requires file logging.`);
		}
		logging = { level: level as LogLevel, destination };
	} else if (destination === "file" || destination === "both") {
		const interval =
			env.ANISHELF_LOG_ROTATE_INTERVAL ?? deploymentDefaults.logRotateInterval;
		if (interval !== "1h" && interval !== "1d")
			invalid("ANISHELF_LOG_ROTATE_INTERVAL must be '1h' or '1d'.");
		logging = {
			level: level as LogLevel,
			destination,
			path:
				env.ANISHELF_LOG_PATH === undefined
					? join(userLogDir("anishelf", false), "anishelf.log")
					: absolutePath(env.ANISHELF_LOG_PATH, "ANISHELF_LOG_PATH"),
			rotation: {
				maxSizeBytes: positiveInteger(
					env.ANISHELF_LOG_MAX_SIZE_BYTES,
					deploymentDefaults.logMaxSizeBytes,
					"ANISHELF_LOG_MAX_SIZE_BYTES",
				),
				maxFiles: positiveInteger(
					env.ANISHELF_LOG_MAX_FILES,
					deploymentDefaults.logMaxFiles,
					"ANISHELF_LOG_MAX_FILES",
				),
				interval,
			},
		};
	} else {
		invalid("ANISHELF_LOG_DESTINATION must be 'stdout', 'file', or 'both'.");
	}
	const resourceInitializers = initialRoots(env);
	const webUiInitializer = initialQbittorrentWebUiUrl(env);
	const apiUrl = qbittorrentApiUrl(env);
	const mediaTools = {
		ffmpegPath:
			env.ANISHELF_FFMPEG_PATH === undefined
				? deploymentDefaults.ffmpeg
				: absolutePath(env.ANISHELF_FFMPEG_PATH, "ANISHELF_FFMPEG_PATH"),
		ffprobePath:
			env.ANISHELF_FFPROBE_PATH === undefined
				? deploymentDefaults.ffprobe
				: absolutePath(env.ANISHELF_FFPROBE_PATH, "ANISHELF_FFPROBE_PATH"),
	};
	return {
		host,
		port,
		...(env.ANISHELF_PUBLIC_ORIGIN === undefined
			? {}
			: {
					publicOrigin: parseHttpOrigin(
						env.ANISHELF_PUBLIC_ORIGIN,
						"ANISHELF_PUBLIC_ORIGIN",
					),
				}),
		dataDir,
		...(env.ANISHELF_INITIAL_RESOURCE_ROOT === undefined
			? {}
			: {
					initialResourceRoot: absolutePath(
						env.ANISHELF_INITIAL_RESOURCE_ROOT,
						"ANISHELF_INITIAL_RESOURCE_ROOT",
					),
				}),
		...(resourceInitializers === undefined
			? {}
			: { initialResourceRoots: resourceInitializers }),
		...(webUiInitializer === undefined
			? {}
			: { initialQbittorrentWebUiUrl: webUiInitializer }),
		...(apiUrl === undefined ? {} : { qbittorrentApiUrl: apiUrl }),
		logging,
		mediaTools,
		...(env.ANISHELF_FRONTEND_DIR === undefined
			? {}
			: {
					frontendDir: absolutePath(
						env.ANISHELF_FRONTEND_DIR,
						"ANISHELF_FRONTEND_DIR",
					),
				}),
	};
}

/** Prepare the writable data directory after validating all startup options. */
export async function loadDeploymentConfig(
	env: Environment = process.env,
): Promise<DeploymentConfig> {
	const config = parseDeploymentConfig(env);
	try {
		await mkdir(config.dataDir, {
			recursive: true,
			mode: storageRules.directoryMode,
		});
		if (!(await stat(config.dataDir)).isDirectory())
			throw new Error("Not a directory");
		await access(config.dataDir, constants.W_OK);
	} catch (cause) {
		invalid(
			`Cannot prepare writable dataDir at ${config.dataDir}. Check the directory and permissions.`,
			cause,
		);
	}
	return config;
}
