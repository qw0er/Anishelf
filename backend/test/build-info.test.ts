import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

const fixtures: string[] = [];
afterEach(() => {
	for (const path of fixtures.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function build(env: Record<string, string>) {
	const root = mkdtempSync(join(tmpdir(), "anishelf-build-info-"));
	fixtures.push(root);
	for (const name of ["scripts", "backend", "web"]) mkdirSync(join(root, name));
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ version: "1.2.3" }),
	);
	copyFileSync(
		new URL("../../scripts/build-info.mjs", import.meta.url),
		join(root, "scripts/build-info.mjs"),
	);
	const result = spawnSync(
		process.execPath,
		[join(root, "scripts/build-info.mjs")],
		{
			env: {
				...process.env,
				ANISHELF_BUILD_TAG: "",
				ANISHELF_BUILD_CHANNEL: "development",
				ANISHELF_BUILD_COMMIT: "abc123",
				ANISHELF_BUILD_TIME: "2026-10-24T00:00:00Z",
				...env,
			},
			encoding: "utf8",
		},
	);
	return { root, result };
}
test.each([
	["v1.2.3", "stable"],
	["", "testing"],
])("embeds matching %s build identities", (tag, channel) => {
	const { root, result } = build({
		ANISHELF_BUILD_TAG: tag,
		ANISHELF_BUILD_CHANNEL: channel,
	});
	expect(result.status).toBe(0);
	const backend = readFileSync(join(root, "backend/build-info.json"), "utf8");
	expect(readFileSync(join(root, "web/build-info.json"), "utf8")).toBe(backend);
	expect(JSON.parse(backend)).toEqual({
		version: "1.2.3",
		commit: "abc123",
		channel,
		builtAt: "2026-10-24T00:00:00Z",
	});
});
test("blocks mismatched release versions and untagged stable builds", () => {
	expect(build({ ANISHELF_BUILD_TAG: "v1.2.4" }).result.status).not.toBe(0);
	expect(build({ ANISHELF_BUILD_CHANNEL: "stable" }).result.status).not.toBe(0);
});
