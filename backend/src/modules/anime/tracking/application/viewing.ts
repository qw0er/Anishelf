import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { AnimeCatalogApi } from "../../anime-catalog/public.js";
import type { MetadataAssociations } from "../../metadata/public.js";
import type {
	TrackingEpisodeTarget,
	TrackingOperation,
	TrackingRemoteState,
} from "../domain/operation.js";
import type { TrackingTargetResolver } from "../ports.js";
import type {
	TrackingApi,
	TrackingEpisodeCommand,
	TrackingEpisodeResolution,
	TrackingObservationOutcome,
} from "../public.js";
import { ExactTrackingTargets } from "./targets.js";

interface ObservationContext extends TrackingEpisodeTarget {
	version: 2;
	accountId: string;
	generation: string;
	manualVersion: number;
}

/** Resolves targets; every manual edit and automatic observation enters TrackingUpdates. */
export class TrackingViewingCommands {
	constructor(
		private readonly catalog: Pick<AnimeCatalogApi, "fileReviews">,
		private readonly tracking: Pick<
			TrackingApi,
			| "status"
			| "list"
			| "operations"
			| "update"
			| "manualVersion"
			| "replayCommand"
		>,
		private readonly resolver: TrackingTargetResolver = new ExactTrackingTargets(),
		private readonly logger?: Logger,
		private readonly associations?: MetadataAssociations,
	) {}
	async resolveTarget(
		fileId: string,
		sourceVersion: string,
	): Promise<TrackingEpisodeResolution> {
		const account = this.tracking.status();
		if (!account.account || account.state !== "connected")
			return { state: "unavailable", target: null };
		const [review] = await this.catalog.fileReviews([fileId]);
		let state: "unmapped" | "ambiguous" | "unsupported" = "unmapped";
		let target: TrackingEpisodeTarget | null = null;
		if (
			review?.available &&
			review.decision === "confirmed" &&
			review.sourceVersion === sourceVersion
		) {
			if (review.associations.length > 1) state = "ambiguous";
			else {
				const association = review.associations[0];
				if (association?.reference) {
					if (
						!["regular", "movie"].includes(association.kind) ||
						!/^[1-9][0-9]*$/.test(association.number) ||
						(association.kind === "movie" && association.number !== "1")
					)
						state = "unsupported";
					else {
						const reference = this.associations?.externalReference(
							association.reference,
							account.provider.key,
						);
						const result = reference
							? this.resolver.resolve(
									reference,
									Number(association.number),
									account.provider,
								)
							: { state: "unmapped" as const };
						if (result.state === "resolved")
							target = {
								fileId,
								sourceVersion,
								reviewId: review.id,
								mappingRevision: review.revision,
								episodeId: association.episodeId,
								mediaId: result.mediaId,
								episode: result.episode,
							};
						else state = result.state;
					}
				}
			}
		}
		if (this.tracking.status().generation !== account.generation)
			return { state: "unavailable", target: null };
		this.logger?.debug(
			{
				event: "tracking.target_resolved",
				provider: account.provider.key,
				fileId,
				state: target ? "resolved" : state,
			},
			"Tracking episode target resolved.",
		);
		return target ? { state: "resolved", target } : { state, target: null };
	}
	async target(
		fileId: string,
		sourceVersion: string,
	): Promise<TrackingEpisodeTarget | null> {
		return (await this.resolveTarget(fileId, sourceVersion)).target;
	}

