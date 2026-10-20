import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import { workReference } from "../../../shared/external-reference.js";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
} from "../../anime/public.js";
import {
	type Candidate,
	type FeedRecord,
	type PreviewInput,
	RssError,
	type Subscription,
	type SubscriptionPreview,
	type SubscriptionView,
} from "./domain/model.js";
import { discoveryPolicy as policy } from "./policy.js";
import type { DiscoveryStore, FeedTransport } from "./ports.js";
import type { DiscoveryApi } from "./public.js";

function hash(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
function conflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Subscription or preview changed. Preview again.",
	);
}
interface Preview {
	session: string;
	input: PreviewInput;
	feed: FeedRecord;
	candidates: Candidate[];
	targetRevision: string;
	expiresAt: number;
	feedRevision: string | null;
}
export class DiscoveryApplication implements DiscoveryApi {
	private readonly shutdown = new AbortController();
	private readonly previews = new Map<string, Preview>();
	private readonly fetching = new Map<string, Promise<FeedRecord>>();
	private readonly polling = new Map<string, Promise<void>>();
	private readonly pending = new Set<Promise<unknown>>();
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking: Promise<void> | undefined;
	private preparing = 0;
	constructor(
		private readonly options: {
			store: DiscoveryStore;
			transport: FeedTransport;
			anime: ReleaseAssessmentApi;
			parse: (xml: string) => FeedRecord["entries"];
			normalizeUrl: (url: string) => string;
			downloads: (signal: AbortSignal) => Promise<string[] | null>;
			logger: Logger;
			now?: () => number;
		},
	) {}
	private now() {
		return this.options.now?.() ?? Date.now();
	}
	private open() {
		if (this.shutdown.signal.aborted)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Discovery is stopping.",
			);
	}
	private key(value: string) {
		this.open();
		try {
			workReference(value);
		} catch {
			throw new DomainError("INVALID_REQUEST", "Invalid anime reference.");
		}
	}
	get(workKey: string, page = 1): SubscriptionView {
		this.key(workKey);
		if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
			throw new DomainError("INVALID_REQUEST", "Invalid candidate page.");
		const subscription = this.options.store.subscription(workKey);
		const feed = subscription
			? this.options.store.feed(subscription.feedId)
			: null;
		const candidates = this.options.store
			.candidates(workKey)
			.sort(
				(a, b) =>
					(a.episode ?? Infinity) - (b.episode ?? Infinity) ||
					a.id.localeCompare(b.id),
			);
		return {
			subscription:
				subscription && feed
					? {
							...subscription,
							source: this.source(feed.url),
							checkedAt: feed.checkedAt,
							nextAttemptAt: feed.nextAttemptAt,
							error: feed.error ?? subscription.lastError ?? null,
						}
					: null,
			candidates: candidates.slice(
				(page - 1) * policy.pageSize,
				page * policy.pageSize,
			),
			total: candidates.length,
			page,
		};
	}
	private source(url: string) {
		const parsed = new URL(url);
		return parsed.origin;
	}
	private tracked<T>(operation: () => Promise<T>): Promise<T> {
		this.open();
		const task = operation();
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
	preview(session: string, input: PreviewInput) {
		return this.tracked(async () => {
			if (this.preparing >= 2)
				throw new DomainError(
					"ACQUISITION_UNAVAILABLE",
					"RSS previews are busy.",
				);
			this.preparing++;
			try {
				return await this.preparePreview(session, input);
			} catch (error) {
				if (!(error instanceof RssError)) throw error;
				this.options.logger.warn(
					{ event: "acquisition.preview_failed", code: error.code },
					"RSS preview could not be read.",
				);
				throw new DomainError(
					"ACQUISITION_UNAVAILABLE",
					"RSS preview could not be read.",
				);
			} finally {
				this.preparing--;
			}
		});
	}
	private async preparePreview(
		session: string,
		input: PreviewInput,
	): Promise<SubscriptionPreview> {
		this.key(input.workKey);
		if (
			!Number.isSafeInteger(input.startEpisode) ||
			input.startEpisode < 1 ||
			input.startEpisode > 10000
		)
			throw new DomainError("INVALID_REQUEST", "Invalid starting episode.");
		const current = this.options.store.subscription(input.workKey);
		if ((current?.revision ?? null) !== input.revision) conflict();
		let url: string;
		try {
			url = input.rssUrl.trim()
				? this.options.normalizeUrl(input.rssUrl.trim())
				: (this.options.store.feed(current?.feedId ?? "")?.url ?? "");
		} catch {
			throw new DomainError(
				"INVALID_REQUEST",
				"Enter a public HTTP(S) RSS URL.",
			);
		}
		if (!url) throw new DomainError("INVALID_REQUEST", "Enter an RSS URL.");
		for (const [token, preview] of this.previews)
			if (preview.expiresAt <= this.now()) this.previews.delete(token);
		if (this.previews.size >= policy.maximumPreviews)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Too many pending previews.",
			);
		const existing = this.options.store.feed(hash(url));
		const feed = await this.fetchFeed(
			existing ?? {
				revision: randomUUID(),
				id: hash(url),
				url,
				etag: null,
				lastModified: null,
				entries: [],
				checkedAt: null,
				nextAttemptAt: 0,
				failures: 0,
				error: null,
			},
		);
		const target = await this.options.anime.target(
			input.workKey,
			this.shutdown.signal,
		);
		const prospective: Subscription = {
			workKey: input.workKey,
			feedId: feed.id,
			startEpisode: input.startEpisode,
			revision: current?.revision ?? randomUUID(),
			enabled: true,
		};
		const candidates = await this.assess(prospective, feed, target);
		this.open();
		const token = randomUUID(),
			expiresAt = this.now() + policy.previewLifetimeMs;
		this.previews.set(token, {
			session,
			input: { ...input },
			feed,
			candidates,
			targetRevision: target.revision,
			expiresAt,
			feedRevision: existing?.revision ?? null,
		});
		return {
			token,
			expiresAt,
			source: this.source(url),
			startEpisode: input.startEpisode,
			availableEpisodes: target.availableEpisodes,
			knownEpisodeCount: target.work.episodeCount,
			candidates: candidates.slice(0, policy.pageSize),
			total: candidates.length,
		};
	}
	confirm(session: string, workKey: string, token: string) {
		return this.tracked(async () => {
			const preview = this.previews.get(token);
			if (
				!preview ||
				preview.session !== session ||
				preview.input.workKey !== workKey ||
				preview.expiresAt <= this.now()
			)
				conflict();
			const target = await this.options.anime.target(
				workKey,
				this.shutdown.signal,
			);
			this.open();
			const current = this.options.store.subscription(workKey);
			if (
				(current?.revision ?? null) !== preview.input.revision ||
				target.revision !== preview.targetRevision ||
				![preview.feedRevision, preview.feed.revision].includes(
					this.options.store.feed(preview.feed.id)?.revision ?? null,
				)
			)
				conflict();
			if (
				!current &&
				this.options.store.subscriptions().length >= policy.maximumSubscriptions
			)
				throw new DomainError(
					"ACQUISITION_UNAVAILABLE",
					"Subscription limit reached.",
				);
			const subscription = {
				workKey,
				feedId: preview.feed.id,
				startEpisode: preview.input.startEpisode,
				enabled: true,
				revision: randomUUID(),
			};
			this.options.store.saveSubscription(
				subscription,
				preview.feed,
				preview.candidates,
			);
			this.previews.delete(token);
			this.options.logger.info(
				{
					event: "acquisition.subscription_saved",
					feedId: preview.feed.id,
					revision: subscription.revision,
				},
				"RSS subscription enabled.",
			);
			return this.get(workKey);
		});
	}
	async setEnabled(workKey: string, revision: string, enabled: boolean) {
		this.key(workKey);
		const current = this.options.store.subscription(workKey);
		if (!current || current.revision !== revision) conflict();
		const feed = this.options.store.feed(current.feedId);
		if (!feed) conflict();
		this.options.store.saveSubscription(
			{ ...current, enabled, revision: randomUUID() },
			feed,
			this.options.store.candidates(workKey),
		);
		this.options.logger.info(
			{ event: "acquisition.subscription_toggled", enabled, feedId: feed.id },
			"RSS subscription state changed.",
		);
		return this.get(workKey);
	}
	async remove(workKey: string, revision: string) {
		this.key(workKey);
		if (!this.options.store.remove(workKey, revision)) conflict();
		this.options.logger.info(
			{ event: "acquisition.subscription_removed" },
			"RSS subscription removed.",
		);
	}
	refresh(workKey: string, revision: string) {
		return this.tracked(async () => {
			this.key(workKey);
			const subscription = this.options.store.subscription(workKey);
			if (!subscription?.enabled || subscription.revision !== revision)
				conflict();
			const feed = this.options.store.feed(subscription.feedId);
			if (!feed) conflict();
			if (feed.checkedAt !== null && this.now() - feed.checkedAt < 30_000)
				return this.get(workKey);
			await this.pollFeed(feed);
			return this.get(workKey);
		});
	}
	private fetchFeed(feed: FeedRecord): Promise<FeedRecord> {
		const current = this.fetching.get(feed.id);
		if (current) return current;
		if (this.fetching.size >= 2)
			return Promise.reject(new RssError("source_busy"));
		const task = (async () => {
			const response = await this.options.transport.fetch(
				feed.url,
				feed,
				this.shutdown.signal,
			);
			if (response.xml === null && feed.checkedAt === null)
				throw new RssError("invalid_response");
			const entries =
				response.xml === null ? feed.entries : this.options.parse(response.xml);
			const retained = new Map(feed.entries.map((entry) => [entry.id, entry]));
			for (const entry of entries) retained.set(entry.id, entry);
			if (retained.size > policy.maximumRetainedItems)
				throw new RssError("storage_limit");
			return {
				...feed,
				revision: randomUUID(),
				entries: [...retained.values()],
				etag: response.etag,
				lastModified: response.lastModified,
				checkedAt: this.now(),
				nextAttemptAt: this.now() + policy.intervalMs,
				failures: 0,
				error: null,
			};
		})();
		this.fetching.set(feed.id, task);
		void task.finally(() => this.fetching.delete(feed.id)).catch(() => {});
		return task;
	}
	private async assess(
		subscription: Subscription,
		feed: FeedRecord,
		target: AcquisitionTarget,
	): Promise<Candidate[]> {
		let hashes: string[] | null = null,
			downloadsUnknown = false;
		try {
			hashes = await this.options.downloads(this.shutdown.signal);
		} catch {
			downloadsUnknown = true;
		}
		const active = new Set(hashes ?? []);
		const previous = new Set(
			this.options.store
				.candidates(subscription.workKey)
				.filter(
					(candidate) => candidate.chosen || candidate.status === "selected",
				)
				.map((candidate) => candidate.entryId),
		);
		const candidates = feed.entries.map((entry): Candidate => {
			const assessment = this.options.anime.assess(entry.title, target),
				reasons = [...assessment.reasons];
			if (!entry.downloadUrl) reasons.push("download_unavailable");
			if (
				assessment.episode !== null &&
				assessment.episode < subscription.startEpisode
			)
				reasons.push("outside_scope");
			if (
				assessment.episode !== null &&
				target.availableEpisodes.includes(assessment.episode)
			)
				reasons.push("already_available");
			if (entry.hash && active.has(entry.hash))
				reasons.push("existing_download");
			if (downloadsUnknown) reasons.push("downloader_unavailable");
			return {
				chosen: previous.has(entry.id),
				id: hash(`${subscription.workKey}:${entry.id}`),
				entryId: entry.id,
				workKey: subscription.workKey,
				title: entry.title,
				episode: assessment.episode,
				status: reasons.length ? "skipped" : "selected",
				reasons,
				version: assessment.version,
				snapshotId: target.work.snapshotId,
				publishedAt: entry.publishedAt,
			};
		});
		candidates.sort(
			(a, b) =>
				Number(previous.has(b.entryId)) - Number(previous.has(a.entryId)) ||
				(a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity) ||
				a.entryId.localeCompare(b.entryId),
		);
		const selected = new Set<number>();
		const downloading = new Set(
			candidates
				.filter(
					(candidate) =>
						candidate.reasons.includes("existing_download") &&
						!candidate.reasons.includes("identity_unconfirmed"),
				)
				.map((candidate) => candidate.episode),
		);
		for (const candidate of candidates)
			if (candidate.status === "selected" && candidate.episode !== null) {
				if (downloading.has(candidate.episode)) {
					candidate.status = "skipped";
					candidate.reasons.push("episode_downloading");
					continue;
				}
				if (selected.has(candidate.episode)) {
					candidate.status = "skipped";
					candidate.reasons.push("another_version_selected");
				} else {
					selected.add(candidate.episode);
					candidate.chosen = true;
				}
			}
		return candidates;
	}
	private pollFeed(feed: FeedRecord): Promise<void> {
		const current = this.polling.get(feed.id);
		if (current) return current;
		const task = this.runFeed(feed);
		this.polling.set(feed.id, task);
		void task.finally(() => this.polling.delete(feed.id)).catch(() => {});
		return task;
	}
	private async runFeed(feed: FeedRecord) {
		const canPublish = (revision = feed.revision) => {
			const current = this.options.store.feed(feed.id);
			return current && [feed.revision, revision].includes(current.revision);
		};
		try {
			const updated = await this.fetchFeed(feed);
			this.open();
			if (!canPublish(updated.revision)) return;
			const subscriptions = this.options.store
				.subscriptions()
				.filter(
					(subscription) =>
						subscription.enabled && subscription.feedId === feed.id,
				);
			if (!subscriptions.length) return;
			for (const subscription of subscriptions) {
				try {
					const target = await this.options.anime.target(
						subscription.workKey,
						this.shutdown.signal,
					);
					const candidates = await this.assess(subscription, updated, target);
					this.open();
					if (!canPublish(updated.revision)) return;
					this.options.store.updateCandidates(subscription, candidates);
				} catch {
					if (this.shutdown.signal.aborted || !canPublish(updated.revision))
						return;
					this.options.store.updateCandidates(
						subscription,
						this.options.store.candidates(subscription.workKey),
						"assessment_unavailable",
					);
					this.options.logger.warn(
						{ event: "acquisition.assessment_failed", feedId: feed.id },
						"Subscription assessment will retry.",
					);
				}
			}
			if (!canPublish(updated.revision)) return;
			this.options.store.saveFeed(updated);
			this.options.logger.info(
				{
					event: "acquisition.discovery_completed",
					feedId: feed.id,
					entries: updated.entries.length,
				},
				"RSS discovery completed.",
			);
		} catch (error) {
			if (this.shutdown.signal.aborted || !canPublish()) return;
			const failures = feed.failures + 1,
				code =
					error instanceof RssError ? error.code : "assessment_unavailable";
			this.options.store.saveFeed({
				...feed,
				failures,
				error: code,
				nextAttemptAt:
					this.now() +
					Math.min(policy.retryMaximumMs, 60_000 * 2 ** Math.min(failures, 6)),
			});
			this.options.logger.warn(
				{ event: "acquisition.discovery_failed", feedId: feed.id, code },
				"RSS discovery will retry.",
			);
		}
	}
	start() {
		this.timer = setInterval(() => {
			void this.tick();
		}, policy.tickMs);
		this.timer.unref();
		void this.tick();
	}
	private tick(): Promise<void> {
		if (this.ticking || this.shutdown.signal.aborted)
			return this.ticking ?? Promise.resolve();
		const task = (async () => {
			const ids = [
				...new Set(
					this.options.store
						.subscriptions()
						.filter((subscription) => subscription.enabled)
						.map((subscription) => subscription.feedId),
				),
			];
			const due = ids
				.map((id) => this.options.store.feed(id))
				.filter((feed): feed is FeedRecord =>
					Boolean(feed && feed.nextAttemptAt <= this.now()),
				);
			for (
				let index = 0;
				index < due.length && !this.shutdown.signal.aborted;
				index += 2
			)
				await Promise.all(
					due.slice(index, index + 2).map((feed) => this.pollFeed(feed)),
				);
		})().catch(() => {
			this.options.logger.warn(
				{ event: "acquisition.scheduler_failed" },
				"RSS scheduler will retry.",
			);
		});
		this.ticking = task;
		void task.finally(() => {
			this.ticking = undefined;
		});
		return task;
	}
	async close() {
		this.shutdown.abort();
		if (this.timer) clearInterval(this.timer);
		await this.options.transport.close();
		await Promise.allSettled([
			...this.pending,
			...(this.ticking ? [this.ticking] : []),
		]);
		this.previews.clear();
	}
}
