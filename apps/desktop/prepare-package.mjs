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
const { dependencies: desktopDependencies } = JSON.parse(
	await readFile(join(desktopDir, "package.json"), "utf8"),
);
const desktopMainDependencies = {
	"better-sqlite3": desktopDependencies["better-sqlite3"],
	"drizzle-orm": desktopDependencies["drizzle-orm"],
	platformdirs: desktopDependencies.platformdirs,
};
const backendDir = join(rootDir, "apps/server");
const { dependencies: backendDependencies } = JSON.parse(
	await readFile(join(backendDir, "package.json"), "utf8"),
);
const { dependencies: identificationDependencies } = JSON.parse(
	await readFile(
		join(rootDir, "packages/anime-identification/package.json"),
		"utf8",
	),
);
// Bundle workspace sources and ship their external dependencies, including the parser's WASM.
const backendRuntimeDependencies = {
	...backendDependencies,
	...identificationDependencies,
};
delete backendRuntimeDependencies["@anishelf/contracts"];
delete backendRuntimeDependencies["@anishelf/anime-identification"];

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
	external: ["electron", ...Object.keys(desktopMainDependencies)],
});
// Preserve the relative locations used for SQLite migrations and build metadata.
await build({
	entryPoints: [join(backendDir, "src/desktop.ts")],
	outfile: join(stagingDir, "dist/backend/app/bootstrap/desktop.js"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	external: Object.keys(backendRuntimeDependencies),
});
await cp(join(backendDir, "migrations"), join(stagingDir, "dist/migrations"), {
	recursive: true,
});
await cp(
	join(desktopDir, "build-info.json"),
	join(stagingDir, "dist/backend/build-info.json"),
);
await cp(
	join(desktopDir, "backend-process.mjs"),
	join(stagingDir, "backend-process.mjs"),
);
await cp(join(desktopDir, "assets"), join(stagingDir, "assets"), {
	recursive: true,
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
// The icon masters are rendered from apps/web/public/favicon.svg. Keep the png
// for the Linux window/tray icon and the pre-built icns/ico so electron-builder
// never needs its on-demand icon tool download during packaging.
for (const extension of ["png", "icns", "ico"]) {
	await cp(
		join(desktopDir, `assets/app-icon.${extension}`),
		join(stagingDir, `dist/icon.${extension}`),
	);
}
await cp(
	join(desktopDir, "assets/linux-icon.png"),
	join(stagingDir, "dist/linux-icon.png"),
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
			dependencies: {
				...backendRuntimeDependencies,
				...desktopMainDependencies,
			},
			build: {
				appId: "app.anishelf.desktop",
				artifactName: `anishelf-desktop-\${version}-\${arch}.\${ext}`,
				electronVersion,
				// better-sqlite3 ships Node-API prebuilds for the release targets.
				npmRebuild: false,
				directories: { output: join(desktopDir, "release") },
				files: [
					"dist/**/*",
					"!dist/icon.icns",
					"!dist/icon.ico",
					"!dist/linux-icon.png",
					"backend-process.mjs",
					"assets/**/*",
					"!assets/app-icon.*",
					"!assets/linux-icon.png",
				],
				asarUnpack: ["**/*.node"],
				linux: {
					target: ["AppImage", "deb", "rpm"],
					category: "AudioVideo",
					icon: "dist/linux-icon.png",
					syncDesktopName: true,
				},
				win: { target: ["nsis"], icon: "dist/icon.ico" },
				mac: { target: ["dmg"], icon: "dist/icon.icns" },
			},
		},
		null,
		2,
	)}\n`,
);
console.info("desktop.package.prepared", {
	version: rootPackage.version,
	electronVersion,
	icons: ["png", "icns", "ico"],
});
