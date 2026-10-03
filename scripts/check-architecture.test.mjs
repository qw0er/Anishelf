import assert from "node:assert/strict";
import { test } from "node:test";
import {
	boundaryViolation,
	findCycles,
	importSpecifiers,
} from "./check-architecture.mjs";

test("resolves the intended module and HTTP boundaries", () => {
	const app = "backend/src/modules/playback/application/playback.ts";
	assert.ok(
		boundaryViolation(
			app,
			"backend/src/modules/library/infrastructure/index.ts",
		),
	);
	assert.equal(
		boundaryViolation(app, "backend/src/modules/media-source/public.ts"),
		null,
	);
	const http = "backend/src/modules/library/http/library.ts";
	assert.ok(
		boundaryViolation(
			http,
			"backend/src/modules/library/infrastructure/index.ts",
		),
	);
	assert.ok(boundaryViolation(http, "backend/src/modules/playback/public.ts"));
	assert.equal(
		boundaryViolation(
			http,
			"backend/src/modules/library/application/library.ts",
		),
		null,
	);
	assert.ok(
		boundaryViolation(
			"backend/src/modules/library/domain/model.ts",
			"backend/src/modules/library/infrastructure/index.ts",
		),
	);
	assert.equal(
		boundaryViolation(
			"backend/src/bootstrap/library.ts",
			"backend/src/modules/library/infrastructure/index.ts",
		),
		null,
	);
});
test("browser contracts and feature boundaries cannot expose backend internals", () => {
	assert.ok(
		boundaryViolation(
			"web/src/api/client.ts",
			"backend/src/modules/library/public.ts",
		),
	);
	assert.equal(
		boundaryViolation(
			"web/src/api/contracts.ts",
			"backend/src/contracts/http.ts",
		),
		null,
	);
	assert.ok(
		boundaryViolation(
			"backend/src/contracts/http.ts",
			"backend/src/modules/library/public.ts",
		),
	);
	assert.ok(
		boundaryViolation(
			"web/src/features/library/view.tsx",
			"web/src/features/playback/components/player.tsx",
		),
	);
	assert.equal(
		boundaryViolation(
			"web/src/features/library/view.tsx",
			"web/src/features/playback/public.ts",
		),
		null,
	);
});
test("type-only exports, dynamic imports and import types are inspected", () => {
	assert.deepEqual(
		importSpecifiers(
			'import type { A } from "./a.js"; export type { B } from "./b.js"; const c = import("./c.js"); type D = import("./d.js").D;',
		),
		["./a.js", "./b.js", "./c.js", "./d.js"],
	);
});
test("detects indirect cycles and accepts shared dependencies", () => {
	assert.deepEqual(
		findCycles([
			["playback", "sources"],
			["subtitles", "sources"],
		]),
		[],
	);
	assert.deepEqual(
		findCycles([
			["library", "sources"],
			["sources", "configuration"],
			["configuration", "library"],
		]),
		[["library", "sources", "configuration", "library"]],
	);
});

test("HTTP cannot bypass applications through infrastructure packages", () => {
	const http = "backend/src/modules/library/http/media.ts";
	assert.ok(boundaryViolation(http, "backend/src/platform/media/tools.ts"));
	assert.ok(boundaryViolation(http, "node:fs/promises"));
	assert.ok(
		boundaryViolation(
			"web/src/App.tsx",
			"backend/dist/index.d.ts",
			"@anishelf/backend",
		),
	);
	assert.ok(boundaryViolation("backend/src/contracts/http.ts", "node:fs"));
});
