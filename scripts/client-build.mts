import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

export function loadClientBuild(workspaceUrl: string) {
	const manifest = new URL("./build-info.json", workspaceUrl);
	// Tooling can load the Vite config before npm generates the manifest.
	const buildInfo = existsSync(manifest)
		? JSON.parse(readFileSync(manifest, "utf8"))
		: {
				version: JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
					.version,
				commit: null,
				channel: "development",
				builtAt: null,
			};

	return {
		buildInfo,
		changelog: readFileSync(new URL("CHANGELOG.md", root), "utf8"),
	};
}
