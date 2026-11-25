import { randomUUID } from "node:crypto";
import type { AcquisitionTarget } from "../../../anime/public.js";
import { coverageChoices } from "../../coverage-planning.js";
import type { Candidate, Subscription } from "../../subscriptions/public.js";
import {
	type DownloadDestination,
	DownloadError,
	type DownloadIntent,
} from "../domain/model.js";
import { workDirectory } from "../domain/paths.js";
import type { DownloadApplicationContext } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";

class ReservationConflict extends Error {
	constructor(
		readonly code: "claim_busy" | "transfer_busy" | "incompatible_transfer",
	) {
		super(code);
	}
}

export class DownloadPlanning {
	private readonly failures = new Map<
		string,
		{ attempts: number; next: number }
	>();
	constructor(
		private readonly context: DownloadApplicationContext,
		private readonly destination: DownloadDestinationSettings,
	) {}

	async run() {
		for (const subscription of this.context.options.selection.subscriptions()) {
			if (!subscription.feedId || !this.destination.authorized(subscription))
				continue;
			const throttle = this.failures.get(subscription.workKey);
			if (throttle && throttle.next > this.context.now()) continue;
			try {
				const target = await this.context.options.anime.target(
					subscription.workKey,
					this.context.signal,
				);
				this.plan(subscription, target);
				this.failures.delete(subscription.workKey);
				this.context.planningErrors.delete(subscription.workKey);
			} catch (error) {
				if (this.context.signal.aborted) return;
				this.context.planningErrors.set(
					subscription.workKey,
					"acquisition_unavailable",
				);
				const attempts = (throttle?.attempts ?? 0) + 1;
				this.failures.set(subscription.workKey, {
					attempts,
					next: this.context.now() + this.context.delay(attempts),
				});
				this.context.options.logger.warn(
					{
						event: "acquisition.reservation_failed",
						workKey: subscription.workKey,
						code: error instanceof DownloadError ? error.code : "unavailable",
					},
					"Could not reserve acquisition; download planning will retry.",
				);
			}
		}
	}

