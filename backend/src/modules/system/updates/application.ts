import type { Logger } from "pino";
import { compare, valid } from "semver";
import type { BuildInfo, UpdateCheck } from "../../../contracts/http.js";

const repository = "https://github.com/qw0er/Anishelf";
const cacheMs = 5 * 60 * 1000;

export class UpdateChecker {
	private cached: UpdateCheck | undefined;
	private expiresAt = 0;
	private failedUntil = 0;
	private pending: Promise<UpdateCheck> | undefined;
	constructor(
		private readonly current: BuildInfo,
		private readonly logger: Logger,
		private readonly fetchRelease: typeof fetch = fetch,
	) {}

	check(): Promise<UpdateCheck> {
		if (this.pending) return this.pending;
		if (Date.now() < this.failedUntil)
			return Promise.reject(new Error("Update check temporarily unavailable."));
		if (this.cached && Date.now() < this.expiresAt)
			return Promise.resolve(this.cached);
		this.pending = this.load()
			.then((result) => {
				this.cached = result;
				this.expiresAt = Date.now() + cacheMs;
				return result;
			})
			.catch((error: unknown) => {
				// Brief backoff also bounds repeated failures and upstream rate limiting.
				this.failedUntil = Date.now() + 30_000;
				this.logger.warn(
					{ event: "system.update_check_failed", err: error },
					"Update check failed.",
				);
				throw error;
			})
			.finally(() => {
				this.pending = undefined;
			});
		return this.pending;
	}

	private async load(): Promise<UpdateCheck> {
		const response = await this.fetchRelease(
			"https://api.github.com/repos/qw0er/Anishelf/releases/latest",
			{
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "Anishelf-update-check",
				},
				signal: AbortSignal.timeout(10_000),
			},
		);
		const checkedAt = new Date().toISOString();
		let result: UpdateCheck;
		if (response.status === 404)
			result = { status: "no-release", checkedAt, latest: null };
		else {
			if (!response.ok)
				throw new Error(`GitHub returned HTTP ${response.status}.`);
			const release: unknown = await response.json();
			if (
				!release ||
				typeof release !== "object" ||
				!("tag_name" in release) ||
				typeof release.tag_name !== "string" ||
				!valid(release.tag_name) ||
				!("draft" in release) ||
				release.draft !== false ||
				!("prerelease" in release) ||
				release.prerelease !== false
			)
				throw new Error("Invalid stable release response.");
			const latest = {
				version: release.tag_name,
				url: `${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`,
			};
			const comparison =
				this.current.channel === "stable" && valid(this.current.version)
					? compare(latest.version, this.current.version)
					: null;
			result = {
				checkedAt,
				latest,
				status:
					comparison === null
						? "uncomparable"
						: comparison > 0
							? "available"
							: comparison < 0
								? "ahead"
								: "current",
			};
		}
		this.logger.info(
			{
				event: "system.update_checked",
				status: result.status,
				version: result.latest?.version,
			},
			"Update check completed.",
		);
		return result;
	}
}
