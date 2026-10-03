import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userDataDir } from "platformdirs";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	loadDeploymentConfig,
	parseDeploymentConfig,
} from "../src/modules/configuration/infrastructure/deployment.js";

let fixture: string;
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-config-"));
});
afterEach(async () => {
	await rm(fixture, { recursive: true, force: true });
});

test("starts with defaults without application environment variables", () => {
	expect(parseDeploymentConfig({})).toEqual({
		host: "127.0.0.1",
		port: 3000,
		dataDir: userDataDir("anishelf", false),
		logging: { level: "info", destination: "stdout" },
		mediaTools: { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
	});
});

test("allows an explicit data directory to override the platform default", () => {
	expect(
		parseDeploymentConfig({ ANISHELF_DATA_DIR: join(fixture, "custom") })
			.dataDir,
	).toBe(join(fixture, "custom"));
});

test("supports IPv6 loopback, port boundaries and file logging", () => {
	const config = parseDeploymentConfig({
		ANISHELF_HOST: "::1",
		ANISHELF_PORT: "65535",
		ANISHELF_LOG_LEVEL: "debug",
		ANISHELF_LOG_DESTINATION: "file",
		ANISHELF_LOG_PATH: join(fixture, "anishelf.log"),
	});
	expect(config.host).toBe("::1");
	expect(config.port).toBe(65535);
	expect(config.logging).toEqual({
		level: "debug",
		destination: "file",
		path: join(fixture, "anishelf.log"),
	});
	expect(parseDeploymentConfig({ ANISHELF_PORT: "1" }).port).toBe(1);
});

test.each(["trace", "debug", "info", "warn", "error", "fatal", "silent"])(
	"accepts log level %s",
	(level) => {
		expect(
			parseDeploymentConfig({ ANISHELF_LOG_LEVEL: level }).logging.level,
		).toBe(level);
	},
);

test.each([
	["ANISHELF_HOST", "0.0.0.0"],
	["ANISHELF_HOST", "192.168.1.2"],
	["ANISHELF_HOST", "::"],
	["ANISHELF_HOST", "127.invalid"],
	["ANISHELF_HOST", ""],
	["ANISHELF_PORT", "0"],
	["ANISHELF_PORT", "65536"],
	["ANISHELF_PORT", "3000.5"],
	["ANISHELF_PORT", "3e3"],
	["ANISHELF_PORT", "0xbb8"],
	["ANISHELF_PORT", "3000abc"],
	["ANISHELF_PORT", " 3000 "],
	["ANISHELF_PORT", ""],
	["ANISHELF_DATA_DIR", "relative"],
	["ANISHELF_DATA_DIR", ""],
	["ANISHELF_DATA_DIR", "/tmp/\0"],
	["ANISHELF_LOG_LEVEL", "verbose"],
	["ANISHELF_LOG_LEVEL", ""],
	["ANISHELF_LOG_DESTINATION", "stderr"],
	["ANISHELF_LOG_DESTINATION", ""],
	["ANISHELF_LOG_PATH", "/tmp/log"],
	["ANISHELF_FFMPEG_PATH", ""],
	["ANISHELF_FFMPEG_PATH", "relative/ffmpeg"],
	["ANISHELF_FFPROBE_PATH", "/tmp/\0"],
	["ANISHELF_FFPROBE_PATH", "ffprobe"],
])("rejects invalid %s=%s", (name, value) => {
	expect(() => parseDeploymentConfig({ [name]: value })).toThrow(name);
});

test.each([undefined, "", "relative.log", "/tmp/\0"])(
	"rejects missing or invalid file log path %s",
	(ANISHELF_LOG_PATH) => {
		expect(() =>
			parseDeploymentConfig({
				ANISHELF_LOG_DESTINATION: "file",
				ANISHELF_LOG_PATH,
			}),
		).toThrow("ANISHELF_LOG_PATH");
	},
);

test("reports how to migrate the removed TOML entry point without reading it", async () => {
	await expect(
		loadDeploymentConfig({ ANISHELF_CONFIG: join(fixture, "missing.toml") }),
	).rejects.toThrow("Set ANISHELF_DATA_DIR to your existing data directory");
});

test("creates the configured data directory and retains existing settings", async () => {
	const env = { ANISHELF_DATA_DIR: join(fixture, "data") };
	const config = await loadDeploymentConfig(env);
	expect((await stat(config.dataDir)).isDirectory()).toBe(true);
	await writeFile(
		join(config.dataDir, "settings.json"),
		'{"resourceRoot":null}',
	);
	expect(await loadDeploymentConfig(env)).toEqual(config);
	const { PersistentConfiguration } = await import(
		"../src/modules/configuration/infrastructure/persistent.js"
	);
	expect((await PersistentConfiguration.load(config.dataDir)).settings).toEqual(
		{
			resourceRoot: null,
		},
	);
});

test("rejects a dataDir occupied by a file", async () => {
	const ANISHELF_DATA_DIR = join(fixture, "data");
	await writeFile(ANISHELF_DATA_DIR, "occupied");
	await expect(loadDeploymentConfig({ ANISHELF_DATA_DIR })).rejects.toThrow(
		"Cannot prepare writable dataDir",
	);
});

test("validation fails before creating the dynamic directory", async () => {
	const ANISHELF_DATA_DIR = join(fixture, "data");
	await expect(
		loadDeploymentConfig({ ANISHELF_DATA_DIR, ANISHELF_PORT: "0" }),
	).rejects.toThrow("ANISHELF_PORT");
	await expect(stat(ANISHELF_DATA_DIR)).rejects.toMatchObject({
		code: "ENOENT",
	});
});

test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
	"rejects unwritable data directories",
	async () => {
		const env = { ANISHELF_DATA_DIR: join(fixture, "data") };
		const config = await loadDeploymentConfig(env);
		await chmod(config.dataDir, 0o500);
		try {
			await expect(loadDeploymentConfig(env)).rejects.toThrow(
				"Cannot prepare writable dataDir",
			);
		} finally {
			await chmod(config.dataDir, 0o700);
		}
	},
);
