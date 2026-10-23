import { randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	open,
	readFile,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { DomainError } from "../../../../shared/errors.js";
import type { JackettConfiguration } from "./model.js";

const jackettConfigurationSchema = Type.Object({
	version: Type.Literal(1),
	generation: Type.String({ minLength: 1, maxLength: 64 }),
	connection: Type.Union([
		Type.Null(),
		Type.Object({
			url: Type.String({ minLength: 1, maxLength: 2048 }),
			managementUrl: Type.Optional(
				Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
			),
			apiKey: Type.Union([
				Type.Null(),
				Type.String({ minLength: 1, maxLength: 4096 }),
			]),
			origin: Type.Union([Type.Literal("bundled"), Type.Literal("external")]),
			indexers: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
				maxItems: 32,
			}),
		}),
	]),
});

/** Private plaintext credentials, like tracker tokens; never part of settings.json. */
export class JackettConfigurationFile {
	private readonly directory: string;
	private readonly path: string;
	constructor(dataDir: string) {
		this.directory = join(dataDir, "acquisition");
		this.path = join(this.directory, "jackett.json");
	}
	async read(): Promise<JackettConfiguration | null> {
		try {
			if ((await stat(this.path)).size > 64 * 1024)
				throw new Error("Invalid configuration.");
			await chmod(this.directory, 0o700);
			await chmod(this.path, 0o600);
			const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
			if (!Check(jackettConfigurationSchema, value))
				throw new Error("Invalid configuration.");
			return value;
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "ENOENT"
			)
				return null;
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Jackett configuration could not be read.",
			);
		}
	}
	async write(value: JackettConfiguration): Promise<void> {
		const temporary = join(this.directory, `.${randomUUID()}.pending`);
		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			await chmod(this.directory, 0o700);
			const handle = await open(temporary, "wx", 0o600);
			try {
				await handle.writeFile(JSON.stringify(value));
				await handle.sync();
			} finally {
				await handle.close();
			}
			await rename(temporary, this.path);
		} catch {
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Jackett configuration could not be saved.",
			);
		} finally {
			await rm(temporary, { force: true }).catch(() => {});
		}
	}
}
