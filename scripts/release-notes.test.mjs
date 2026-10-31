import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./release-notes.mjs", import.meta.url));

function run(changelog, tag = "v1.3.1") {
	const dir = mkdtempSync(join(tmpdir(), "anishelf-release-notes-"));
	try {
		writeFileSync(join(dir, "CHANGELOG.md"), changelog);
		const result = spawnSync(process.execPath, [script, tag, "notes.md"], {
			cwd: dir,
			encoding: "utf8",
		});
		return {
			...result,
			notes:
				result.status === 0
					? readFileSync(join(dir, "notes.md"), "utf8")
					: null,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("extracts the exact release section", () => {
	const result = run(
		"# Changelog\n\n## 1.3.1 - 2026-11-01\n\n### Fixed\n\n- A fix.\n\n## 1.3.0 - 2026-10-30\n\n- Old.\n",
	);
	assert.equal(result.status, 0);
	assert.equal(result.notes, "### Fixed\n\n- A fix.\n");
});

test("rejects missing, upcoming, duplicate, and empty release sections", () => {
	for (const changelog of [
		"# Changelog\n",
		"## 1.3.1 (upcoming)\n\n- Fix.\n",
		"## 1.3.1 - 2026-11-01\n\n- Fix.\n\n## 1.3.1 - 2026-11-02\n\n- Other.\n",
		"## 1.3.1 - 2026-11-01\n\n### Fixed\n",
	]) {
		assert.notEqual(run(changelog).status, 0);
	}
});

test("supports prerelease tags", () => {
	assert.equal(
		run("## 1.3.1-rc.1 - 2026-11-01\n\n- Preview.\n", "v1.3.1-rc.1").status,
		0,
	);
});
