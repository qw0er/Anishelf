import {
	chmod,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	loadDeploymentConfig,
	parseDeploymentConfig,
} from "../src/config/deployment.js";

let fixture: string;
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-config-"));
});
afterEach(async () => {
	await rm(fixture, { recursive: true, force: true });
});

function toml(extra = ""): string {
	return `dataDir = ${JSON.stringify(join(fixture, "data"))}\n${extra}`;
}

test("applies deployment defaults without requiring a logging table", () => {
	expect(parseDeploymentConfig(toml())).toEqual({
		host: "127.0.0.1",
		port: 3000,
		dataDir: join(fixture, "data"),
		logging: { level: "info", destination: "stdout" },
	});
});

test("supports IPv6 loopback, port boundaries and file logging settings", () => {
	const config = parseDeploymentConfig(
		toml(
			'host = "::1"\nport = 65535\n[logging]\nlevel = "debug"\ndestination = "file"\npath = "/tmp/anishelf.log"',
		),
	);
	expect(config.host).toBe("::1");
	expect(config.port).toBe(65535);
	expect(config.logging).toEqual({
		level: "debug",
		destination: "file",
		path: "/tmp/anishelf.log",
	});
	expect(parseDeploymentConfig(toml("port = 1")).port).toBe(1);
});

test.each(["trace", "debug", "info", "warn", "error", "fatal", "silent"])(
	"accepts log level %s",
	(level) => {
		expect(
			parseDeploymentConfig(toml(`[logging]\nlevel = "${level}"`)).logging
				.level,
		).toBe(level);
	},
);

test.each([
	['host = "0.0.0.0"', "host"],
	['host = "192.168.1.2"', "host"],
	['host = "::"', "host"],
	['host = "127.invalid"', "host"],
	["host = 123", "host"],
	["port = 0", "port"],
	["port = 65536", "port"],
	["port = 3000.5", "port"],
	['port = "3000"', "port"],
	['resourceRoot = "/media"', "Unknown deployment"],
	['logging = "debug"', "logging"],
	['[logging]\nlevel = "verbose"', "logging.level"],
	['[logging]\ndestination = "stderr"', "logging.destination"],
	['[logging]\ndestination = "file"', "logging.path"],
	['[logging]\ndestination = "file"\npath = "relative.log"', "logging.path"],
	['[logging]\npath = "/tmp/log"', "logging.path"],
	['[logging]\nlevle = "info"', "Unknown logging"],
])("rejects invalid setting %s", (extra, message) => {
	expect(() => parseDeploymentConfig(toml(extra))).toThrow(message);
});

test.each([
	"",
	'dataDir = "relative"',
	"dataDir = 123",
	'dataDir = ""',
	'dataDir = "\\u0000"',
])("rejects missing or invalid dataDir: %s", (source) => {
	expect(() => parseDeploymentConfig(source)).toThrow("dataDir");
});

test("malformed TOML does not expose configuration contents", () => {
	expect(() => parseDeploymentConfig('private_value = "secret-value')).toThrow(
		"not valid TOML",
	);
	try {
		parseDeploymentConfig('private_value = "secret-value');
	} catch (error) {
		expect((error as Error).message).not.toContain("secret-value");
	}
});

test.each([undefined, "", "relative.toml"])(
	"rejects invalid ANISHELF_CONFIG: %s",
	async (path) => {
		await expect(
			loadDeploymentConfig({ ANISHELF_CONFIG: path }),
		).rejects.toMatchObject({ code: "CONFIG_INVALID" });
	},
);

test("reports missing deployment file", async () => {
	await expect(
		loadDeploymentConfig({ ANISHELF_CONFIG: join(fixture, "missing.toml") }),
	).rejects.toThrow("Cannot read deployment");
});

test("loads read-only TOML, creates the dynamic directory, and leaves TOML unchanged", async () => {
	const path = join(fixture, "deployment.toml");
	const source = toml();
	await writeFile(path, source);
	await chmod(path, 0o400);
	const config = await loadDeploymentConfig({ ANISHELF_CONFIG: path });
	expect((await stat(config.dataDir)).isDirectory()).toBe(true);
	expect(await readFile(path, "utf8")).toBe(source);
	expect(await loadDeploymentConfig({ ANISHELF_CONFIG: path })).toEqual(config);
});

test("rejects a dataDir occupied by a file", async () => {
	await writeFile(join(fixture, "data"), "occupied");
	const path = join(fixture, "deployment.toml");
	await writeFile(path, toml());
	await expect(loadDeploymentConfig({ ANISHELF_CONFIG: path })).rejects.toThrow(
		"Cannot prepare writable dataDir",
	);
});

test("validation fails before creating the dynamic directory", async () => {
	const path = join(fixture, "deployment.toml");
	await writeFile(path, toml("port = 0"));
	await expect(loadDeploymentConfig({ ANISHELF_CONFIG: path })).rejects.toThrow(
		"port",
	);
	await expect(stat(join(fixture, "data"))).rejects.toMatchObject({
		code: "ENOENT",
	});
});

test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
	"rejects unreadable deployment files and unwritable data directories",
	async () => {
		const path = join(fixture, "deployment.toml");
		await writeFile(path, toml());
		await chmod(path, 0o000);
		try {
			await expect(
				loadDeploymentConfig({ ANISHELF_CONFIG: path }),
			).rejects.toThrow("Cannot read deployment");
		} finally {
			await chmod(path, 0o600);
		}
		const config = await loadDeploymentConfig({ ANISHELF_CONFIG: path });
		await chmod(config.dataDir, 0o500);
		try {
			await expect(
				loadDeploymentConfig({ ANISHELF_CONFIG: path }),
			).rejects.toThrow("Cannot prepare writable dataDir");
		} finally {
			await chmod(config.dataDir, 0o700);
		}
	},
);
