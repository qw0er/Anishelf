import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Authorize first-run setup before Jackett can create its native configuration. */
export async function initialize(configDir) {
	await mkdir(configDir, { recursive: true });
	const marker = join(configDir, ".anishelf-bootstrap.json");
	const pending = `${marker}.pending`;
	const entries = await readdir(configDir);
	if (entries.includes(".anishelf-bootstrap.json")) {
		const value = JSON.parse(await readFile(marker, "utf8"));
		if (value.version !== 1 || value.initialize !== true)
			throw new Error("Invalid Jackett initialization marker.");
		return "authorized";
	}
	if (entries.some((name) => name !== ".anishelf-bootstrap.json.pending"))
		return "existing";
	await writeFile(pending, JSON.stringify({ version: 1, initialize: true }), {
		mode: 0o644,
		flush: true,
	});
	await rename(pending, marker);
	return "initialized";
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const result = await initialize(process.argv[2] ?? "/config");
		console.info(JSON.stringify({ event: "jackett.bootstrap", result }));
	} catch {
		console.error(
			JSON.stringify({
				event: "jackett.bootstrap_failed",
				message:
					"Could not authorize bundled Jackett setup; check the config volume.",
			}),
		);
		process.exitCode = 1;
	}
}
