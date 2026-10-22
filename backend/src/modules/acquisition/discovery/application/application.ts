import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import { workReference } from "../../../../shared/external-reference.js";
import type { AcquisitionTarget } from "../../../anime/public.js";
import { type FeedRecord, RssError } from "../../sources/public.js";
import type {
	Candidate,
	PreviewInput,
	Subscription,
	SubscriptionPreview,
	SubscriptionView,
} from "../domain/model.js";
import {
	acquisitionProfileFingerprint,
	builtinAcquisitionProfiles,
	defaultAcquisitionProfileId,
} from "../domain/profiles.js";
import { selectCandidates } from "../domain/selection.js";
import type { DiscoveryApi } from "../public.js";
import { DiscoveryContext, type DiscoveryOptions } from "./context.js";
import { discoveryPolicy as policy } from "./policy.js";
import { DiscoveryWorker } from "./worker.js";

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
	profileFingerprint: string;
	downloadRevision: string | null;
	session: string;
	input: PreviewInput;
	feed: FeedRecord;
	candidates: Candidate[];
	targetRevision: string;
	expiresAt: number;
	feedRevision: string | null;
}
export class DiscoveryApplication implements DiscoveryApi {
	private readonly context: DiscoveryContext;
	private readonly worker: DiscoveryWorker;
	private readonly previews = new Map<string, Preview>();
	private preparing = 0;
	constructor(private readonly options: DiscoveryOptions) {
		this.context = new DiscoveryContext(options);
		this.worker = new DiscoveryWorker(
			this.context,
			(subscription, feed, target) =>
				this.evaluateFeedCandidates(subscription, feed, target),
		);
	}
	private key(value: string) {
		this.context.open();
		try {
			workReference(value);
		} catch {
			throw new DomainError("INVALID_REQUEST", "Invalid anime reference.");
		}
	}
	profiles() {
		const selectedProfileId =
			this.options.defaultProfileId?.() ?? defaultAcquisitionProfileId;
		const profiles = this.options.profiles ?? builtinAcquisitionProfiles;
		return {
			profiles: profiles.map((profile) => ({
				id: profile.id,
				name: profile.name,
				description: profile.description ?? "",
				source: profile.id.startsWith("builtin:")
					? ("builtin" as const)
					: ("custom" as const),
			})),
			selectedProfileId,
			selectionAvailable: profiles.some(
				(profile) => profile.id === selectedProfileId,
			),
		};
	}
	get(workKey: string, page = 1): SubscriptionView {
		this.key(workKey);
		if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
			throw new DomainError("INVALID_REQUEST", "Invalid candidate page.");
		const subscription = this.options.store.subscription(workKey);
		const feed = subscription
			? this.options.sources.feed(subscription.feedId)
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
	preview(session: string, input: PreviewInput) {
		return this.context.tracked(async () => {
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
				? this.options.sources.normalizeUrl(input.rssUrl.trim())
				: (this.options.sources.feed(current?.feedId ?? "")?.url ?? "");
		} catch {
			throw new DomainError(
				"INVALID_REQUEST",
				"Enter a public HTTP(S) RSS URL.",
			);
		}
		if (!url) throw new DomainError("INVALID_REQUEST", "Enter an RSS URL.");
		for (const [token, preview] of this.previews)
			if (preview.expiresAt <= this.context.now()) this.previews.delete(token);
		if (this.previews.size >= policy.maximumPreviews)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Too many pending previews.",
			);
		const existing = this.options.sources.feed(hash(url));
		const feed = await this.options.sources.fetch(
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
			this.context.signal,
		);
		const profileId = input.profileId ?? null;
		const resolvedId = profileId ?? this.profiles().selectedProfileId;
		const selectedProfile = (
			this.options.profiles ?? builtinAcquisitionProfiles
		).find((profile) => profile.id === resolvedId);
		if (!selectedProfile)
			throw new DomainError(
				"INVALID_REQUEST",
				"The acquisition profile is unavailable. Choose an existing profile.",
			);
		const prospective: Subscription = {
			profileId,
			workKey: input.workKey,
			feedId: feed.id,
			startEpisode: input.startEpisode,
			revision: current?.revision ?? randomUUID(),
			enabled: true,
		};
		const candidates = await this.evaluateFeedCandidates(
			prospective,
			feed,
			target,
		);
		this.context.open();
		const token = randomUUID(),
			expiresAt = this.context.now() + policy.previewLifetimeMs;
		const download =
			this.options.downloadPreview?.(input.workKey, target) ?? null;
		this.previews.set(token, {
			profileFingerprint: acquisitionProfileFingerprint(selectedProfile),
			downloadRevision: download?.revision ?? null,
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
			downloadDestination: download?.path ?? null,
			candidates: candidates.slice(0, policy.pageSize),
			total: candidates.length,
		};
	}
	confirm(session: string, workKey: string, token: string) {
		return this.context.tracked(async () => {
			const preview = this.previews.get(token);
			if (
				!preview ||
				preview.session !== session ||
				preview.input.workKey !== workKey ||
				preview.expiresAt <= this.context.now()
			)
				conflict();
			const target = await this.options.anime.target(
				workKey,
				this.context.signal,
			);
			this.context.open();
			const current = this.options.store.subscription(workKey);
			const profile = (
				this.options.profiles ?? builtinAcquisitionProfiles
			).find(
				(profile) =>
					profile.id ===
					(preview.input.profileId ?? this.profiles().selectedProfileId),
			);
			if (
				!profile ||
				acquisitionProfileFingerprint(profile) !== preview.profileFingerprint
			)
				conflict();
			if (
				(current?.revision ?? null) !== preview.input.revision ||
				target.revision !== preview.targetRevision ||
				![preview.feedRevision, preview.feed.revision].includes(
					this.options.sources.feed(preview.feed.id)?.revision ?? null,
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
			const download = this.options.downloadPreview?.(workKey, target) ?? null;
			if ((download?.revision ?? null) !== preview.downloadRevision) conflict();
			const subscription = {
				workKey,
				feedId: preview.feed.id,
				startEpisode: preview.input.startEpisode,
				profileId: preview.input.profileId ?? null,
				enabled: true,
				revision: randomUUID(),
			};
			this.options.confirmation.commit(
				subscription,
				preview.downloadRevision,
				() => {
					this.options.store.saveSubscription(
						subscription,
						preview.feed,
						preview.candidates,
					);
				},
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
		const feed = this.options.sources.feed(current.feedId);
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
		return this.context.tracked(async () => {
			this.key(workKey);
			const subscription = this.options.store.subscription(workKey);
			if (!subscription?.enabled || subscription.revision !== revision)
				conflict();
			const feed = this.options.sources.feed(subscription.feedId);
			if (!feed) conflict();
			if (
				feed.checkedAt !== null &&
				this.context.now() - feed.checkedAt < 30_000
			)
				return this.get(workKey);
			await this.worker.pollFeed(feed);
			return this.get(workKey);
		});
	}

	private async evaluateFeedCandidates(
		subscription: Subscription,
		feed: FeedRecord,
		target: AcquisitionTarget,
	): Promise<Candidate[]> {
		let hashes: string[] | null = null,
			downloadsUnknown = false;
		try {
			hashes = await this.options.downloads(this.context.signal);
		} catch {
			downloadsUnknown = true;
		}
		const current = this.options.store.subscription(subscription.workKey);
		const history =
			current?.feedId === subscription.feedId
				? this.options.store.candidates(subscription.workKey)
				: [];
		const profileId =
			subscription.profileId ?? this.profiles().selectedProfileId;
		const candidates = selectCandidates({
			history,
			now: this.context.now(),
			locked: new Set(
				this.options.lockedCandidates?.(subscription.workKey) ?? [],
			),
			profile:
				(this.options.profiles ?? builtinAcquisitionProfiles).find(
					(profile) => profile.id === profileId,
				) ?? null,
			subscription,
			feed,
			target,
			downloadsUnknown,
			active: new Set(hashes ?? []),
			assessReleaseTitle: (title, work) =>
				this.options.anime.assessReleaseTitle(title, work),
		});
		for (const candidate of candidates) {
			const prior = history.find((other) => other.id === candidate.id);
			if (JSON.stringify(prior) !== JSON.stringify(candidate))
				this.options.logger.info(
					{
						event: "acquisition.release_decided",
						workKey: subscription.workKey,
						candidateId: candidate.id,
						episode: candidate.episode,
						status: candidate.status,
						reasons: candidate.reasons,
						...candidate.selection,
					},
					"Release selection evaluated.",
				);
		}
		return candidates;
	}
	/** Discovery owns the projection and reservation-result writes exposed to Downloads. */
	acquisition() {
		return {
			subscription: (workKey: string) =>
				this.options.store.subscription(workKey),
			subscriptions: () => this.options.store.subscriptions(),
			candidates: (workKey: string) => {
				const subscription = this.options.store.subscription(workKey);
				const profile = (
					this.options.profiles ?? builtinAcquisitionProfiles
				).find(
					(profile) =>
						profile.id ===
						(subscription?.profileId ?? this.profiles().selectedProfileId),
				);
				const locked = new Set(this.options.lockedCandidates?.(workKey) ?? []);
				return this.options.store.candidates(workKey).map((candidate) =>
					locked.has(candidate.id) ||
					(profile &&
						candidate.selection?.fingerprint ===
							acquisitionProfileFingerprint(profile))
						? candidate
						: {
								...candidate,
								status: "skipped" as const,
								reasons: ["profile_unavailable"],
							},
				);
			},
			release: (feedId: string, entryId: string) =>
				this.options.sources
					.feed(feedId)
					?.entries.find((entry) => entry.id === entryId) ?? null,
			reservationOutcome: (subscription: Subscription, failed: boolean) =>
				this.options.store.reservationOutcome(subscription, failed),
		};
	}
	start() {
		this.options.sources.start(
			() =>
				this.options.store
					.subscriptions()
					.filter((subscription) => subscription.enabled)
					.map((subscription) => subscription.feedId),
			(feed) => this.worker.pollFeed(feed),
		);
	}
	async close() {
		this.context.shutdown.abort();
		await this.options.sources.close();
		await Promise.allSettled([...this.context.pending, this.worker.close()]);
		this.previews.clear();
	}
}
