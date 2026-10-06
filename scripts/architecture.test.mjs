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
			"backend/src/modules/a/domain/model.ts":
				"export interface Value { id: string }",
			"backend/src/modules/a/policy.ts": "export const policy = 1;",
			"backend/src/modules/a/public.ts":
				"export type { Value } from './domain/model.js';",
			"backend/src/modules/a/application/service.ts": "export const value = 1;",
			"backend/src/modules/b/application/service.ts":
				"import type { Value } from '../../a/public.js'; import { policy } from '../../a/policy.js'; export const value: Value = { id: String(policy) };",
			"backend/src/bootstrap/main.ts":
				"import { value } from '../modules/a/application/service.js'; export { value };",
		}),
		[],
	);
});

for (const [name, files] of [
	[
		"domain-and-ports-do-not-import-http-dtos",
		{
			"backend/src/modules/a/ports.ts":
				"import type { Dto } from '../../contracts/http.js'; export interface Port { read(): Dto }",
			"backend/src/modules/a/domain/model.ts":
				"import type { Dto } from '../../../contracts/http.js'; export type Model = Dto;",
			"backend/src/contracts/http.ts": "export interface Dto { id: string }",
		},
	],
	[
		"domain-does-not-load-platform-adapters",
		{
			"backend/src/modules/a/domain/model.ts":
				"export { value } from '../../../platform/media/tools.js';",
			"backend/src/platform/media/tools.ts": "export const value = 1;",
		},
	],
	[
		"platform-does-not-import-business",
		{
			"backend/src/platform/adapter.ts":
				"import type { Value } from '../modules/a/public.js'; export type { Value };",
			"backend/src/modules/a/public.ts":
				"export interface Value { id: string }",
		},
	],
	[
		"domain-does-not-import-implementation",
		{
			"backend/src/modules/a/domain/model.ts":
				"import type { Value } from '../application/service.js'; export type { Value };",
			"backend/src/modules/a/application/service.ts":
				"export interface Value { id: string }",
		},
	],
	[
		"public-and-policy-do-not-load-implementation",
		{
			"backend/src/modules/a/public.ts":
				"export { value } from './application/service.js';",
			"backend/src/modules/a/application/service.ts": "export const value = 1;",
		},
	],
	[
		"backend-module-entry-points",
		{
			"backend/src/modules/a/application/service.ts":
				"import type { Value } from '../../b/domain/model.js'; export type { Value };",
			"backend/src/modules/b/domain/model.ts":
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
				"backend/src/modules/a/policy.ts":
					"export { value } from './application/service.js';",
				"backend/src/modules/a/application/service.ts":
					"export const value = 1;",
			})
		).includes("public-and-policy-do-not-load-implementation"),
	);
});
