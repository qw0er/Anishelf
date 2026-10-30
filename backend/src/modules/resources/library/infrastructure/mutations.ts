import { lstat, realpath, rename, rm } from "node:fs/promises";
import { basename, isAbsolute, join, sep, win32 } from "node:path";
import { DomainError } from "../../../../shared/errors.js";

function denied(): never {
	throw new DomainError(
		"RESOURCE_ACCESS_DENIED",
		"Only regular files and directories inside resource roots may be changed.",
	);
}

/** Validate paths before using Node's filesystem operations. External concurrent
 * changes between validation and mutation are outside this command's guarantees.
 */
export class ResourceMutations {
	private constructor(private readonly root: string) {}
	static async create(path: string) {
		return new ResourceMutations(await realpath(path));
	}
	private async resolve(path: string, allowRoot = false) {
		if (path === "" && allowRoot) return this.root;
		if (
			!path ||
			path.includes("\0") ||
			path.includes("\\") ||
			isAbsolute(path) ||
			win32.isAbsolute(path)
		)
			denied();
		const parts = path.split(sep);
		if (parts.some((part) => !part || part === "." || part === "..")) denied();
		let current = this.root;
		for (const [index, part] of parts.entries()) {
			current = join(current, part);
			const info = await lstat(current);
			if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
				denied();
			if (index < parts.length - 1 && !info.isDirectory()) denied();
		}
		return current;
	}
	async inspect(path: string) {
		return { info: await lstat(await this.resolve(path)) };
	}
	async execute(
		path: string,
		destination?: { access: ResourceMutations; path: string },
	) {
		const source = await this.resolve(path);
		if (!destination) {
			await rm(source, { recursive: true });
			return;
		}
		const directory = await destination.access.resolve(destination.path, true);
		if (!(await lstat(directory)).isDirectory()) denied();
		const target = join(directory, basename(source));
		if (directory === source || directory.startsWith(`${source}${sep}`))
			throw new DomainError(
				"RESOURCE_CONFLICT",
				"A folder cannot be moved into itself.",
			);
		try {
			await lstat(target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			try {
				await rename(source, target);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EXDEV")
					throw new DomainError(
						"RESOURCE_CONFLICT",
						"Moves across filesystems are not supported.",
						{ cause: error },
					);
				throw error;
			}
			return;
		}
		throw new DomainError(
			"RESOURCE_CONFLICT",
			"The destination already exists.",
		);
	}
}
