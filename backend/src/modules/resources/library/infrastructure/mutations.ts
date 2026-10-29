import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import {
	type FileHandle,
	lstat,
	open,
	readdir,
	realpath,
	rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, sep, win32 } from "node:path";
import { DomainError } from "../../../../shared/errors.js";

function conflict(): never {
	throw new DomainError(
		"RESOURCE_CONFLICT",
		"The resource or destination changed. Refresh Files and try again.",
	);
}
function denied(): never {
	throw new DomainError(
		"RESOURCE_ACCESS_DENIED",
		"Only regular files and directories inside resource roots may be changed.",
	);
}
function fdPath(handle: FileHandle, name = ""): string {
	return `/proc/self/fd/${handle.fd}${name ? `/${name}` : ""}`;
}
function same(a: BigIntStats, b: BigIntStats): boolean {
	return a.dev === b.dev && a.ino === b.ino;
}

/** GNU mv provides rename-without-replacement and refuses cross-device copy fallback.
 * Parent descriptors are inherited explicitly; paths never pass through a shell.
 */
async function move(
	source: FileHandle,
	name: string,
	target: FileHandle,
	targetName: string,
) {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			"mv",
			[
				"--no-copy",
				"--update=none-fail",
				"-T",
				"--",
				`/proc/self/fd/3/${name}`,
				`/proc/self/fd/4/${targetName}`,
			],
			{
				stdio: ["ignore", "ignore", "ignore", source.fd, target.fd],
				timeout: 30_000,
			},
		);
		child.once("error", reject);
		child.once("close", (code) =>
			code === 0
				? resolve()
				: reject(
						new DomainError(
							"RESOURCE_WRITE_FAILED",
							"Move failed; check write permissions, filesystem boundaries and GNU coreutils support.",
						),
					),
		);
	});
}

/** Linux descriptor-relative access pins every parent and refuses symbolic links.
 * Recursive deletion uses Node's non-following rm after isolating the selected inode.
 */
export class ResourceMutations {
	private constructor(private readonly root: FileHandle) {}
	static async create(path: string) {
		const canonical = await realpath(path);
		const root = await open(
			canonical,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		return new ResourceMutations(root);
	}
	close() {
		return this.root.close();
	}
	private async directory(path: string): Promise<FileHandle> {
		if (
			path.includes("\0") ||
			path.includes("\\") ||
			isAbsolute(path) ||
			win32.isAbsolute(path)
		)
			denied();
		const parts = path ? path.split(sep) : [];
		if (parts.some((part) => !part || part === "." || part === "..")) denied();
		let handle = await open(
			fdPath(this.root),
			constants.O_RDONLY | constants.O_DIRECTORY,
		);
		try {
			for (const part of parts) {
				const next = await open(
					fdPath(handle, part),
					constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
				);
				await handle.close();
				handle = next;
			}
			return handle;
		} catch (error) {
			await handle.close();
			throw error;
		}
	}
	private async parent(path: string) {
		if (
			!path ||
			path.endsWith(sep) ||
			path.includes("\\") ||
			path.includes("\0")
		)
			denied();
		const name = basename(path);
		if (name === "." || name === "..") denied();
		return {
			handle: await this.directory(dirname(path) === "." ? "" : dirname(path)),
			name,
		};
	}
	private async inspectAt(parent: FileHandle, name: string) {
		const treeHash = createHash("sha256");
		let device: bigint | undefined;
		let visited = 0;
		const visit = async (
			directory: FileHandle,
			child: string,
			relative: string,
		): Promise<void> => {
			if (++visited > 100_000)
				throw new DomainError(
					"INVALID_REQUEST",
					"The folder is too large for one operation.",
				);
			const info = await lstat(fdPath(directory, child), { bigint: true });
			if (!info.isFile() && !info.isDirectory()) denied();
			device ??= info.dev;
			if (info.dev !== device) denied();
			treeHash.update(
				JSON.stringify([
					relative,
					info.dev.toString(),
					info.ino.toString(),
					info.size.toString(),
					info.mtimeNs.toString(),
					relative ? info.ctimeNs.toString() : null,
				]),
			);
			if (info.isDirectory()) {
				const opened = await open(
					fdPath(directory, child),
					constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
				);
				try {
					if (!same(info, await opened.stat({ bigint: true }))) conflict();
					for (const entry of (await readdir(fdPath(opened))).sort())
						await visit(opened, entry, `${relative}/${entry}`);
				} finally {
					await opened.close();
				}
			}
			const after = await lstat(fdPath(directory, child), { bigint: true });
			if (
				!same(info, after) ||
				info.mtimeNs !== after.mtimeNs ||
				info.ctimeNs !== after.ctimeNs
			)
				conflict();
		};
		await visit(parent, name, "");
		return {
			treeToken: treeHash.digest("base64url"),
			info: await lstat(fdPath(parent, name), { bigint: true }),
		};
	}
	async inspect(path: string) {
		const { handle, name } = await this.parent(path);
		try {
			return await this.inspectAt(handle, name);
		} finally {
			await handle.close();
		}
	}
	async destination(path: string, name: string, sourceDevice: bigint) {
		const handle = await this.directory(path);
		try {
			const info = await handle.stat({ bigint: true });
			if (info.dev !== sourceDevice)
				throw new DomainError(
					"RESOURCE_CONFLICT",
					"Moves across filesystems are not supported.",
				);
			try {
				await lstat(fdPath(handle, name));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT")
					return `${info.dev}:${info.ino}`;
				throw error;
			}
			conflict();
		} finally {
			await handle.close();
		}
	}
	async execute(
		path: string,
		fingerprint: string,
		destination?: { access: ResourceMutations; path: string; identity: string },
	) {
		const { handle, name } = await this.parent(path);
		try {
			const current = await this.inspectAt(handle, name);
			if (current.treeToken !== fingerprint) conflict();
			if (destination) {
				const target = await destination.access.directory(destination.path);
				try {
					const info = await target.stat({ bigint: true });
					if (`${info.dev}:${info.ino}` !== destination.identity) conflict();
					await move(handle, name, target, name);
					try {
						if (
							(await destination.access.inspectAt(target, name)).treeToken !==
							current.treeToken
						)
							conflict();
					} catch (error) {
						await move(target, name, handle, name).catch(() => {});
						throw error;
					}
				} finally {
					await target.close();
				}
			} else {
				// Isolate the selected entry before removal so a concurrent replacement is never deleted.
				const isolated = `.anishelf-delete-${randomUUID()}`;
				await move(handle, name, handle, isolated);
				try {
					if (
						(await this.inspectAt(handle, isolated)).treeToken !==
						current.treeToken
					)
						conflict();
					await rm(fdPath(handle, isolated), { recursive: true });
				} catch (error) {
					// Preserve anything left after a partial failure at its original name where possible.
					await move(handle, isolated, handle, name).catch(() => {});
					throw error;
				}
			}
		} finally {
			await handle.close();
		}
	}
}
