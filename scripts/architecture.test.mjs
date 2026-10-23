import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkArchitecture } from "./check-architecture.mjs";

test("resource consumers do not interpret directory roots or read the directory table", async () => {
	for (const module of ["anime", "media", "playback"]) {
		const directory = new URL(
			`../backend/src/modules/${module}/`,
			import.meta.url,
		);
		for (const path of await readdir(directory, { recursive: true })) {
			if (!path.endsWith(".ts")) continue;
			const source = await readFile(new URL(path, directory), "utf8");
			assert.doesNotMatch(
				source,
				/\b(?:canonicalRoot|resourceRoot|resourceRootId|resourceRootEpoch|resolveRoot|assertRootEpoch|resourceRoots)\b/,
				`${module}/${path} must use Resources identities and capabilities`,
			);
		}
	}
});

async function scan(files) {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "anishelf-architecture-")),
	);
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
		const { summary } = await checkArchitecture(directory);
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
			"backend/src/modules/test/create.ts":
				"export { value } from './a/application/service.js';",
			"backend/src/app/bootstrap/main.ts":
				"export { value } from '../../modules/test/create.js';",
		}),
		[],
	);
});

for (const [name, files] of [
	[
		"sources-implementation-is-private",
		{
			"backend/src/modules/acquisition/create.ts":
				"import { Client } from './sources/jackett/client.js'; export {Client};",
			"backend/src/modules/acquisition/sources/jackett/client.ts":
				"export class Client {}",
		},
	],
	[
		"sources-domain-does-not-import-adapters",
		{
			"backend/src/modules/acquisition/sources/domain/model.ts":
				"import type { Plan } from '../jackett/model.js'; export type Value = Plan;",
			"backend/src/modules/acquisition/sources/jackett/model.ts":
				"export interface Plan { id:string }",
		},
	],
	[
		"subscriptions-do-not-import-downloads",
		{
			"backend/src/modules/acquisition/subscriptions/application/service.ts":
				"import type { Task } from '../../downloads/public.js'; export type Value = Task;",
			"backend/src/modules/acquisition/downloads/public.ts":
				"export interface Task {id:string}",
		},
	],
	[
		"acquisition-sources-do-not-import-business-consumers",
		{
			"backend/src/modules/acquisition/sources/application/service.ts":
				"import type { Subscription } from '../../subscriptions/public.js'; export type Value = Subscription;",
			"backend/src/modules/acquisition/subscriptions/public.ts":
				"export interface Subscription { workKey: string }",
		},
	],
	[
		"anime-applications-use-ports",
		{
			"backend/src/modules/anime/tracking/application/account.ts":
				"import type { Provider } from '../infrastructure/provider.js'; export type Account = Provider;",
			"backend/src/modules/anime/tracking/infrastructure/provider.ts":
				"export interface Provider { id: string }",
		},
	],
	[
		"anilist-protocol-does-not-import-business",
		{
			"backend/src/modules/anime/anilist/domain/model.ts":
				"import type { Entry } from '../../tracking/public.js'; export type Response = Entry;",
			"backend/src/modules/anime/tracking/public.ts":
				"export interface Entry { id: string }",
		},
	],
	[
		"configuration-application-does-not-project-http",
		{
			"backend/src/modules/system/configuration/application/service.ts":
				"import type { Dto } from '../../../../contracts/http.js'; export type View = Dto;",
			"backend/src/contracts/http.ts": "export interface Dto {id: string}",
		},
	],
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
		"web-large-module-boundary",
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
		).includes("backend-large-module-boundary"),
	);
});

