import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(desktopDir, "../..");
const stagingDir = join(desktopDir, "dist/package");
const rootPackage = JSON.parse(
	await readFile(join(rootDir, "package.json"), "utf8"),
);
const require = createRequire(import.meta.url);
const electronVersion = require("electron/package.json").version;

console.info("desktop.package.preparing", { stagingDir });
await rm(stagingDir, { recursive: true, force: true });
await mkdir(join(stagingDir, "dist/main"), { recursive: true });
await build({
	entryPoints: [join(desktopDir, "src/main/index.ts")],
	outfile: join(stagingDir, "dist/main/index.js"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	external: ["electron", "platformdirs"],
});
await cp(join(desktopDir, "dist/preload"), join(stagingDir, "dist/preload"), {
	recursive: true,
});
await cp(join(desktopDir, "dist/renderer"), join(stagingDir, "dist/renderer"), {
	recursive: true,
});
await cp(
	join(desktopDir, "build-info.json"),
	join(stagingDir, "dist/build-info.json"),
);
await cp(
	join(rootDir, "apps/web/public/icon-512.png"),
	join(stagingDir, "dist/icon.png"),
);
await writeFile(
	join(stagingDir, "package.json"),
	`${JSON.stringify(
		{
			name: "anishelf-desktop",
			productName: "Anishelf",
			desktopName: "app.anishelf.desktop.desktop",
			version: rootPackage.version,
			description: "Anishelf desktop client",
			author: { name: rootPackage.author, email: "m15517892713@gmail.com" },
			homepage: "https://github.com/qw0er/Anishelf",
			license: rootPackage.license,
			type: "module",
			main: "dist/main/index.js",
			dependencies: { platformdirs: "4.3.7" },
			build: {
				appId: "app.anishelf.desktop",
				artifactName: `anishelf-desktop-\${version}-\${arch}.\${ext}`,
				electronVersion,
				directories: { output: join(desktopDir, "release") },
				files: ["dist/**/*"],
				linux: {
					target: ["AppImage", "deb", "rpm"],
					category: "AudioVideo",
					icon: "dist/icon.png",
					syncDesktopName: true,
				},
				win: { target: ["nsis"] },
				mac: { target: ["dmg"] },
			},
		},
		null,
		2,
	)}\n`,
);
console.info("desktop.package.prepared", {
	version: rootPackage.version,
	electronVersion,
});
