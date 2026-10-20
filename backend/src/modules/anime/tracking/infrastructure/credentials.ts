import { chmod, mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DomainError } from "../../../../shared/errors.js";
import type { TrackingConnection } from "../domain/model.js";
import type { TrackingCredentials } from "../ports.js";
/** Immutable files: SQLite publishes the reference only after a complete fsync. */
export class TrackingCredentialFiles implements TrackingCredentials {
	private readonly directory: string;
	constructor(dataDir: string) {
		this.directory = join(dataDir, "tracking-credentials");
	}
	async initialize(retainedId: string | null) {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		await chmod(this.directory, 0o700);
		for (const name of await readdir(this.directory)) {
			if (/^[a-f0-9-]{36}\.json$/.test(name) && name !== `${retainedId}.json`)
				await rm(join(this.directory, name), { force: true });
		}
	}
	private path(id: string) {
		if (!/^[a-f0-9-]{36}$/.test(id))
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"Invalid credential reference.",
			);
		return join(this.directory, `${id}.json`);
	}
	async write(connection: TrackingConnection, credential: string) {
		if (!connection.credentialId || !connection.account)
			throw new Error("Missing credential identity.");
		const handle = await open(this.path(connection.credentialId), "wx", 0o600);
		try {
			await handle.writeFile(
				JSON.stringify({
					version: 2,
					generation: connection.generation,
					accountId: connection.account.id,
					credential,
				}),
			);
			await handle.sync();
		} finally {
			await handle.close();
		}
	}
	async read(connection: TrackingConnection): Promise<string> {
		try {
			if (!connection.credentialId || !connection.account)
				throw new Error("Missing credential.");
			const path = this.path(connection.credentialId);
			await chmod(path, 0o600);
			const value = JSON.parse(await readFile(path, "utf8")) as {
				version?: unknown;
				generation?: unknown;
				accountId?: unknown;
				credential?: unknown;
			};
			const credential = value.credential;
			if (
				value.version !== 2 ||
				typeof credential !== "string" ||
				!credential ||
				credential.length > 8192 ||
				value.generation !== connection.generation ||
				value.accountId !== connection.account.id
			)
				throw new Error("Invalid credential.");
			return credential;
		} catch {
			throw new DomainError(
				"TRACKING_AUTHORIZATION_REQUIRED",
				"Reconnect your Tracking account.",
			);
		}
	}
	async remove(id: string) {
		await rm(this.path(id), { force: true });
	}
}
