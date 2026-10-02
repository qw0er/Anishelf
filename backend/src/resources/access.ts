import { createHash } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import {
	access,
	type FileHandle,
	lstat,
	open,
	readdir,
	realpath,
	stat,
} from "node:fs/promises";
import { extname, isAbsolute, join, relative, sep, win32 } from "node:path";
import type { PersistentSettings } from "../config/model.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../config/policy.js";
import { DomainError } from "../errors.js";
import type { LibraryIssue, Timestamp } from "../library/scan-state.js";
import { externalSubtitleFormat } from "../subtitles/model.js";

export function getVideoMimeType(
	path: string,
	types: Readonly<Record<string, string>> = builtinPolicy.media.videoMimeTypes,
): string | null {
	return types[extname(path).toLowerCase()] ?? null;
}

export interface ResourceFileMetadata {
	sizeBytes: number;
	modifiedAt: Timestamp;
	mimeType: string;
}

export interface ResourceSourceMetadata extends ResourceFileMetadata {
	sourceVersion: string;
}

export interface OpenedResourceFile extends ResourceFileMetadata {
	/** The caller owns the resource and must release it after use. */
	handle: FileHandle;
	release(): Promise<void>;
}

function denied(): never {
	throw new DomainError(
		"RESOURCE_ACCESS_DENIED",
		"Access to this resource is denied.",
	);
}

