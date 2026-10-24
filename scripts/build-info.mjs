import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const { version } = JSON.parse(
	readFileSync(new URL("package.json", root), "utf8"),
);
const tag = process.env.ANISHELF_BUILD_TAG || "";
if (tag && tag !== `v${version}`) {
	throw new Error(
		`Release tag ${tag} does not match package version ${version}.`,
	);
}
let commit = process.env.ANISHELF_BUILD_COMMIT || null;
if (!commit) {
	try {
		commit = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: fileURLToPath(root),
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		/* Source archives may not contain Git metadata. */
	}
}
const channel = tag
	? version.includes("-")
		? "prerelease"
		: "stable"
	: process.env.ANISHELF_BUILD_CHANNEL || "development";
if (
	!["stable", "prerelease", "testing", "development"].includes(channel) ||
	(!tag && channel === "stable")
) {
	throw new Error(
		"Stable builds require a matching release tag; invalid build channel.",
	);
}
const info = {
	version,
	commit,
	channel,
	builtAt: process.env.ANISHELF_BUILD_TIME || new Date().toISOString(),
};
for (const workspace of ["backend", "web"]) {
	writeFileSync(
		new URL(`${workspace}/build-info.json`, root),
		`${JSON.stringify(info, null, 2)}\n`,
	);
}
