import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userDataDir, userLogDir } from "platformdirs";
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

test.each([
	["https://Anime.Example.com/", "https://anime.example.com"],
	["https://anime.example.com:443", "https://anime.example.com"],
	["http://anime.example.com:8080", "http://anime.example.com:8080"],
])("normalizes public origin %s", (value, expected) => {
	expect(
		parseDeploymentConfig({ ANISHELF_PUBLIC_ORIGIN: value }).publicOrigin,
	).toBe(expected);
});

test.each([
	"",
	"anime.example.com",
	"ftp://anime.example.com",
	"https://user:pass@anime.example.com",
	"https://anime.example.com/path",
	"https://anime.example.com/../",
	"https://anime.example.com?x=1",
	"https://anime.example.com#fragment",
	" https://anime.example.com",
	"https://anime.example.com:99999",
])("rejects invalid public origin %s", (value) => {
	expect(() =>
		parseDeploymentConfig({ ANISHELF_PUBLIC_ORIGIN: value }),
	).toThrow("ANISHELF_PUBLIC_ORIGIN");
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
		rotation: { maxSizeBytes: 10485760, maxFiles: 7, interval: "1d" },
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
	["ANISHELF_FRONTEND_DIR", "relative"],
	["ANISHELF_FRONTEND_DIR", ""],
	["ANISHELF_FRONTEND_DIR", "/tmp/\0"],
	["ANISHELF_DATA_DIR", "relative"],
	["ANISHELF_DATA_DIR", ""],
	["ANISHELF_DATA_DIR", "/tmp/\0"],
	["ANISHELF_INITIAL_RESOURCE_ROOT", "relative"],
	["ANISHELF_INITIAL_RESOURCE_ROOT", ""],
	["ANISHELF_INITIAL_RESOURCE_ROOT", "/tmp/\0"],
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

test.each(["", "relative.log", "/tmp/\0"])(
	"rejects invalid file log path %s",
	(ANISHELF_LOG_PATH) => {
		expect(() =>
			parseDeploymentConfig({
				ANISHELF_LOG_DESTINATION: "file",
				ANISHELF_LOG_PATH,
			}),
		).toThrow("ANISHELF_LOG_PATH");
	},
);

test.each(["file", "both"])(
	"uses the platform log directory for %s when no path is set",
	(destination) => {
		expect(
			parseDeploymentConfig({ ANISHELF_LOG_DESTINATION: destination }).logging,
		).toMatchObject({
			destination,
			path: join(userLogDir("anishelf", false), "anishelf.log"),
		});
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

test("frontend hosting is opt-in through an absolute directory", () => {
	expect(parseDeploymentConfig({}).frontendDir).toBeUndefined();
	const frontendDir = join(fixture, "web");
	expect(
		parseDeploymentConfig({ ANISHELF_FRONTEND_DIR: frontendDir }).frontendDir,
	).toBe(frontendDir);
});

test("parses an optional initial resource root without filesystem effects", () => {
	const root = join(fixture, "not-created");
	expect(parseDeploymentConfig({}).initialResourceRoot).toBeUndefined();
	expect(
		parseDeploymentConfig({ ANISHELF_INITIAL_RESOURCE_ROOT: root })
			.initialResourceRoot,
	).toBe(root);
});

test("supports both output and explicit rotation limits", () => {
	expect(
		parseDeploymentConfig({
			ANISHELF_LOG_DESTINATION: "both",
			ANISHELF_LOG_PATH: "/tmp/anishelf.log",
			ANISHELF_LOG_MAX_SIZE_BYTES: "1024",
			ANISHELF_LOG_MAX_FILES: "3",
			ANISHELF_LOG_ROTATE_INTERVAL: "1h",
		}).logging,
	).toEqual({
		level: "info",
		destination: "both",
		path: "/tmp/anishelf.log",
		rotation: { maxSizeBytes: 1024, maxFiles: 3, interval: "1h" },
	});
});
test.each([
	["ANISHELF_LOG_MAX_SIZE_BYTES", "0"],
	["ANISHELF_LOG_MAX_SIZE_BYTES", "9007199254740992"],
	["ANISHELF_LOG_MAX_FILES", "-1"],
	["ANISHELF_LOG_MAX_FILES", "1.5"],
	["ANISHELF_LOG_ROTATE_INTERVAL", "weekly"],
])("rejects invalid rotation option %s", (name, value) => {
	expect(() =>
		parseDeploymentConfig({
			ANISHELF_LOG_DESTINATION: "both",
			ANISHELF_LOG_PATH: "/tmp/log",
			[name]: value,
		}),
	).toThrow(name);
});
test.each([
	"ANISHELF_LOG_MAX_SIZE_BYTES",
	"ANISHELF_LOG_MAX_FILES",
	"ANISHELF_LOG_ROTATE_INTERVAL",
])("rejects file-only option %s with stdout", (name) => {
	expect(() => parseDeploymentConfig({ [name]: "1" })).toThrow(name);
});
