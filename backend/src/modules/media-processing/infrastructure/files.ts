import { constants } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	rename,
	rm,
} from "node:fs/promises";
import { join } from "node:path";
import { storageRules } from "../../../platform/storage.js";

export interface ProcessingWorkspace {
	directory: string;
	pendingPath: string;
	path: string;
}

/** Private, uniquely allocated files; callers never provide an output filename. */
export class MediaProcessingFiles {
	private readonly root: string;
	constructor(dataDir: string) {
		this.root = join(dataDir, "cache", "media-processing");
	}
	async initialize(): Promise<void> {
		await mkdir(this.root, {
			recursive: true,
			mode: storageRules.directoryMode,
		});
		const root = await lstat(this.root);
		if (!root.isDirectory() || root.isSymbolicLink())
			throw new Error("Invalid media processing directory.");
		for (const name of await readdir(this.root))
			await rm(join(this.root, name), { recursive: true, force: true });
	}
	async allocate(): Promise<ProcessingWorkspace> {
		await mkdir(this.root, {
			recursive: true,
			mode: storageRules.directoryMode,
		});
		const root = await lstat(this.root);
		if (!root.isDirectory() || root.isSymbolicLink())
			throw new Error("Invalid media processing directory.");
		await chmod(this.root, storageRules.directoryMode);
		const directory = await mkdtemp(join(this.root, "job-"));
		await chmod(directory, storageRules.directoryMode);
		return {
			directory,
			pendingPath: join(directory, "media.pending"),
			path: join(directory, "media"),
		};
	}
	async publish(workspace: ProcessingWorkspace): Promise<number> {
		const file = await open(
			workspace.pendingPath,
			constants.O_RDWR | constants.O_NOFOLLOW,
		);
		let size: number;
		try {
			const info = await file.stat();
			if (!info.isFile() || info.size <= 0)
				throw new Error("Invalid processed media file.");
			size = info.size;
			await file.chmod(storageRules.fileMode);
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(workspace.pendingPath, workspace.path);
		return size;
	}
	async remove(workspace: ProcessingWorkspace): Promise<void> {
		await rm(workspace.directory, { recursive: true, force: true });
	}
}
