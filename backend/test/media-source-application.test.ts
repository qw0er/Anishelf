import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
	builtinPolicy,
	type PersistentSettings,
} from "../src/modules/configuration/public.js";
import { MediaSourceApplication } from "../src/modules/media-source/application/sources.js";
import { ResourceAccess } from "../src/modules/media-source/infrastructure/access.js";
import type {
	MediaSourceApi,
	SourceCatalog,
} from "../src/modules/media-source/public.js";

const directories: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function fixture() {
	const base = await mkdtemp(join(tmpdir(), "anishelf-source-api-"));
	directories.push(base);
	const root = join(base, "media");
	await mkdir(root);
	await writeFile(join(root, "episode.mp4"), "original");
	let settings: PersistentSettings = { resourceRoot: root };
	const catalog: SourceCatalog = {
		hasSnapshot: true,
		getFile: (id) => ({
			kind: "file",
			id,
			parentId: "root",
			name: "episode.mp4",
			relativePath: "episode.mp4",
			sizeBytes: 0,
			modifiedAt: "",
			mimeType: "video/mp4",
		}),
	};
	const source = new MediaSourceApplication({
		catalog,
		configuration: {
			get settings() {
				return settings;
			},
		},
		policy: builtinPolicy,
	});
	return {
		source,
		root,
		base,
		setRoot: (resourceRoot: string) => {
			settings = { resourceRoot };
			source.invalidateRoot();
		},
	};
}
test("source access uses only the catalog port, without a library application", async () => {
	const { source } = await fixture();
	const api: MediaSourceApi = source;
	const result = await api.resolveSource("opaque-id");
	expect(result.file).toMatchObject({ id: "opaque-id", sizeBytes: 8 });
	expect(result.identity.sourceVersion).toBeTruthy();
	const file = await api.openMedia("opaque-id");
	await file.release();
	expect(api.resourceRootEpoch).toBe(0);
});
test("root changes invalidate source resolution already awaiting filesystem access", async () => {
	const { source, base, setRoot } = await fixture();
	const next = join(base, "next");
	await mkdir(next);
	await writeFile(join(next, "episode.mp4"), "replacement");
	const original = ResourceAccess.create;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.spyOn(ResourceAccess, "create").mockImplementationOnce(async (...args) => {
		const resources = await original(...args);
		await gate;
		return resources;
	});
	const pending = source.resolveSource("opaque-id");
	setRoot(next);
	release();
	await expect(pending).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
	const resolved = await source.resolveSource("opaque-id");
	expect(resolved.rootEpoch).toBe(1);
	expect(resolved.file.sizeBytes).toBe(11);
});
