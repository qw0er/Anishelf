import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downloadAsset } from "./libmedia-download.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
	await readFile(new URL("libmedia-assets.json", import.meta.url), "utf8"),
);
const destination = new URL(`web/public/libmedia/${manifest.version}/`, root);
await mkdir(destination, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// npm's lockfile verifies these prebuilt JS chunks; retain their original relative paths.
await cp(
	new URL("node_modules/@libmedia/avplayer-ui/dist/esm/", root),
	new URL("player/", destination),
	{ recursive: true },
);
await cp(
	new URL("node_modules/@libmedia/cheap/dist/cheap-polyfill.js", root),
	new URL("cheap-polyfill.js", destination),
);
await cp(
	new URL("node_modules/@libmedia/avplayer-ui/COPYING.LGPLv3", root),
	new URL("COPYING.LGPLv3", destination),
);
const pending = [...manifest.files];
await Promise.all(
	Array.from({ length: 4 }, async () => {
		for (let item = pending.shift(); item; item = pending.shift()) {
			const target = new URL(item.path, destination);
			try {
				if (hash(await readFile(target)) === item.sha256) continue;
			} catch {}
			const bytes = await downloadAsset(item, manifest.revision);
			await mkdir(new URL(".", target), { recursive: true });
			const temporary = `${fileURLToPath(target)}.tmp`;
			await writeFile(temporary, bytes);
			await rename(temporary, target);
		}
	}),
);
console.log(
	`libmedia ${manifest.version}: player chunks and ${manifest.files.length} verified playback assets ready.`,
);

await writeFile(
	new URL("loader.js", destination),
	'import AVPlayer from "./player/avplayer.js"; globalThis.__anishelfAVPlayer = AVPlayer;\n',
);
