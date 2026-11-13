import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type CommandPlayerConfig,
	type CommandPlayerDraft,
	validateCommandPlayer,
} from "../../shared/player-command.js";

const storeFile = "external-players.json";

export interface ExternalPlayerStore {
	read(): Promise<CommandPlayerConfig[]>;
	add(draft: CommandPlayerDraft): Promise<CommandPlayerConfig>;
	remove(id: string): Promise<void>;
}

function isFileMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

/**
 * A bare command name is resolved from PATH at launch. A path is checked here so
 * a broken entry fails while the user is still in Settings.
 */
async function checkExecutable(executable: string): Promise<void> {
	if (!/[\\/]/.test(executable)) return;
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(executable);
	} catch {
		throw new Error("The player executable could not be found.");
	}
	if (!info.isFile()) throw new Error("The player executable is not a file.");
	if (process.platform === "win32") {
		if (!/\.(?:exe|com)$/i.test(executable))
			throw new Error("The player executable must be an .exe or .com file.");
		return;
	}
	try {
		await access(executable, constants.X_OK);
	} catch {
		throw new Error("The player executable is not executable.");
	}
}

export function createExternalPlayerStore(
	directory: string,
): ExternalPlayerStore {
	const file = join(directory, storeFile);

	async function read(): Promise<CommandPlayerConfig[]> {
		let raw: string;
		try {
			raw = await readFile(file, "utf8");
		} catch (error) {
			if (isFileMissing(error)) return [];
			throw error;
		}
		const data: unknown = JSON.parse(raw);
		if (!Array.isArray(data))
			throw new Error("Invalid external player settings.");
		return data as CommandPlayerConfig[];
	}

	async function write(players: CommandPlayerConfig[]) {
		await mkdir(directory, { recursive: true });
		await writeFile(file, `${JSON.stringify(players, null, 2)}\n`);
	}

	return {
		read,
		async add(draft) {
			const validationError = validateCommandPlayer(draft);
			if (validationError) throw new Error(validationError);
			await checkExecutable(draft.executable);
			const players = await read();
			const player: CommandPlayerConfig = {
				id: `player:${randomUUID()}`,
				name: draft.name.trim(),
				executable: draft.executable.trim(),
				args: [...draft.args],
			};
			await write([...players, player]);
			return player;
		},
		async remove(id) {
			const players = await read();
			await write(players.filter((player) => player.id !== id));
		},
	};
}
