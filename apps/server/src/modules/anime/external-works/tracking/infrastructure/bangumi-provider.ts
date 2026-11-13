import { createHash } from "node:crypto";
import { workKey, workReference } from "@anishelf/contracts/references";
import { DomainError } from "../../../../../shared/errors.js";
import { externalId } from "../../../../../shared/external-reference.js";
import { type BangumiClient, BangumiError } from "../../bangumi/public.js";
import {
	type TrackingLease,
	TrackingProviderError,
	type ViewingStatus,
} from "../domain/list.js";
import type {
	TrackingDesiredState,
	TrackingRemoteState,
} from "../domain/operation.js";
import type {
	TrackingAccountProvider,
	TrackingListProvider,
	TrackingProgressInspection,
	TrackingUpdateProvider,
} from "../ports.js";

const statuses = {
	1: "planned",
	2: "completed",
	3: "watching",
	4: "paused",
	5: "dropped",
} as const satisfies Record<number, ViewingStatus>;

export const bangumiTracking = {
	key: "bangumi",
	name: "Bangumi",
	authorization: {
		kind: "credential",
		label: "Personal access token",
		url: "https://next.bgm.tv/demo/access-token",
	},
	capabilities: {
		progress: "episode-collections",
		maximumProgress: 2147483647,
		statuses: ["watching", "planned", "completed", "paused", "dropped"],
	},
} satisfies import("../domain/model.js").TrackingProviderDescriptor;

type Collection = NonNullable<Awaited<ReturnType<BangumiClient["collection"]>>>;
type Episode = Awaited<ReturnType<BangumiClient["episodes"]>>[number];
type TrackingClient = Pick<
	BangumiClient,
	| "viewer"
	| "collections"
	| "collection"
	| "episodes"
	| "episodeCollections"
	| "writeCollection"
	| "writeEpisodes"
>;

function subjectId(mediaId: string) {
	const reference = workReference(mediaId);
	const id = Number(reference.id);
	if (
		reference.provider !== "bangumi" ||
		!/^[1-9][0-9]*$/.test(reference.id) ||
		!Number.isSafeInteger(id)
	)
		throw new TrackingProviderError("invalid-request", null);
	return id;
}

function toRemote(entry: Collection): TrackingRemoteState {
	const updatedAt = Date.parse(entry.updated_at);
	if (!Number.isFinite(updatedAt))
		throw new TrackingProviderError("invalid-response", null);
	return {
		id: externalId("bangumi", String(entry.subject_id)),
		progress: entry.ep_status,
		status: statuses[entry.type],
		updatedAt,
	};
}

function toSubjectStatus(status: ViewingStatus) {
	switch (status) {
		case "planned":
			return 1;
		case "completed":
			return 2;
		case "watching":
			return 3;
		case "paused":
			return 4;
		case "dropped":
			return 5;
		case "rewatching":
			throw new TrackingProviderError("invalid-request", null);
	}
}

async function adapt<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof BangumiError)
			throw new TrackingProviderError(
				error.failure.code === "not-found"
					? "invalid-request"
					: error.failure.code,
				error.failure.retryAt,
			);
		throw error;
	}
}

function regularEpisodes(episodes: Episode[], id: number) {
	const byNumber = new Map<number, number>();
	const ids = new Set<number>();
	for (const episode of episodes) {
		const number = episode.ep;
		if (
			number === undefined ||
			!Number.isSafeInteger(number) ||
			number < 1 ||
			byNumber.has(number) ||
			ids.has(episode.id) ||
			(episode.subject_id !== undefined && episode.subject_id !== id)
		)
			throw new TrackingProviderError("invalid-request", null);
		byNumber.set(number, episode.id);
		ids.add(episode.id);
	}
	return byNumber;
}

