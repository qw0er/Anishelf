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
import type { Logger } from "pino";
import { outboundCooldownOverflowKey } from "../../../../platform/network/request-scheduler.js";

const keyPattern =
	/^(?:(?:origin|jackett|jackett-indexer):[a-f0-9]{64}|scheduler:cooldown-overflow)$/;
/** Only opaque bucket identities and retry deadlines survive restart, never locators or credentials. */
export class SourceCooldownFile {
	private readonly directory: string;
	private readonly path: string;
	private readonly values = new Map<string, number>();
	private writing: Promise<void> | undefined;
	private dirty = false;
	constructor(
		dataDir: string,
		private readonly logger: Logger,
		private readonly now = Date.now,
	) {
		this.directory = join(dataDir, "acquisition");
		this.path = join(this.directory, "source-cooldowns.json");
	}
	async read(): Promise<Readonly<Record<string, number>>> {
		try {
			if ((await stat(this.path)).size > 512 * 1024)
				throw new Error("Invalid cooldown file.");
			const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
			if (
				!value ||
				typeof value !== "object" ||
				!("version" in value) ||
				value.version !== 1 ||
				!("cooldowns" in value) ||
				!value.cooldowns ||
				typeof value.cooldowns !== "object" ||
				Array.isArray(value.cooldowns)
			)
				throw new Error("Invalid cooldown file.");
			const entries = Object.entries(value.cooldowns);
			if (
				entries.length > 4097 ||
				entries.some(
					([key, until]) =>
						!keyPattern.test(key) ||
						typeof until !== "number" ||
						!Number.isFinite(until) ||
						until < 0,
				)
			)
				throw new Error("Invalid cooldown file.");
			for (const [key, until] of entries)
				if (typeof until === "number" && until > this.now())
					this.values.set(key, until);
			await chmod(this.path, 0o600);
		} catch (error) {
			if ((error as { code?: string }).code !== "ENOENT") {
				// Avoid immediately retrying all sources when a damaged file hides an upstream ban.
				this.values.set(outboundCooldownOverflowKey, this.now() + 60_000);
				this.logger.warn(
					{
						event: "acquisition.cooldown_restore_failed",
						retryAt: this.now() + 60_000,
					},
					"Source cooldown state unavailable; network collection briefly deferred.",
				);
			}
		}
		return Object.fromEntries(this.values);
	}
	set(key: string, until: number): void {
		if (!keyPattern.test(key) || !Number.isFinite(until) || until <= this.now())
			return;
		this.values.set(key, Math.max(this.values.get(key) ?? 0, until));
		for (const [saved, deadline] of this.values)
			if (deadline <= this.now()) this.values.delete(saved);
		if (this.values.size > 4097) {
			const deadline = Math.max(...this.values.values());
			this.values.clear();
			this.values.set(outboundCooldownOverflowKey, deadline);
		}
		this.dirty = true;
		this.scheduleWrite();
	}
	private scheduleWrite() {
		if (this.writing) return;
		this.writing = this.flush()
			.catch(() => {
				this.logger.warn(
					{ event: "acquisition.cooldown_persistence_failed" },
					"Source cooldown remains active in memory but could not be saved.",
				);
			})
			.finally(() => {
				this.writing = undefined;
				if (this.dirty) this.scheduleWrite();
			});
	}
	private async flush() {
		while (this.dirty) {
			this.dirty = false;
			const temporary = join(
				this.directory,
				`.${randomUUID()}.cooldown-pending`,
			);
			try {
				await mkdir(this.directory, { recursive: true, mode: 0o700 });
				await chmod(this.directory, 0o700);
				const handle = await open(temporary, "wx", 0o600);
				try {
					await handle.writeFile(
						JSON.stringify({
							version: 1,
							cooldowns: Object.fromEntries(this.values),
						}),
					);
					await handle.sync();
				} finally {
					await handle.close();
				}
				await rename(temporary, this.path);
			} finally {
				await rm(temporary, { force: true }).catch(() => {});
			}
		}
	}
	async close() {
		while (this.writing) await this.writing;
	}
}