	async capture(fileId: string, sourceVersion: string): Promise<string | null> {
		const account = this.tracking.status();
		const target = await this.target(fileId, sourceVersion);
		if (
			!target ||
			!account.account ||
			account.generation !== this.tracking.status().generation
		)
			return null;
		return JSON.stringify({
			...target,
			version: 2,
			accountId: account.account.id,
			generation: account.generation,
			manualVersion: this.tracking.manualVersion(
				target.mediaId,
				account.generation,
			),
		} satisfies ObservationContext);
	}
	private values(mediaId: string, generation: string) {
		const list = this.tracking.list(generation);
		if (list.fetchedAt === null)
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"Load Tracking viewing state before updating progress.",
			);
		const operation = this.tracking
			.operations(generation)
			.find((op) => op.mediaId === mediaId);
		const cached =
			list.entries.find((entry) => entry.mediaId === mediaId) ?? null;
		const value =
			operation && operation.updatedAt > list.fetchedAt
				? operation.remote
				: cached;
		const remote: TrackingRemoteState | null = value
			? {
					id: value.id,
					progress: value.progress,
					status: value.status,
					updatedAt: value.updatedAt,
				}
			: null;
		return { operation, remote };
	}
	private decision(
		target: TrackingEpisodeTarget,
		remote: { progress: number } | null,
		confirmSkipped: boolean,
		initialStatus: TrackingEpisodeCommand["initialStatus"],
	) {
		if (!remote && !initialStatus) return "initial-status-required" as const;
		if (target.episode > (remote?.progress ?? 0) + 1 && !confirmSkipped)
			return "skipped-episodes" as const;
		return undefined;
	}
	async mark(input: TrackingEpisodeCommand): Promise<TrackingOperation> {
		const replay = this.tracking.replayCommand(
			input.commandId,
			input.generation,
		);
		if (replay) return replay;
		const target = await this.target(input.fileId, input.sourceVersion);
		const concurrentReplay = this.tracking.replayCommand(
			input.commandId,
			input.generation,
		);
		if (concurrentReplay) return concurrentReplay;
		if (
			!target ||
			target.mappingRevision !== input.mappingRevision ||
			this.tracking.status().generation !== input.generation
		)
			throw new DomainError(
				"TRACKING_CONFLICT",
				"Account or episode mapping changed; reload before editing.",
			);
		const { operation, remote } = this.values(target.mediaId, input.generation);
		if ((operation?.revision ?? null) !== input.revision)
			throw new DomainError(
				"TRACKING_CONFLICT",
				"Viewing operation changed; reload before editing.",
			);
		if (
			operation?.state === "decision-required" &&
			operation.target &&
			JSON.stringify(operation.target) !== JSON.stringify(target)
		)
			throw new DomainError(
				"TRACKING_CONFLICT",
				"Episode mapping changed; reload before confirming.",
			);
		if (input.action === "keep" && operation?.state !== "decision-required")
			throw new DomainError(
				"TRACKING_CONFLICT",
				"No pending viewing decision.",
			);
		const decisionReason =
			input.action === "keep"
				? undefined
				: this.decision(
						target,
						remote,
						input.confirmSkipped ?? false,
						input.initialStatus,
					);
		return this.tracking.update(target.mediaId, {
			commandId: input.commandId,
			generation: input.generation,
			revision: input.revision,
			origin: "manual-player",
			target,
			baseline: remote,
			desired: {
				progress: Math.max(remote?.progress ?? 0, target.episode),
				...(!remote && input.initialStatus
					? { status: input.initialStatus }
					: {}),
			},
			...(decisionReason ? { decisionReason } : {}),
			...(input.action === "keep" ? { cancelled: true } : {}),
		});
	}
	async submit(
		context: string,
		observationId: string,
	): Promise<TrackingObservationOutcome> {
		const captured: ObservationContext = JSON.parse(context);
		if (captured.version !== 2)
			return { state: "ignored", reason: "unsupported-observation-version" };
		const account = this.tracking.status();
		if (account.account?.id !== captured.accountId)
			return { state: "ignored", reason: "account-changed" };
		if (account.state !== "connected")
			return { state: "unavailable", reason: "reconnect-required" };
		const target = await this.target(captured.fileId, captured.sourceVersion);
		if (
			!target ||
			JSON.stringify(target) !==
				JSON.stringify({
					fileId: captured.fileId,
					sourceVersion: captured.sourceVersion,
					reviewId: captured.reviewId,
					mappingRevision: captured.mappingRevision,
					episodeId: captured.episodeId,
					mediaId: captured.mediaId,
					episode: captured.episode,
				})
		)
			return { state: "ignored", reason: "mapping-changed" };
		if (this.tracking.status().generation !== account.generation)
			return { state: "unavailable", reason: "account-changing" };
		if (
			this.tracking.manualVersion(target.mediaId, account.generation) !==
			captured.manualVersion
		)
			return { state: "ignored", reason: "manual-change" };
		const { operation, remote } = this.values(
			target.mediaId,
			account.generation,
		);
		if ((remote?.progress ?? 0) >= target.episode)
			return { state: "ignored", reason: "already-tracked" };
		if (
			operation?.origin === "automatic" &&
			!["succeeded", "cancelled"].includes(operation.state) &&
			(operation.desired.progress ?? 0) >= target.episode
		)
			return {
				state: "accepted",
				reason: "existing-operation",
				operationId: operation.id,
				revision: operation.revision,
			};
		if (operation && !["succeeded", "cancelled"].includes(operation.state))
			return { state: "unavailable", reason: "pending-change" };
		const decisionReason = this.decision(target, remote, false, undefined);
		const admitted = this.tracking.update(target.mediaId, {
			commandId: observationId,
			generation: account.generation,
			revision: operation?.revision ?? null,
			origin: "automatic",
			target,
			baseline: remote,
			desired: { progress: target.episode },
			...(decisionReason ? { decisionReason } : {}),
		});
		return {
			state: "accepted",
			reason: "operation-recorded",
			operationId: admitted.id,
			revision: admitted.revision,
		};
	}
}