function contains(root: string, path: string): boolean {
	const child = relative(root, path);
	return (
		child === "" ||
		(child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
	);
}

function accessError(cause: unknown): DomainError {
	if (cause instanceof DomainError) return cause;
	const code =
		typeof cause === "object" && cause !== null && "code" in cause
			? cause.code
			: undefined;
	if (code === "ENOENT" || code === "ENOTDIR")
		return new DomainError(
			"RESOURCE_MISSING",
			"The resource is no longer available.",
			{ cause },
		);
	if (code === "ELOOP")
		return new DomainError(
			"RESOURCE_ACCESS_DENIED",
			"Symbolic links are not allowed.",
			{ cause },
		);
	return new DomainError(
		"RESOURCE_UNREADABLE",
		"The resource could not be read.",
		{ cause },
	);
}

function metadata(info: Stats, mimeType: string): ResourceFileMetadata {
	return {
		sizeBytes: info.size,
		modifiedAt: info.mtime.toISOString(),
		mimeType,
	};
}

async function resolveResourceRoot(
	settings: Readonly<PersistentSettings>,
): Promise<string> {
	if (settings.resourceRoot === null)
		throw new DomainError(
			"RESOURCE_ROOT_NOT_CONFIGURED",
			"Set a resource directory before accessing the library.",
		);
	try {
		const root = await realpath(settings.resourceRoot);
		if (!(await stat(root)).isDirectory()) throw new Error("Not a directory");
		await access(root, constants.R_OK | constants.X_OK);
		return root;
	} catch (cause) {
		throw new DomainError(
			"RESOURCE_ROOT_UNAVAILABLE",
			"The resource directory is missing or unreadable.",
			{ cause },
		);
	}
}

/** Uses the same root policy as scanning and media access. */
export async function checkResourceRoot(
	settings: Readonly<PersistentSettings>,
): Promise<LibraryIssue | null> {
	try {
		await resolveResourceRoot(settings);
		return null;
	} catch (error) {
		if (
			!(error instanceof DomainError) ||
			(error.code !== "RESOURCE_ROOT_NOT_CONFIGURED" &&
				error.code !== "RESOURCE_ROOT_UNAVAILABLE")
		)
			throw error;
		return { code: error.code, message: error.message };
	}
}

/** Shared read-only filesystem policy for the scanner and media delivery. */
export class ResourceAccess {
	private constructor(
		private readonly root: string,
		private readonly policy: DeepReadonly<BuiltinPolicy>,
	) {}

	get canonicalRoot(): string {
		return this.root;
	}

	static async create(
		settings: Readonly<PersistentSettings>,
		policy: DeepReadonly<BuiltinPolicy> = builtinPolicy,
	): Promise<ResourceAccess> {
		return new ResourceAccess(await resolveResourceRoot(settings), policy);
	}

	/** An empty relative path denotes the root directory. Symlink entries are not followed. */
	async readDirectory(relativePath = ""): Promise<Dirent[]> {
		try {
			const { path, info } = await this.validatePath(relativePath);
			if (!info.isDirectory()) denied();
			await access(path, constants.R_OK | constants.X_OK);
			return await readdir(path, { withFileTypes: true });
		} catch (cause) {
			throw accessError(cause);
		}
	}

	async inspectVideoFile(relativePath: string): Promise<ResourceFileMetadata> {
		const file = await this.openFile(relativePath);
		try {
			return {
				sizeBytes: file.sizeBytes,
				modifiedAt: file.modifiedAt,
				mimeType: file.mimeType,
			};
		} finally {
			await file.release();
		}
	}

	async inspectVideoFileWithVersion(
		relativePath: string,
	): Promise<ResourceSourceMetadata> {
		return this.inspectOpenedSourceWithVersion(
			await this.openFile(relativePath),
		);
	}

	async inspectSubtitleSource(
		relativePath: string,
	): Promise<ResourceSourceMetadata> {
		return this.inspectOpenedSourceWithVersion(
			await this.openSubtitleFile(relativePath),
		);
	}

	private async inspectOpenedSourceWithVersion(
		file: OpenedResourceFile,
	): Promise<ResourceSourceMetadata> {
		try {
			const info = await file.handle.stat({ bigint: true });
			const sourceVersion = createHash("sha256")
				.update(
					JSON.stringify([
						"stat-v1",
						info.size.toString(),
						info.mtimeNs.toString(),
						info.ctimeNs.toString(),
						info.dev.toString(),
						info.ino.toString(),
					]),
				)
				.digest("base64url");
			return {
				sizeBytes: file.sizeBytes,
				modifiedAt: file.modifiedAt,
				mimeType: file.mimeType,
				sourceVersion,
			};
		} finally {
			await file.release();
		}
	}

	async openFile(relativePath: string): Promise<OpenedResourceFile> {
		return this.openTypedFile(relativePath, "video");
	}

	async openSubtitleFile(relativePath: string): Promise<OpenedResourceFile> {
		return this.openTypedFile(relativePath, "subtitle");
	}

	private async openTypedFile(
		relativePath: string,
		kind: "video" | "subtitle",
	): Promise<OpenedResourceFile> {
		let handle: FileHandle | undefined;
		try {
			const { path, info } = await this.validatePath(relativePath);
			const format = externalSubtitleFormat(
				path,
				this.policy.subtitles.formats,
			);
			// const mimeType =
			// 	kind === "video"
			// 		? getVideoMimeType(path)
			// 		: format === null
			// 			? null
			// 			: format === "vtt"
			// 				? "text/vtt"
			// 				: "text/plain";
			let mimeType: string | null = null;
			if (kind === "video") {
				mimeType = getVideoMimeType(path, this.policy.media.videoMimeTypes);
			} else if (kind === "subtitle" && format !== null) {
				mimeType = format === "vtt" ? "text/vtt" : "text/plain";
			} else {
				mimeType = null;
			}
			if (!info.isFile() || mimeType === null) denied();
			// Nonblocking open prevents a replaced FIFO from hanging the process.
			const fileHandle = await open(
				path,
				constants.O_RDONLY |
					(constants.O_NOFOLLOW ?? 0) |
					(constants.O_NONBLOCK ?? 0),
			);
			handle = fileHandle;
			const opened = await fileHandle.stat();
			const current = await this.validatePath(relativePath);
			if (
				!opened.isFile() ||
				opened.dev !== info.dev ||
				opened.ino !== info.ino ||
				opened.dev !== current.info.dev ||
				opened.ino !== current.info.ino
			)
				denied();
			let released = false;
			return {
				handle: fileHandle,
				...metadata(opened, mimeType),
				async release() {
					if (released) return;
					released = true;
					await fileHandle.close();
				},
			};
		} catch (cause) {
			if (handle) await handle.close().catch(() => {});
			throw accessError(cause);
		}
	}

	private async validatePath(
		relativePath: string,
	): Promise<{ path: string; info: Stats }> {
		if (
			relativePath.includes("\0") ||
			isAbsolute(relativePath) ||
			win32.isAbsolute(relativePath)
		)
			denied();
		const components = relativePath === "" ? [] : relativePath.split(sep);
		if (components.some((part) => part === "" || part === "." || part === ".."))
			denied();
		const path = join(this.root, ...components);
		if (!contains(this.root, path)) denied();
		let current = this.root;
		let info = await lstat(current);
		if (info.isSymbolicLink() || !info.isDirectory()) denied();
		for (const [index, component] of components.entries()) {
			current = join(current, component);
			info = await lstat(current);
			if (info.isSymbolicLink()) denied();
			if (index < components.length - 1 && !info.isDirectory())
				throw new DomainError(
					"RESOURCE_MISSING",
					"The resource is no longer available.",
				);
		}
		if (!contains(this.root, await realpath(path))) denied();
		return { path, info };
	}
}
