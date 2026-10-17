import { posix } from "node:path";
import { DomainError } from "../../../../shared/errors.js";
import type { SourceIdentity } from "../../../resources/public.js";
import { proposeMapping } from "../domain/mapping.js";
import { rankCandidates } from "../domain/matching.js";
import type {
	ExtractionEvidence,
	IdentificationResult,
	WorkCandidate,
} from "../domain/model.js";
import { applyNumberingContext } from "../domain/numbering-context.js";
import { identificationPolicy as policy } from "../policy.js";
import type { IdentificationMetadata, IdentificationParser } from "../ports.js";
import type { IdentificationApi } from "../public.js";

/** Stateless recognition: no HTTP, filesystem access, jobs or durable decisions. */
export class IdentificationApplication implements IdentificationApi {
	readonly version: string;
	constructor(
		private readonly options: {
			parser: IdentificationParser;
			metadata?: IdentificationMetadata;
		},
	) {
		this.version = `${options.parser.version}:${policy.matcherVersion}:metadata-${options.metadata ? "enabled" : "reserved"}`;
	}
	async identify(
		sources: readonly SourceIdentity[],
		signal: AbortSignal = new AbortController().signal,
	): Promise<IdentificationResult[]> {
		signal.throwIfAborted();
		if (sources.length > policy.maximumFiles)
			throw new DomainError(
				"INVALID_REQUEST",
				"Identification batches contain at most 500 sources.",
			);
		const identities = sources.map((source) => ({ ...source }));
		const seen = new Set<string>();
		const groups = new Map<string, SourceIdentity[]>();
		for (const source of identities) {
			if (
				!source.fileId ||
				!source.sourceVersion ||
				!source.relativePath ||
				source.relativePath.includes("\0") ||
				source.relativePath.includes("\\") ||
				posix.isAbsolute(source.relativePath) ||
				source.relativePath
					.split("/")
					.some((part) => part === ".." || part === "." || part === "")
			)
				throw new DomainError(
					"INVALID_REQUEST",
					"Supply validated root-relative source identities.",
				);
			const key = JSON.stringify([source.scopeId, source.fileId]);
			if (seen.has(key))
				throw new DomainError(
					"INVALID_REQUEST",
					"Duplicate source identity in identification batch.",
				);
			seen.add(key);
			const directory = JSON.stringify([
				source.scopeId,
				posix.dirname(source.relativePath),
			]);
			const group = groups.get(directory) ?? [];
			group.push(source);
			groups.set(directory, group);
		}
		const extractions = new Map<SourceIdentity, ExtractionEvidence>();
		for (const group of groups.values()) {
			group.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
			for (
				let offset = 0;
				offset < group.length;
				offset += policy.parserGroupSize
			) {
				signal.throwIfAborted();
				const chunk = group.slice(offset, offset + policy.parserGroupSize);
				const evidence = this.options.parser.extract(
					chunk.map((source) => source.relativePath),
				);
				if (evidence.length !== chunk.length)
					throw new Error("Parser returned an incomplete batch.");
				for (const [index, source] of chunk.entries()) {
					const extracted = evidence[index];
					if (!extracted) throw new Error("Parser omitted a source.");
					extractions.set(source, extracted);
				}
			}
		}
		const queries = new Map<string, Promise<WorkCandidate[]>>();
		const results: IdentificationResult[] = [];
		for (const source of identities) {
			signal.throwIfAborted();
			const evidence = extractions.get(source);
			if (!evidence) throw new Error("Missing source extraction.");
			const result: IdentificationResult = {
				source,
				evidence,
				status: "parsed",
				metadataStatus: "not-configured",
				proposals: [],
				unresolved: [],
			};
			if (!evidence.titles.length)
				result.unresolved.push("No work title was extracted.");
			if (evidence.numbering === "ambiguous")
				result.unresolved.push(
					"Multiple numbering systems require disambiguation.",
				);
			if (evidence.numbering === "unknown")
				result.unresolved.push(
					"Episode numbering is unknown; a movie may use a whole-work slot.",
				);
			if (evidence.rawEpisodes.some((token) => !/^\d+$/.test(token)))
				result.unresolved.push(
					"Non-integer identifiers require explicit numbering evidence.",
				);
			if (
				evidence.contentKind === "special" ||
				evidence.contentKind === "ancillary"
			)
				result.unresolved.push(
					"Special or ancillary resource identity requires additional evidence.",
				);
			const metadata = this.options.metadata;
			if (metadata) {
				const works: WorkCandidate[] = [];
				let failed = false;
				const searchTitles = [...evidence.titles];
				if (evidence.seasons.length === 1 && Number(evidence.seasons[0]) > 1) {
					const title = evidence.titles[0];
					if (title)
						searchTitles.splice(
							1,
							0,
							`${title} Season ${Number(evidence.seasons[0])}`,
						);
				}
				if (evidence.parts.length === 1 && evidence.titles[0])
					searchTitles.splice(
						2,
						0,
						`${evidence.titles[0]} Part ${Number(evidence.parts[0])}`,
					);
				for (const title of [...new Set(searchTitles)].slice(
					0,
					policy.maximumQueries,
				)) {
					signal.throwIfAborted();
					let query = queries.get(title);
					if (!query) {
						if (queries.size >= policy.maximumBatchQueries) {
							failed = true;
							result.unresolved.push(
								"Metadata query budget exhausted; identification can be retried by its caller.",
							);
							break;
						}
						query = this.search(metadata, title, signal);
						queries.set(title, query);
					}
					try {
						works.push(...(await query));
					} catch {
						signal.throwIfAborted();
						failed = true;
						result.unresolved.push(
							"Metadata search failed; local extraction remains available.",
						);
					}
				}
				result.metadataStatus = failed ? "failed" : "searched";
				result.proposals = rankCandidates(evidence, works).map((candidate) => ({
					candidate,
					mapping: proposeMapping(evidence, candidate.work),
				}));
				result.status = result.proposals.length ? "proposed" : "unresolved";
				if (!result.proposals.length)
					result.unresolved.push("No metadata candidate is available.");
			}
			signal.throwIfAborted();
			results.push(result);
		}
		applyNumberingContext(results);
		signal.throwIfAborted();
		return results;
	}
	private async search(
		metadata: IdentificationMetadata,
		title: string,
		parent: AbortSignal,
	): Promise<WorkCandidate[]> {
		const signal = AbortSignal.any([
			parent,
			AbortSignal.timeout(policy.metadataTimeoutMs),
		]);
		let abort = () => {};
		const cancelled = new Promise<never>((_resolve, reject) => {
			abort = () => reject(signal.reason);
			signal.addEventListener("abort", abort, { once: true });
		});
		try {
			signal.throwIfAborted();
			return await Promise.race([metadata.search(title, signal), cancelled]);
		} finally {
			signal.removeEventListener("abort", abort);
		}
	}
}
