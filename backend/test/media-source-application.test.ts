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

import { DomainError } from "../src/shared/errors.js";

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

test("revalidation accepts unchanged files and rejects replacement versions", async () => {
	const { source, root } = await fixture();
	const expected = await source.resolveSource("opaque-id");
	await expect(source.revalidateSource(expected)).resolves.toEqual(expected);
	await writeFile(join(root, "episode.mp4"), "replacement content");
	await expect(source.revalidateSource(expected)).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	await expect(
		source.resolveSource("opaque-id", expected.identity.sourceVersion),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
});

test("active references retain their epoch while durable references can survive a restart", async () => {
	const { source } = await fixture();
	const expected = await source.resolveSource("opaque-id");
	source.invalidateRoot();
	await expect(source.revalidateSource(expected)).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	await expect(
		source.revalidateSource({ identity: expected.identity }),
	).resolves.toMatchObject({ identity: expected.identity, rootEpoch: 1 });
});

test("revalidation rejects a changed root or relative path even when the version matches", async () => {
	const { source, root } = await fixture();
	const expected = await source.resolveSource("opaque-id");
	for (const identity of [
		{ ...expected.identity, canonicalRoot: join(root, "other") },
		{ ...expected.identity, relativePath: "different.mp4" },
	]) {
		await expect(source.revalidateSource({ identity })).rejects.toMatchObject({
			code: "PLAYBACK_CONFLICT",
		});
	}
	await expect(
		source.openResources({
			identity: { ...expected.identity, canonicalRoot: join(root, "other") },
		}),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
});

test("revalidation preserves missing-file errors when the root has not changed", async () => {
	const { source, root } = await fixture();
	const expected = await source.resolveSource("opaque-id");
	await rm(join(root, "episode.mp4"));
	await expect(source.revalidateSource(expected)).rejects.toMatchObject({
		code: "RESOURCE_MISSING",
	});
});

test("a root switch during a failed file read reports a conflict rather than a missing file", async () => {
	const { source } = await fixture();
	const expected = await source.resolveSource("opaque-id");
	let entered!: () => void;
	let release!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.spyOn(
		ResourceAccess.prototype,
		"inspectVideoFileWithVersion",
	).mockImplementationOnce(async () => {
		entered();
		await gate;
		throw new DomainError("RESOURCE_MISSING", "Removed during inspection.");
	});
	const pending = source.revalidateSource(expected);
	const rejected = expect(pending).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	await started;
	source.invalidateRoot();
	release();
	await rejected;
});

test("subtitle identity validates the actual handle and releases rejected handles", async () => {
	const { source, root } = await fixture();
	const path = "episode.srt";
	await writeFile(join(root, path), "original subtitle");
	const resources = await source.openResources();
	const metadata = await resources.inspectSubtitleSource(path);
	const identity = {
		canonicalRoot: resources.canonicalRoot,
		relativePath: path,
		sourceVersion: metadata.sourceVersion,
	};
	const file = await resources.openSubtitleSource(identity);
	try {
		expect(await file.handle.readFile("utf8")).toBe("original subtitle");
	} finally {
		await file.release();
	}
	await resources.revalidateSubtitleSource(identity);
	await writeFile(join(root, path), "replacement subtitle");
	const open = resources.openSubtitleFile.bind(resources);
	let rejectedHandle: Awaited<ReturnType<typeof open>> | undefined;
	vi.spyOn(resources, "openSubtitleFile").mockImplementationOnce(
		async (relativePath) => {
			rejectedHandle = await open(relativePath);
			return rejectedHandle;
		},
	);
	await expect(resources.openSubtitleSource(identity)).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	if (!rejectedHandle) throw new Error("Expected a rejected handle");
	await expect(rejectedHandle.handle.stat()).rejects.toMatchObject({
		code: "EBADF",
	});
	await expect(
		resources.revalidateSubtitleSource(identity),
	).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
});
