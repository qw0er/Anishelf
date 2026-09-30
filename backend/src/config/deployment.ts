import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { userDataDir } from "platformdirs";
import type {
	DeploymentConfig,
	LoggingConfig,
	LogLevel,
} from "../contracts/config.js";
import { DomainError } from "../errors.js";

const levels: readonly string[] = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"silent",
];

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

function defaultDataDir(): string {
	return userDataDir("anishelf", false);
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
	const host = env.ANISHELF_HOST ?? "127.0.0.1";
	if (!((isIP(host) === 4 && host.startsWith("127.")) || host === "::1")) {
		invalid("ANISHELF_HOST must be a loopback IP address (127.x.x.x or ::1).");
	}
	const rawPort = env.ANISHELF_PORT ?? "3000";
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
	const level = env.ANISHELF_LOG_LEVEL ?? "info";
	if (!levels.includes(level)) {
		invalid(`ANISHELF_LOG_LEVEL must be one of: ${levels.join(", ")}.`);
	}
	const destination = env.ANISHELF_LOG_DESTINATION ?? "stdout";
	let logging: LoggingConfig;
	if (destination === "stdout") {
		if (env.ANISHELF_LOG_PATH !== undefined)
			invalid("ANISHELF_LOG_PATH requires ANISHELF_LOG_DESTINATION=file.");
		logging = { level: level as LogLevel, destination };
	} else if (destination === "file") {
		if (env.ANISHELF_LOG_PATH === undefined)
			invalid("ANISHELF_LOG_PATH is required for file logging.");
		logging = {
			level: level as LogLevel,
			destination,
			path: absolutePath(env.ANISHELF_LOG_PATH, "ANISHELF_LOG_PATH"),
		};
	} else {
		invalid("ANISHELF_LOG_DESTINATION must be 'stdout' or 'file'.");
	}
	return { host, port, dataDir, logging };
}

/** Prepare the writable data directory after validating all startup options. */
export async function loadDeploymentConfig(
	env: Environment = process.env,
): Promise<DeploymentConfig> {
	const config = parseDeploymentConfig(env);
	try {
		await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
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
