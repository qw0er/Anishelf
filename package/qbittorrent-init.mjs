import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import {
	chmod,
	chown,
	mkdir,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}

/** Runs before qBittorrent. Existing configurations are never rewritten. */
export async function initialize(configDir, credentialsDir, owner = 1000) {
	const config = join(configDir, "qBittorrent", "qBittorrent.conf");
	const credentials = join(credentialsDir, "connection.json");
	const pending = join(credentialsDir, "connection.pending.json");
	if (await exists(credentials)) {
		if (!(await exists(config)))
			throw new Error(
				"Bundled configuration is missing; restore the configuration volume before starting.",
			);
		return "existing";
	}
	if ((await exists(config)) && !(await exists(pending))) return "manual";
	await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
	await chmod(credentialsDir, 0o700);
	await chown(credentialsDir, owner, owner);
	let saved;
	if (await exists(pending))
		saved = JSON.parse(await readFile(pending, "utf8"));
	else {
		saved = {
			version: 1,
			bundled: true,
			generation: randomUUID(),
			connection: {
				url: "http://qbittorrent:8080/",
				username: "admin",
				password: randomBytes(32).toString("base64url"),
			},
		};
		await writeFile(pending, JSON.stringify(saved), {
			mode: 0o600,
			flag: "wx",
			flush: true,
		});
		await chown(pending, owner, owner);
	}
	if (!(await exists(config))) {
		const salt = randomBytes(16);
		const hash = pbkdf2Sync(
			saved.connection.password,
			salt,
			100000,
			64,
			"sha512",
		);
		// qBittorrent's native PBKDF2 serialization: base64(salt):base64(hash).
		const contents = `[LegalNotice]\nAccepted=true\n\n[BitTorrent]\nSession\\Port=6881\nSession\\DefaultSavePath=/data/media\nSession\\TempPath=/data/incomplete\nSession\\TempPathEnabled=true\n\n[Preferences]\nConnection\\UPnP=false\nWebUI\\Username=admin\nWebUI\\Password_PBKDF2="${salt.toString("base64")}:${hash.toString("base64")}"\nWebUI\\HostHeaderValidation=false\nWebUI\\ServerDomains=*\nWebUI\\Address=*\nWebUI\\Port=8080\nWebUI\\LocalHostAuth=true\nWebUI\\AuthSubnetWhitelistEnabled=false\n`;
		await mkdir(join(configDir, "qBittorrent"), { recursive: true });
		await writeFile(`${config}.pending`, contents, {
			mode: 0o600,
			flush: true,
		});
		await chown(`${config}.pending`, owner, owner);
		await rename(`${config}.pending`, config);
	}
	await chmod(pending, 0o600);
	await chown(pending, owner, owner);
	await rename(pending, credentials);
	return "initialized";
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const result = await initialize(
			process.argv[2] ?? "/config",
			process.argv[3] ?? "/connection",
		);
		console.info(JSON.stringify({ event: "qbittorrent.bootstrap", result }));
	} catch {
		console.error(
			JSON.stringify({
				event: "qbittorrent.bootstrap_failed",
				message:
					"Could not initialize bundled qBittorrent; check configuration and connection volumes.",
			}),
		);
		process.exitCode = 1;
	}
}
