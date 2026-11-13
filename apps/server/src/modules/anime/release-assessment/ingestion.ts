import { createHash } from "node:crypto";
import { basename } from "node:path";
import { DomainError } from "../../../shared/errors.js";
import { workReference } from "../../../shared/external-reference.js";
import type {
	ResourceAccessApi,
	SourceIdentity,
} from "../../resources/public.js";
import type {
	AnimeCatalogApi,
	CatalogMetadata,
} from "../anime-catalog/public.js";
import type { MetadataIdentitiesApi } from "../external-works/metadata/public.js";
import type { ExtractionEvidence } from "../identification/public.js";
import { matchingTitle } from "../identification/public.js";
import type {
	AcceptedAcquisitionTarget,
	AcquisitionProvenance,
} from "../public.js";
import type { ReleaseParser } from "./public.js";

export class AcquisitionIngestion {
	constructor(
		private readonly metadata: CatalogMetadata,
		private readonly identities: MetadataIdentitiesApi,
		private readonly parser: ReleaseParser,
		private readonly catalog: AnimeCatalogApi,
		private readonly sources: ResourceAccessApi,
	) {}
	async captureTarget(
		key: string,
		episode: number,
		signal: AbortSignal,
	): Promise<AcceptedAcquisitionTarget> {
		const reference = this.identities.referenceForExternal(workReference(key));
		const metadata =
			this.metadata.current(reference) ??
			(await this.metadata.get(reference, { signal }));
		if (!Number.isSafeInteger(episode) || episode < 1 || episode > 10000)
			throw new DomainError(
				"INVALID_REQUEST",
				"Invalid accepted acquisition episode.",
			);
		return {
			workKey: key,
			reference: metadata.data.reference,
			episode,
			snapshotId: metadata.snapshotId,
		};
	}
	retainTarget(target: AcceptedAcquisitionTarget, intentId: string) {
		const metadata = this.metadata.snapshot(target.snapshotId);
		if (
			metadata.kind !== "detail" ||
			metadata.data.reference.id !== target.reference.id
		)
			throw new DomainError(
				"ACQUISITION_CONFLICT",
				"Accepted target metadata is unavailable.",
			);
		this.metadata.retain(target.snapshotId, `acquisition-target:${intentId}`);
	}
	releaseTarget(target: AcceptedAcquisitionTarget, intentId: string) {
		this.metadata.release(target.snapshotId, `acquisition-target:${intentId}`);
	}
	async recoverableReview(identity: SourceIdentity) {
		const review = (await this.catalog.fileReviews([identity.fileId]))[0];
		return (
			!!review &&
			review.sourceVersion === identity.sourceVersion &&
			review.decision === "pending" &&
			review.decisionOrigin !== "manual" &&
			!review.associations.length &&
			review.unresolved.includes("download_target_conflict")
		);
	}
	async ingest(
		key: string,
		episode: number,
		identity: SourceIdentity,
		signal: AbortSignal,
		provenance?: AcquisitionProvenance,
	): Promise<"available" | "review"> {
		const target =
			provenance?.target ?? (await this.captureTarget(key, episode, signal));
		if (target.workKey !== key || target.episode !== episode)
			throw new DomainError(
				"ACQUISITION_CONFLICT",
				"Accepted download target changed.",
			);
		const current = await this.sources.resolveSource(
			identity.fileId,
			identity.sourceVersion,
		);
		if (
			current.identity.scopeId !== identity.scopeId ||
			current.identity.relativePath !== identity.relativePath
		)
			throw new DomainError(
				"ACQUISITION_CONFLICT",
				"The downloaded source changed.",
			);
		let evidence: ExtractionEvidence;
		try {
			evidence = this.parser.extractRelease(basename(identity.relativePath));
		} catch {
			evidence = {
				parser: "acquisition",
				parserVersion: "1",
				normalizationVersion: "1",
				contextFingerprint: "accepted-target",
				originalName: basename(identity.relativePath),
				relativePath: identity.relativePath,
				inputs: [],
				titles: [],
				years: [],
				seasons: [],
				parts: [],
				rawEpisodes: [],
				numbering: "unknown",
				contentKind: "unknown",
			};
		}
		evidence.relativePath = identity.relativePath;
		const metadata = this.metadata.snapshot(target.snapshotId);
		const titleMatches =
			metadata.kind === "detail" &&
			evidence.titles.some((title) =>
				metadata.data.titles.some((alias) =>
					matchingTitle(title, alias.value, evidence.seasons, evidence.parts),
				),
			);
		const warnings = [
			...new Set([
				...(provenance?.warnings ?? []),
				...(evidence.numbering !== "single" ||
				evidence.rawEpisodes.length !== 1 ||
				!/^\d+$/.test(evidence.rawEpisodes[0] ?? "") ||
				Number(evidence.rawEpisodes[0]) !== episode ||
				!titleMatches
					? ["filename_target_unconfirmed"]
					: []),
			]),
		];
		const receipt: AcquisitionProvenance = provenance
			? { ...provenance, warnings }
			: {
					intentId: createHash("sha256")
						.update(JSON.stringify([identity, key, episode]))
						.digest("hex"),
					candidateId: "legacy",
					title: "",
					hash: "",
					transfer: null,
					target,
					warnings,
				};
		return this.catalog.associateAcquisition(
			{
				source: identity,
				evidence,
				status: "unresolved",
				metadataStatus: "not-configured",
				proposals: [],
				unresolved: [],
			},
			receipt,
			signal,
		);
	}
}