test("database adapters and app can consume explicit persistence entries", async () => {
	assert.deepEqual(
		await scan({
			"backend/src/modules/resources/persistence.ts":
				"export { table } from './a/infrastructure/schema.js';",
			"backend/src/modules/resources/a/infrastructure/schema.ts":
				"export const table = 1;",
			"backend/src/modules/media/b/infrastructure/schema.ts":
				"export { table } from '../../../resources/persistence.js';",
			"backend/src/app/schema.ts":
				"export { table } from '../modules/resources/persistence.js';",
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

for (const source of [
	"import type {Value} from '../b/child/public.js';export type {Value};",
	"export {value} from '../b/child/public.js';",
	"export const load=()=>import('../b/child/public.js');",
]) {
	test("large module rejects another group's child public entry", async () =>
		assert.ok(
			(
				await scan({
					"backend/src/modules/a/public.ts": source,
					"backend/src/modules/b/child/public.ts":
						"export interface Value {id:string};export const value=1;",
				})
			).includes("backend-large-module-boundary"),
		));
}

test("app cannot construct a large module's internal service", async () =>
	assert.ok(
		(
			await scan({
				"backend/src/app/main.ts":
					"export {value} from '../modules/a/child/application.js';",
				"backend/src/modules/a/child/application.ts": "export const value=1;",
			})
		).includes("backend-app-uses-module-entries"),
	));

test("business cannot import a module's creation entry", async () =>
	assert.ok(
		(
			await scan({
				"backend/src/modules/a/child/application.ts":
					"export {create} from '../../b/create.js';",
				"backend/src/modules/b/create.ts": "export const create=()=>{};",
			})
		).includes("business-does-not-use-assembly-entries"),
	));

test("root public contracts are allowed across large modules", async () =>
	assert.deepEqual(
		await scan({
			"backend/src/modules/a/child/application.ts":
				"import type {Value} from '../../b/public.js';export type {Value};",
			"backend/src/modules/b/public.ts": "export interface Value {id:string}",
		}),
		[],
	));

test("web business cannot import even another module's UI entry", async () =>
	assert.ok(
		(
			await scan({
				"web/src/features/a/child/view.ts":
					"export {View} from '../../b/ui.js';",
				"web/src/features/b/ui.ts": "export const View=()=>null;",
			})
		).includes("web-business-does-not-import-ui-entry"),
	));

test("web app can compose root UI entries", async () =>
	assert.deepEqual(
		await scan({
			"web/src/app/view.ts": "export {View} from '../features/a/ui.js';",
			"web/src/features/a/ui.ts": "export {View} from './child/view.js';",
			"web/src/features/a/child/view.ts": "export const View=()=>null;",
		}),
		[],
	));

test("root business Public API cannot export an Application", async () =>
	assert.ok(
		(
			await scan({
				"backend/src/modules/a/public.ts":
					"export {run} from './child/application.js';",
				"backend/src/modules/a/child/application.ts":
					"export const run=()=>{};",
			})
		).includes("large-public-does-not-load-implementation"),
	));

test("web sibling features remain encapsulated inside the Media module", async () =>
	assert.ok(
		(
			await scan({
				"web/src/features/media/preparation/view.ts":
					"export {run} from '../subtitles/controller.js';",
				"web/src/features/media/subtitles/controller.ts":
					"export const run=()=>{};",
			})
		).includes("web-feature-entry-points"),
	));

for (const [label, source] of [
	["import", "import {value} from '../metadata/queries.js';export {value};"],
	[
		"type import",
		"import type {Value} from '../metadata/queries.js';export type {Value};",
	],
	["re-export", "export {value} from '../metadata/queries.js';"],
	["dynamic import", "export const load=()=>import('../metadata/queries.js');"],
])
	test(`Anime rejects private sibling ${label}`, async () => {
		const violations = await scan({
			"web/src/features/anime/review/view.ts": source,
			"web/src/features/anime/metadata/queries.ts":
				"export const value=1;export interface Value {id:string}",
		});
		assert.ok(violations.includes("web-anime-feature-entry-points"));
	});
for (const [consumer, target, rule] of [
	["catalog", "review", "web-anime-catalog-does-not-import-review"],
	["metadata", "catalog", "web-anime-metadata-is-independent"],
	["shared", "metadata", "web-anime-shared-is-a-leaf"],
])
	test(`Anime ${consumer} cannot depend on ${target}`, async () => {
		const violations = await scan({
			[`web/src/features/anime/${consumer}/view.ts`]: `export {value} from '../${target}/public.js';`,
			[`web/src/features/anime/${target}/public.ts`]: "export const value=1;",
		});
		assert.ok(violations.includes(rule));
	});
for (const consumer of ["library", "tracking"])
	test(`Anime ${consumer} uses sibling public entry points`, async () => {
		assert.ok(
			(
				await scan({
					[`web/src/features/anime/${consumer}/view.ts`]:
						"export {value} from '../metadata/queries.js';",
					"web/src/features/anime/metadata/queries.ts": "export const value=1;",
				})
			).includes("web-anime-feature-entry-points"),
		);
		assert.deepEqual(
			await scan({
				[`web/src/features/anime/${consumer}/view.ts`]:
					"export {value} from '../metadata/public.js';",
				"web/src/features/anime/metadata/public.ts": "export const value=1;",
			}),
			[],
		);
	});
test("Anime Review can use selected Catalog and Metadata capabilities", async () =>
	assert.deepEqual(
		await scan({
			"web/src/features/anime/review/view.ts":
				"export {title} from '../catalog/public.js';export {lookup} from '../metadata/public.js';",
			"web/src/features/anime/catalog/public.ts": "export const title=1;",
			"web/src/features/anime/metadata/public.ts": "export const lookup=1;",
		}),
		[],
	));
test("Web data public entries cannot load a UI barrel through an intermediate entry", async () => {
	const violations = await scan({
		"web/src/features/anime/public.ts":
			"export {View} from './catalog/public.js';",
		"web/src/features/anime/catalog/public.ts": "export {View} from './ui.js';",
		"web/src/features/anime/catalog/ui.ts": "export const View=()=>null;",
	});
	assert.ok(violations.includes("web-public-does-not-load-ui-barrels"));
});

test("Tracking business cannot depend on its composition even through types", async () => {
	const violations = await scan({
		"backend/src/modules/anime/tracking/application/account.ts":
			"import type { Assembly } from '../../composition/tracking.js'; export type Account = Assembly;",
		"backend/src/modules/anime/composition/tracking.ts":
			"export interface Assembly { id: string }",
	});
	assert.ok(violations.includes("business-does-not-use-assembly-entries"));
});

test("Tracking module owns its facade and provider dependencies arrive through ports", async () => {
	assert.deepEqual(
		await scan({
			"backend/src/modules/anime/tracking/ports.ts":
				"export interface Provider { viewer(): string }",
			"backend/src/modules/anime/tracking/application/account.ts":
				"import type { Provider } from '../ports.js'; export class Account { constructor(readonly provider: Provider) {} }",
			"backend/src/modules/anime/tracking/application/tracking.ts":
				"import { Account } from './account.js'; export class TrackingModule { constructor(readonly account: Account) {} }",
			"backend/src/modules/anime/composition/tracking.ts":
				"import { Account } from '../tracking/application/account.js'; import { TrackingModule } from '../tracking/application/tracking.js'; export const create = () => new TrackingModule(new Account({viewer: () => 'fixture'}));",
		}),
		[],
	);
});

test("business code cannot hide provider-specific branches behind neutral imports", async () => {
	await assert.rejects(
		scan({
			"backend/src/modules/anime/tracking/application/targets.ts":
				"export const target = (provider: string) => provider === 'anilist';",
		}),
		/provider-independent-business/,
	);
	await assert.rejects(
		scan({
			"web/src/features/anime/tracking/example.ts":
				"export const provider = 'anilist';",
		}),
		/provider-independent-business/,
	);
});

test("download transfer stage excludes business collaborators", async () => {
	for (const target of ["anime", "resources"]) {
		const violations = await scan({
			"backend/src/modules/acquisition/downloads/transfers/service.ts": `import type { Value } from '../../../${target}/public.js'; export type { Value };`,
			[`backend/src/modules/${target}/public.ts`]:
				"export interface Value { id: string }",
		});
		assert.ok(
			violations.includes(
				"download-transfers-do-not-import-business-consumers",
			),
		);
	}
});
