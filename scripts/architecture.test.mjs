import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const checker = fileURLToPath(
	new URL("./check-architecture.mjs", import.meta.url),
);

async function scan(files) {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-architecture-"));
	try {
		const sources = {
			"backend/src/shared/empty.ts": "export {};",
			"web/src/empty.ts": "export {};",
			...files,
		};
		for (const [name, source] of Object.entries(sources)) {
			await mkdir(dirname(join(directory, name)), { recursive: true });
			await writeFile(join(directory, name), source);
		}
		let stdout;
		try {
			({ stdout } = await execute(process.execPath, [checker, "--json"], {
				cwd: directory,
			}));
		} catch (error) {
			if (!error.stdout) throw error;
			stdout = error.stdout;
		}
		const summary = JSON.parse(stdout);
		return summary.violations.map((violation) => violation.rule.name);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("allows policy and public contracts, same-module implementation, and bootstrap composition", async () => {
	assert.deepEqual(
		await scan({
			"backend/src/modules/test/a/domain/model.ts":
				"export interface Value { id: string }",
			"backend/src/modules/test/a/policy.ts": "export const policy = 1;",
			"backend/src/modules/test/a/public.ts":
				"export type { Value } from './domain/model.js';",
			"backend/src/modules/test/a/application/service.ts":
				"export const value = 1;",
			"backend/src/modules/test/b/application/service.ts":
				"import type { Value } from '../../a/public.js'; import { policy } from '../../a/policy.js'; export const value: Value = { id: String(policy) };",
			"backend/src/app/bootstrap/main.ts":
				"import { value } from '../../modules/test/a/application/service.js'; export { value };",
		}),
		[],
	);
});

for (const [name, files] of [
	[
		"domain-and-ports-do-not-import-http-dtos",
		{
			"backend/src/modules/test/a/ports.ts":
				"import type { Dto } from '../../../contracts/http.js'; export interface Port { read(): Dto }",
			"backend/src/modules/test/a/domain/model.ts":
				"import type { Dto } from '../../../../contracts/http.js'; export type Model = Dto;",
			"backend/src/contracts/http.ts": "export interface Dto { id: string }",
		},
	],
	[
		"domain-does-not-load-platform-adapters",
		{
			"backend/src/modules/test/a/domain/model.ts":
				"export { value } from '../../../../platform/media/tools.js';",
			"backend/src/platform/media/tools.ts": "export const value = 1;",
		},
	],
	[
		"platform-does-not-import-business",
		{
			"backend/src/platform/adapter.ts":
				"import type { Value } from '../modules/test/a/public.js'; export type { Value };",
			"backend/src/modules/test/a/public.ts":
				"export interface Value { id: string }",
		},
	],
	[
		"domain-does-not-import-implementation",
		{
			"backend/src/modules/test/a/domain/model.ts":
				"import type { Value } from '../application/service.js'; export type { Value };",
			"backend/src/modules/test/a/application/service.ts":
				"export interface Value { id: string }",
		},
	],
	[
		"public-and-policy-do-not-load-implementation",
		{
			"backend/src/modules/test/a/public.ts":
				"export { value } from './application/service.js';",
			"backend/src/modules/test/a/application/service.ts":
				"export const value = 1;",
		},
	],
	[
		"backend-module-entry-points",
		{
			"backend/src/modules/test/a/application/service.ts":
				"import type { Value } from '../../b/domain/model.js'; export type { Value };",
			"backend/src/modules/test/b/domain/model.ts":
				"export interface Value { id: string }",
		},
	],
	[
		"web-feature-entry-points",
		{
			"web/src/features/a/view.ts": "export { value } from '../b/internal.js';",
			"web/src/features/b/internal.ts": "export const value = 1;",
		},
	],
	[
		"web-only-imports-browser-contracts",
		{
			"web/src/leak.ts":
				"export { value } from '../../backend/src/shared/value.js';",
			"backend/src/shared/value.ts": "export const value = 1;",
		},
	],
	[
		"no-runtime-cycles",
		{
			"backend/src/shared/a.ts":
				"import { b } from './b.js'; export const a = () => b;",
			"backend/src/shared/b.ts":
				"import { a } from './a.js'; export const b = () => a;",
		},
	],
	[
		"no-unresolved-source-imports",
		{
			"backend/src/shared/a.ts": "export { missing } from './missing.js';",
		},
	],
]) {
	test(`rejects ${name}`, async () =>
		assert.ok((await scan(files)).includes(name)));
}

test("type-only cycles do not count as runtime initialization cycles", async () => {
	const violations = await scan({
		"backend/src/shared/a.ts":
			"import type { B } from './b.js'; export interface A { b: B }",
		"backend/src/shared/b.ts":
			"import type { A } from './a.js'; export interface B { a: A }",
	});
	assert.ok(!violations.includes("no-runtime-cycles"));
});

test("policy cannot load its Application through a service entry", async () => {
	assert.ok(
		(
			await scan({
				"backend/src/modules/test/a/policy.ts":
					"export { value } from './application/service.js';",
				"backend/src/modules/test/a/application/service.ts":
					"export const value = 1;",
			})
		).includes("public-and-policy-do-not-load-implementation"),
	);
});

for (const [label, source] of [
	[
		"type import",
		"import type { Value } from '../../b/model.js'; export type { Value };",
	],
	["re-export", "export { value } from '../../b/application.js';"],
	[
		"dynamic import",
		"export const load = () => import('../../b/application.js');",
	],
]) {
	test(`rejects cross-module ${label} to root-level private files`, async () => {
		const violations = await scan({
			"backend/src/modules/test/a/application/service.ts": source,
			"backend/src/modules/test/b/model.ts":
				"export interface Value { id: string }",
			"backend/src/modules/test/b/application.ts": "export const value = 1;",
		});
		assert.ok(violations.includes("backend-module-entry-points"));
	});
}

test("group names do not grant access to another module's implementation", async () => {
	assert.ok(
		(
			await scan({
				"backend/src/modules/media/a/application.ts":
					"export { value } from '../../resources/b/application.js';",
				"backend/src/modules/resources/b/application.ts":
					"export const value = 1;",
			})
		).includes("backend-module-entry-points"),
	);
});

test("database adapters and app can consume explicit persistence entries", async () => {
	assert.deepEqual(
		await scan({
			"backend/src/modules/resources/a/persistence.ts":
				"export { table } from './infrastructure/schema.js';",
			"backend/src/modules/resources/a/infrastructure/schema.ts":
				"export const table = 1;",
			"backend/src/modules/media/b/infrastructure/schema.ts":
				"export { table } from '../../../resources/a/persistence.js';",
			"backend/src/app/schema.ts":
				"export { table } from '../modules/resources/a/persistence.js';",
		}),
		[],
	);
});

for (const location of [
	"application.ts",
	"domain/model.ts",
	"public.ts",
	"http/route.ts",
]) {
	test(`rejects persistence entry from ${location}`, async () => {
		const prefix = location.includes("/") ? "../../" : "../";
		assert.ok(
			(
				await scan({
					[`backend/src/modules/resources/a/${location}`]: `export { table } from '${prefix}b/persistence.js';`,
					"backend/src/modules/resources/b/persistence.ts":
						"export const table = 1;",
				})
			).includes("persistence-is-adapter-only"),
		);
	});
}

for (const [rule, file, source] of [
	[
		"web-app-uses-feature-public-api",
		"web/src/app/route.ts",
		"export { value } from '../features/a/internal.js';",
	],
	[
		"web-shared-does-not-import-features",
		"web/src/shared/helper.ts",
		"export { value } from '../features/a/public.js';",
	],
	[
		"web-features-do-not-import-app",
		"web/src/features/a/view.ts",
		"export { app } from '../../app/main.js';",
	],
	[
		"modules-do-not-import-app",
		"backend/src/modules/test/a/application.ts",
		"export { app } from '../../../app/main.js';",
	],
]) {
	test(`rejects ${rule}`, async () => {
		assert.ok(
			(
				await scan({
					[file]: source,
					"web/src/features/a/internal.ts": "export const value = 1;",
					"web/src/features/a/public.ts":
						"export { value } from './internal.js';",
					"web/src/app/main.ts": "export const app = 1;",
					"backend/src/app/main.ts": "export const app = 1;",
				})
			).includes(rule),
		);
	});
}

test("domain rejects schema-derived types even when imported directly", async () => {
	assert.ok(
		(
			await scan({
				"backend/src/modules/test/a/domain/model.ts":
					"import type { Dto } from '../../../../contracts/schemas/example.js'; export type Model = Dto;",
				"backend/src/contracts/schemas/example.ts":
					"export interface Dto { id: string }",
			})
		).includes("domain-and-ports-do-not-import-http-dtos"),
	);
});

test("HTTP cannot bypass its owning Application through another module's public API", async () => {
	assert.ok(
		(
			await scan({
				"backend/src/modules/test/a/http/route.ts":
					"export { run } from '../../b/public.js';",
				"backend/src/modules/test/b/public.ts": "export const run = () => {};",
			})
		).includes("http-does-not-call-other-modules"),
	);
});

test("HTTP cannot call even its own concrete repository", async () => {
	assert.ok(
		(
			await scan({
				"backend/src/modules/test/a/http/route.ts":
					"export { save } from '../infrastructure/repository.js';",
				"backend/src/modules/test/a/infrastructure/repository.ts":
					"export const save = () => {};",
			})
		).includes("http-does-not-import-infrastructure"),
	);
});

test("filesystem adapters cannot use another module's database entry", async () => {
	assert.ok(
		(
			await scan({
				"backend/src/modules/media/a/infrastructure/assets.ts":
					"export { table } from '../../../resources/b/persistence.js';",
				"backend/src/modules/resources/b/persistence.ts":
					"export const table = 1;",
			})
		).includes("persistence-is-adapter-only"),
	);
});

test("public entries cannot export a root-level Application implementation", async () => {
	assert.ok(
		(
			await scan({
				"backend/src/modules/test/a/public.ts":
					"export { run } from './application.js';",
				"backend/src/modules/test/a/application.ts":
					"export const run = () => {};",
			})
		).includes("public-and-policy-do-not-load-implementation"),
	);
});
