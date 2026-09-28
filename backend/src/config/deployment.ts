import { access, mkdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { parse } from "smol-toml";
import type { DeploymentConfig, LoggingConfig, LogLevel } from "../contracts/config.js";
import { DomainError } from "../errors.js";

const levels: readonly string[] = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];

function invalid(message: string, cause?: unknown): never {
  throw new DomainError("CONFIG_INVALID", message, { cause });
}

function table(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Date) {
    invalid(`${name} must be a TOML table.`);
  }
  return value as Record<string, unknown>;
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) invalid(`Unknown ${name} setting: ${key}.`);
  }
}

function absolutePath(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0") || !isAbsolute(value)) {
    invalid(`${name} must be an absolute filesystem path.`);
  }
  return value;
}

/** Parse untrusted TOML into validated settings, without filesystem side effects. */
export function parseDeploymentConfig(source: string): DeploymentConfig {
  let parsed: unknown;
  try {
    parsed = parse(source, { unsafeKeyBehaviour: "throw" });
  } catch (cause) {
    // Parser errors can contain source lines; retain them only as an internal cause.
    invalid("Deployment configuration is not valid TOML. Check its syntax.", cause);
  }
  const config = table(parsed, "Deployment configuration");
  allowedKeys(config, ["host", "port", "dataDir", "logging"], "deployment");

  const host = config.host ?? "127.0.0.1";
  if (typeof host !== "string" || !((isIP(host) === 4 && host.startsWith("127.")) || host === "::1")) {
    invalid("host must be a loopback IP address (127.x.x.x or ::1).");
  }
  const port = config.port ?? 3000;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    invalid("port must be an integer between 1 and 65535.");
  }
  const dataDir = absolutePath(config.dataDir, "dataDir");
  const logging = config.logging === undefined ? {} : table(config.logging, "logging");
  allowedKeys(logging, ["level", "destination", "path"], "logging");
  const level = logging.level ?? "info";
  if (typeof level !== "string" || !levels.includes(level)) {
    invalid(`logging.level must be one of: ${levels.join(", ")}.`);
  }
  const destination = logging.destination ?? "stdout";
  let validatedLogging: LoggingConfig;
  if (destination === "stdout") {
    if (logging.path !== undefined) invalid("logging.path is only supported with destination = 'file'.");
    validatedLogging = { level: level as LogLevel, destination };
  } else if (destination === "file") {
    validatedLogging = { level: level as LogLevel, destination, path: absolutePath(logging.path, "logging.path") };
  } else {
    invalid("logging.destination must be 'stdout' or 'file'.");
  }
  return { host, port, dataDir, logging: validatedLogging };
}

/** Deployment TOML is read-only; only the dynamic data directory is prepared. */
export async function loadDeploymentConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<DeploymentConfig> {
  const configPath = absolutePath(env.ANISHELF_CONFIG, "ANISHELF_CONFIG");
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch (cause) {
    invalid(`Cannot read deployment configuration at ${configPath}. Check that the file exists and is readable.`, cause);
  }
  const config = parseDeploymentConfig(source);
  try {
    await mkdir(config.dataDir, { recursive: true });
    if (!(await stat(config.dataDir)).isDirectory()) throw new Error("Not a directory");
    await access(config.dataDir, constants.W_OK);
  } catch (cause) {
    invalid(`Cannot prepare writable dataDir at ${config.dataDir}. Check the directory and permissions.`, cause);
  }
  return config;
}