	private plan(subscription: Subscription, target: AcquisitionTarget) {
		const { options } = this.context;
		const { workKey, feedId, startEpisode } = subscription;
		if (!feedId) return;
		this.context.open();
		const current = options.selection.subscription(workKey);
		const destination = options.store.destination();
		if (
			!current ||
			current.revision !== subscription.revision ||
			!this.destination.authorized(current) ||
			!destination
		)
			return;

		const all = options.selection.candidates(workKey);
		const manifests = new Map(
			all.flatMap(({ selection }) => {
				const file = selection?.file;
				return file?.manifest ? [[file.hash, file.manifest] as const] : [];
			}),
		);
		const eligible = all.filter((candidate) => {
			const { episode } = candidate;
			const file = candidate.selection?.file;
			return (
				episode !== null &&
				episode >= startEpisode &&
				!target.availableEpisodes.includes(episode) &&
				!options.store.reservedEpisode(workKey, episode) &&
				!options.store.attemptedCandidate(
					workKey,
					candidate.id,
					file ? candidate.snapshotId : undefined,
				) &&
				(!file ||
					(candidate.snapshotId === target.work.snapshotId &&
						manifests.has(file.hash) &&
						!options.store.declinedFile(
							workKey,
							episode,
							file.hash,
							file.videoIndex,
						)))
			);
		});

		const deferred = new Set<number>();
		const rejected = new Set<string>();
		const coverage = all.some(
			({ selection }) => selection?.order !== undefined,
		);
		for (;;) {
			const remaining = eligible.filter(
				(candidate) =>
					!rejected.has(candidate.id) &&
					candidate.episode !== null &&
					!deferred.has(candidate.episode) &&
					!options.store.reservedEpisode(workKey, candidate.episode),
			);
			const next = coverage
				? coverageChoices(remaining, target, startEpisode, true)[0]
				: remaining
						.filter((candidate) => candidate.status === "selected")
						.slice(0, 1);
			const first = next?.[0];
			if (!next || !first) break;
			const entry = options.selection.release(feedId, first.entryId);
			const file = first.selection?.file;
			const source = entry?.download;
			const manifest = file && manifests.get(file.hash);
			if (
				!source ||
				(file &&
					(!manifest ||
						source !== file.reference ||
						!options.transport.isCurrent(source)))
			) {
				for (const candidate of next) rejected.add(candidate.id);
				continue;
			}

			const directory =
				options.store.directory(workKey) ??
				workDirectory(workKey, target.work.titles[0] ?? "Anime");
			const items = next.map((candidate) =>
				this.intent(
					subscription,
					candidate,
					target,
					destination,
					directory,
					source,
					file?.hash ?? entry.hash,
				),
			);
			let result: "planned" | ReservationConflict["code"];
			try {
				result = options.store.transaction(() => {
					options.store.saveDirectory(workKey, directory);
					for (const item of items) {
						if (!options.store.reserve(item))
							throw new ReservationConflict("claim_busy");
					}
					if (manifest) {
						const [leader, ...additional] = items.map((item, index) => {
							const file = next[index]?.selection?.file;
							if (!file) throw new Error("Missing manifest file decision.");
							return {
								item,
								expectedRevision: item.revision,
								plan: {
									manifest,
									videoIndex: file.videoIndex,
									subtitleIndices: file.subtitleIndices,
								},
							};
						});
						if (!leader) throw new Error("Missing selection owner.");
						const result = options.store.planFileSelection(
							leader.item,
							leader.plan,
							leader.expectedRevision,
							additional,
						);
						if (result !== "planned") {
							throw new ReservationConflict(
								result === "busy" ? "transfer_busy" : "incompatible_transfer",
							);
						}
					}
					for (const item of items)
						if (item.acceptedTarget)
							options.ingestion.retainTarget?.(item.acceptedTarget, item.id);
					return "planned";
				});
			} catch (error) {
				if (!(error instanceof ReservationConflict)) throw error;
				result = error.code;
			}
			if (result === "incompatible_transfer") {
				for (const candidate of next) rejected.add(candidate.id);
			} else if (result !== "claim_busy") {
				for (const item of items) deferred.add(item.episode);
			} else {
				// A competing claim can invalidate only one file from a larger release.
				const reserved = options.store.reservedEpisodes(workKey);
				if (!items.some(({ episode }) => reserved.has(episode)))
					for (const candidate of next) rejected.add(candidate.id);
			}
			options.logger.info(
				{
					event: "acquisition.coverage_reserved",
					workKey,
					intentIds: result === "planned" ? items.map(({ id }) => id) : [],
					transferId:
						result === "planned"
							? items[0] && options.store.intent(items[0].id)?.transferId
							: undefined,
					episodes: items.map(({ episode }) => episode),
					code: result === "planned" ? null : result,
				},
				"Evaluated download reservations under the subscription.",
			);
		}
	}

	private intent(
		subscription: Subscription,
		candidate: Candidate,
		target: AcquisitionTarget,
		destination: DownloadDestination,
		directory: string,
		source: string,
		expectedHash: string | null,
	): DownloadIntent {
		const { workKey } = subscription;
		const episode = candidate.episode;
		if (episode === null) throw new Error("Missing episode for reservation.");
		const now = this.context.now();
		const fileEpisodes = candidate.selection?.file?.episodes;
		return {
			acceptedTarget: {
				workKey,
				reference: target.work.reference,
				episode,
				...(fileEpisodes && fileEpisodes.length > 1 ? { fileEpisodes } : {}),
				snapshotId: target.work.snapshotId,
			},
			id: randomUUID(),
			revision: randomUUID(),
			workKey,
			candidateId: candidate.id,
			episode,
			title: candidate.title.slice(0, 1024),
			hash: `unresolved:${randomUUID()}`,
			expectedHash,
			source,
			destination,
			directory,
			origin: "subscription",
			oneOff: null,
			subscriptionRevision: subscription.revision,
			state: "pending",
			transfer: null,
			progress: null,
			ingestion: "not-ready",
			error: null,
			attempts: 0,
			nextAttemptAt: 0,
			observedAt: null,
			updatedAt: now,
			createdAt: now,
			sourceIdentity: null,
			lastCommand: null,
		};
	}
}
