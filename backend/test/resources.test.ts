import { execFile } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	getVideoMimeType,
	ResourceAccess,
} from "../src/modules/resource-access/infrastructure/access.js";

let fixture: string;
let root: string;
let resources: ResourceAccess;
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-resources-"));
	root = join(fixture, "media");
	await mkdir(join(root, "中文 folder"), { recursive: true });
	await writeFile(join(root, "中文 folder", "episode 01.MP4"), "sample-video");
	resources = await ResourceAccess.create({ resourceRoot: root });
});
afterEach(async () => {
	await rm(fixture, { recursive: true, force: true });
});

test.each([
	["movie.MP4", "video/mp4"],
	["movie.m4v", "video/mp4"],
	["movie.webm", "video/webm"],
	["movie.mkv", "video/x-matroska"],
	["movie.txt", null],
	["movie.mp4.txt", null],
])("video discovery policy: %s", (path, mimeType) => {
	expect(getVideoMimeType(path as string)).toBe(mimeType);
});

test("reads root and nested directories and preserves original files", async () => {
	expect((await resources.readDirectory()).map((entry) => entry.name)).toEqual([
		"中文 folder",
	]);
	expect(
		(await resources.readDirectory("中文 folder")).map((entry) => entry.name),
	).toEqual(["episode 01.MP4"]);
	const file = await resources.openFile(join("中文 folder", "episode 01.MP4"));
	try {
		expect(file.sizeBytes).toBe(12);
		expect(file.mimeType).toBe("video/mp4");
		expect(new Date(file.modifiedAt).toISOString()).toBe(file.modifiedAt);
		expect(await file.handle.readFile("utf8")).toBe("sample-video");
		await expect(file.handle.writeFile("modified")).rejects.toMatchObject({
			code: "EBADF",
		});
	} finally {
		await file.release();
	}
	expect(
		await resources.inspectVideoFile(join("中文 folder", "episode 01.MP4")),
	).toMatchObject({ sizeBytes: 12, mimeType: "video/mp4" });
});

test("release closes the file handle and can be called more than once", async () => {
	const file = await resources.openFile(join("中文 folder", "episode 01.MP4"));
	await file.release();
	await expect(file.handle.stat()).rejects.toThrow();
	await expect(file.release()).resolves.toBeUndefined();
});

test.each([
	"../outside.mp4",
	"中文 folder/../../outside.mp4",
	"/etc/passwd",
	"C:\\outside.mp4",
	"\\\\server\\share\\outside.mp4",
	"bad\0name.mp4",
	"./video.mp4",
])("rejects invalid relative paths: %s", async (path) => {
	await expect(resources.openFile(path)).rejects.toMatchObject({
		code: "RESOURCE_ACCESS_DENIED",
	});
});

test("rejects directories and unsupported regular files as media", async () => {
	await mkdir(join(root, "folder.mp4"));
	await writeFile(join(root, "notes.txt"), "private text");
	for (const path of ["", "folder.mp4", "notes.txt"])
		await expect(resources.openFile(path)).rejects.toMatchObject({
			code: "RESOURCE_ACCESS_DENIED",
		});
	await expect(resources.readDirectory("notes.txt")).rejects.toMatchObject({
		code: "RESOURCE_ACCESS_DENIED",
	});
});

test("missing files and invalid parent directories use the missing-resource error", async () => {
	await expect(resources.openFile("removed.mp4")).rejects.toMatchObject({
		code: "RESOURCE_MISSING",
	});
	await expect(
		resources.openFile(join("中文 folder", "episode 01.MP4", "nested.mp4")),
	).rejects.toMatchObject({ code: "RESOURCE_MISSING" });
});

test("rejects symlink files, directory escapes, and links inside the root", async () => {
	const outside = join(fixture, "media-extra");
	await mkdir(outside);
	await writeFile(join(outside, "secret.mp4"), "outside");
	await symlink(join(outside, "secret.mp4"), join(root, "link.mp4"));
	await symlink(outside, join(root, "directory-link"), "dir");
	await symlink(
		join(root, "中文 folder", "episode 01.MP4"),
		join(root, "internal-link.mp4"),
	);
	for (const path of [
		"link.mp4",
		"internal-link.mp4",
		join("directory-link", "secret.mp4"),
	])
		await expect(resources.openFile(path)).rejects.toMatchObject({
			code: "RESOURCE_ACCESS_DENIED",
		});
	await expect(resources.readDirectory("directory-link")).rejects.toMatchObject(
		{ code: "RESOURCE_ACCESS_DENIED" },
	);
	expect(
		(await resources.readDirectory()).filter((entry) => entry.isSymbolicLink()),
	).toHaveLength(3);
});

test("rechecks a previously inspected file after replacement by a symlink", async () => {
	const path = join("中文 folder", "episode 01.MP4");
	await resources.inspectVideoFile(path);
	await rm(join(root, path));
	const outside = join(fixture, "outside.mp4");
	await writeFile(outside, "outside");
	await symlink(outside, join(root, path));
	await expect(resources.openFile(path)).rejects.toMatchObject({
		code: "RESOURCE_ACCESS_DENIED",
	});
});

test("canonicalizes a configured root alias and rejects replacement of the canonical root", async () => {
	const alias = join(fixture, "alias");
	await symlink(root, alias, "dir");
	const access = await ResourceAccess.create({ resourceRoot: alias });
	expect(await access.readDirectory()).toHaveLength(1);
	await rename(root, join(fixture, "old-root"));
	await symlink(join(fixture, "old-root"), root, "dir");
	await expect(access.readDirectory()).rejects.toMatchObject({
		code: "RESOURCE_ACCESS_DENIED",
	});
});

test("unavailable roots are recoverable by creating access again", async () => {
	const missing = join(fixture, "missing");
	await expect(
		ResourceAccess.create({ resourceRoot: missing }),
	).rejects.toMatchObject({ code: "RESOURCE_ROOT_UNAVAILABLE" });
	await writeFile(missing, "not a directory");
	await expect(
		ResourceAccess.create({ resourceRoot: missing }),
	).rejects.toMatchObject({ code: "RESOURCE_ROOT_UNAVAILABLE" });
	await rm(missing);
	await mkdir(missing);
	expect(
		await (
			await ResourceAccess.create({ resourceRoot: missing })
		).readDirectory(),
	).toEqual([]);
});

test.skipIf(process.platform !== "linux")(
	"rejects FIFO media without opening or waiting for a writer",
	async () => {
		await promisify(execFile)("mkfifo", [join(root, "pipe.mp4")]);
		await expect(resources.openFile("pipe.mp4")).rejects.toMatchObject({
			code: "RESOURCE_ACCESS_DENIED",
		});
	},
);

test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
	"unreadable resources have a distinct error",
	async () => {
		const path = join("中文 folder", "episode 01.MP4");
		await chmod(join(root, path), 0o000);
		try {
			await expect(resources.openFile(path)).rejects.toMatchObject({
				code: "RESOURCE_UNREADABLE",
			});
		} finally {
			await chmod(join(root, path), 0o600);
		}
	},
);