export class BangumiTrackingProvider
	implements
		TrackingAccountProvider,
		TrackingListProvider,
		TrackingUpdateProvider
{
	constructor(private readonly client: TrackingClient) {}

	async viewer(credential: string, signal: AbortSignal) {
		if (!credential || /\s/.test(credential))
			throw new DomainError("INVALID_REQUEST", "Invalid access token.");
		try {
			const account = await this.client.viewer(credential, signal);
			return {
				id: externalId("bangumi", String(account.id)),
				name: account.nickname.trim() || account.username,
			};
		} catch (error) {
			signal.throwIfAborted();
			if (
				error instanceof BangumiError &&
				error.failure.code === "unauthorized"
			)
				throw new DomainError(
					"TRACKING_AUTHORIZATION_REQUIRED",
					"Reconnect your Bangumi account.",
				);
			if (
				error instanceof BangumiError &&
				error.failure.code === "rate-limited"
			)
				throw new DomainError(
					"TRACKING_RATE_LIMITED",
					"Bangumi rate limit reached.",
				);
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"Bangumi account check failed.",
			);
		}
	}

	private async username(lease: TrackingLease, signal: AbortSignal) {
		const account = await this.client.viewer(lease.credential, signal);
		if (externalId("bangumi", String(account.id)) !== lease.accountId)
			throw new TrackingProviderError("unauthorized", null);
		return account.username;
	}

	async read(lease: TrackingLease, signal: AbortSignal) {
		return adapt(async () => {
			const username = await this.username(lease, signal);
			const entries = await this.client.collections(
				username,
				lease.credential,
				signal,
			);
			const ids = new Set<number>();
			return entries.map((entry) => {
				const subject = entry.subject;
				if (!subject || subject.id !== entry.subject_id || ids.has(subject.id))
					throw new TrackingProviderError("invalid-response", null);
				ids.add(subject.id);
				const titleVariants: NonNullable<
					import("../domain/list.js").TrackingListEntry["titleVariants"]
				> = [];
				if (subject.name.trim())
					titleVariants.push({
						value: subject.name.trim(),
						kind: "native",
						language: null,
					});
				if (subject.name_cn.trim())
					titleVariants.push({
						value: subject.name_cn.trim(),
						kind: "alias",
						language: "zh-Hans",
					});
				if (!titleVariants.length)
					throw new TrackingProviderError("invalid-response", null);
				const year = /^(\d{4})-/.exec(subject.date ?? "")?.[1];
				return {
					...toRemote(entry),
					mediaId: workKey({
						provider: "bangumi",
						mediaType: "anime",
						id: String(subject.id),
					}),
					titles: titleVariants.map(({ value }) => value),
					titleVariants,
					format: null,
					year: year ? Number(year) : null,
					episodeCount: subject.eps || null,
					coverUrl: subject.images?.common || null,
				};
			});
		});
	}

	private async remote(
		username: string,
		id: number,
		credential: string,
		signal: AbortSignal,
	) {
		const entry = await this.client.collection(
			username,
			id,
			credential,
			signal,
		);
		if (entry && entry.subject_id !== id)
			throw new TrackingProviderError("invalid-response", null);
		return entry ? toRemote(entry) : null;
	}

	async get(lease: TrackingLease, mediaId: string, signal: AbortSignal) {
		return adapt(async () =>
			this.remote(
				await this.username(lease, signal),
				subjectId(mediaId),
				lease.credential,
				signal,
			),
		);
	}

	private async progress(
		lease: TrackingLease,
		id: number,
		remote: TrackingRemoteState | null,
		target: number,
		signal: AbortSignal,
	) {
		const { credential } = lease;
		const collections = remote
			? await this.client.episodeCollections(id, credential, signal)
			: [];
		const episodes = await this.client.episodes(id, signal, credential);
		const byNumber = regularEpisodes(episodes, id);
		const numbersById = new Map(
			[...byNumber].map(([number, id]) => [id, number]),
		);
		const seen = new Set<number>();
		for (const { episode } of collections) {
			const number = numbersById.get(episode.id);
			if (
				number === undefined ||
				seen.has(episode.id) ||
				(episode.ep !== undefined && episode.ep !== number) ||
				(episode.subject_id !== undefined && episode.subject_id !== id)
			)
				throw new TrackingProviderError("invalid-response", null);
			seen.add(episode.id);
		}
		const watched = new Set(
			collections
				.filter(({ type }) => type === 2)
				.map(({ episode }) => episode.id),
		);
		const mark: number[] = [];
		const clear: number[] = [];
		if (target > byNumber.size)
			throw new TrackingProviderError("invalid-request", null);
		for (let number = 1; number <= target; number++) {
			const episode = byNumber.get(number);
			if (!episode) throw new TrackingProviderError("invalid-request", null);
			if (!watched.has(episode)) mark.push(episode);
		}
		for (const [number, episode] of byNumber) {
			if (number > target && watched.has(episode)) clear.push(episode);
		}
		let prefix = 0;
		while (watched.has(byNumber.get(prefix + 1) ?? 0)) prefix++;
		const baseline = createHash("sha256")
			.update(
				JSON.stringify(
					[...byNumber]
						.sort(([a], [b]) => a - b)
						.map(([number, episode]) => [
							number,
							episode,
							watched.has(episode),
						]),
				),
			)
			.digest("hex");
		return {
			mark,
			clear,
			prefix,
			continuous: watched.size === prefix,
			baseline,
		};
	}

	async inspectProgress(
		lease: TrackingLease,
		mediaId: string,
		remote: TrackingRemoteState | null,
		target: number,
		automatic: boolean,
		signal: AbortSignal,
	): Promise<TrackingProgressInspection> {
		return adapt(async () => {
			const progress = await this.progress(
				lease,
				subjectId(mediaId),
				remote,
				target,
				signal,
			);
			const { baseline } = progress;
			if (automatic && (!progress.continuous || target > progress.prefix + 1))
				return { state: "confirmation-required", baseline };
			if (automatic && target <= progress.prefix)
				return { state: "matched", baseline };
			return {
				state:
					progress.mark.length || progress.clear.length ? "write" : "matched",
				baseline,
			};
		});
	}

	async save(
		lease: TrackingLease,
		mediaId: string,
		entryId: string | null,
		desired: TrackingDesiredState,
		signal: AbortSignal,
		context?: {
			automatic: boolean;
			remote: TrackingRemoteState | null;
			episodeBaseline?: string;
		},
	) {
		return adapt(async () => {
			const id = subjectId(mediaId);
			const { credential } = lease;
			const username = await this.username(lease, signal);
			const before = await this.remote(username, id, credential, signal);
			if (
				(before?.id ?? null) !== entryId ||
				(context &&
					(before?.progress !== context.remote?.progress ||
						before?.status !== context.remote?.status))
			)
				throw new TrackingProviderError("remote-changed", null);
			const progress =
				desired.progress === undefined
					? null
					: await this.progress(lease, id, before, desired.progress, signal);
			if (
				progress &&
				context?.episodeBaseline !== undefined &&
				context.episodeBaseline !== progress.baseline
			)
				throw new TrackingProviderError("remote-changed", null);
			if (
				context?.automatic &&
				progress &&
				(!progress.continuous || desired.progress !== progress.prefix + 1)
			)
				throw new TrackingProviderError("remote-changed", null);
			const status = desired.status ?? before?.status;
			if (!status) throw new TrackingProviderError("invalid-request", null);
			let after: TrackingRemoteState | null;
			try {
				if (!before)
					await this.client.writeCollection(
						id,
						toSubjectStatus(status),
						true,
						credential,
						signal,
					);
				if (progress?.clear.length)
					await this.client.writeEpisodes(
						id,
						progress.clear,
						0,
						credential,
						signal,
					);
				if (progress?.mark.length)
					await this.client.writeEpisodes(
						id,
						progress.mark,
						2,
						credential,
						signal,
					);
				after = await this.remote(username, id, credential, signal);
				if (after && after.status !== status) {
					await this.client.writeCollection(
						id,
						toSubjectStatus(status),
						false,
						credential,
						signal,
					);
					after = await this.remote(username, id, credential, signal);
				}
			} catch (error) {
				if (
					error instanceof BangumiError &&
					(error.failure.code === "invalid-request" ||
						error.failure.code === "not-found")
				)
					throw new TrackingProviderError("remote-changed", null);
				throw error;
			}
			if (!after || after.status !== status)
				throw new TrackingProviderError("invalid-response", null);
			if (desired.progress !== undefined) {
				const verified = await this.progress(
					lease,
					id,
					after,
					desired.progress,
					signal,
				);
				if (verified.mark.length || verified.clear.length)
					throw new TrackingProviderError("invalid-response", null);
			}
			return after;
		});
	}

	async supportsMovie(mediaId: string, signal: AbortSignal) {
		return adapt(async () => {
			const id = subjectId(mediaId);
			const episodes = await this.client.episodes(id, signal);
			return episodes.length === 1 && regularEpisodes(episodes, id).has(1);
		});
	}
}
