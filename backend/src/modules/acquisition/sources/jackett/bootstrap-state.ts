import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";

const schema = Type.Object({
	version: Type.Literal(1),
	instance: Type.Union([Type.String(), Type.Null()]),
	phase: Type.Union([
		Type.Literal("waiting"),
		Type.Literal("pending"),
		Type.Literal("attempted"),
		Type.Literal("complete"),
		Type.Literal("manual"),
	]),
});
export interface BootstrapState {
	version: 1;
	instance: string | null;
	phase: "waiting" | "pending" | "attempted" | "complete" | "manual";
}
/** Stored in application state, never in the service's read-only volume. */
export class JackettBootstrapStateFile {
	private readonly path: string;
	constructor(dataDir: string) {
		this.path = join(dataDir, "acquisition/jackett-bootstrap.json");
	}
	async read(): Promise<BootstrapState | null> {
		try {
			const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
			if (!Check(schema, value)) throw new Error("Invalid bootstrap state");
			return value;
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "ENOENT"
			)
				return null;
			throw error;
		}
	}
	async write(value: BootstrapState) {
		const directory = dirname(this.path);
		const temporary = join(directory, `.${randomUUID()}.pending`);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await chmod(directory, 0o700);
		try {
			const file = await open(temporary, "wx", 0o600);
			try {
				await file.writeFile(JSON.stringify(value));
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(temporary, this.path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
}
