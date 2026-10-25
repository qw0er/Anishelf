import {
	BangumiError,
	type BangumiMetadataApi,
	type BangumiSubject,
} from "../../bangumi/public.js";
import {
	MetadataError,
	type ProviderReference,
	type WorkDetails,
	type WorkSummary,
} from "../domain/source-model.js";
import type { MetadataProvider } from "../ports.js";

function summary(raw: BangumiSubject): WorkSummary {
	const titles: WorkSummary["titles"] = [];
	if (raw.name.trim())
		titles.push({ value: raw.name.trim(), language: null, kind: "native" });
	if (raw.name_cn.trim())
		titles.push({
			value: raw.name_cn.trim(),
			language: "zh-Hans",
			kind: "alias",
		});
	const year = /^(\d{4})-\d{2}-\d{2}$/.exec(raw.date ?? "");
	return {
		reference: { provider: "bangumi", mediaType: "anime", id: String(raw.id) },
		titles,
		year: year ? Number(year[1]) : null,
		format:
			(
				{
					TV: "TV",
					OVA: "OVA",
					OAD: "OVA",
					WEB: "ONA",
					Web: "ONA",
					剧场版: "MOVIE",
				} as Record<string, string>
			)[raw.platform] ?? null,
		// Neither the premiere date nor the episode database count proves airing progress.
		status: null,
		episodeCount: raw.eps > 0 ? raw.eps : null,
		nextAiringEpisode: null,
		airingSeason: null,
		coverUrl: raw.images?.large || raw.images?.common || null,
		unavailableFields: ["status", "nextAiringEpisode", "airingSeason"],
	};
}
export class BangumiProvider implements MetadataProvider {
	readonly capabilities = {
		key: "bangumi",
		version: "bangumi-v0-v1",
		search: true,
		details: true,
		relations: false,
		airing: false,
		streamingLinks: false,
		canonicalEpisodes: false,
	} as const;
	constructor(private readonly client: BangumiMetadataApi) {}
	resolveReference(value: string): ProviderReference | null {
		let id = value;
		if (!/^[1-9]\d*$/.test(id)) {
			try {
				const url = new URL(value);
				if (
					url.protocol !== "https:" ||
					!["bgm.tv", "bangumi.tv", "chii.in"].includes(url.hostname) ||
					url.port ||
					url.username ||
					url.password
				)
					return null;
				id = /^\/subject\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1] ?? "";
			} catch {
				return null;
			}
		}
		return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
			? { provider: "bangumi", mediaType: "anime", id }
			: null;
	}
	private async read<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (cause) {
			if (cause instanceof BangumiError)
				throw new MetadataError(cause.failure, { cause });
			throw cause;
		}
	}
	async search(
		query: string,
		page: number,
		perPage: number,
		signal: AbortSignal,
	) {
		const result = await this.read(() =>
			this.client.search(query, page, perPage, signal),
		);
		return { data: { ...result, items: result.items.map(summary) } };
	}
	async get(reference: ProviderReference, signal: AbortSignal) {
		const resolved = this.resolveReference(reference.id);
		if (
			reference.provider !== "bangumi" ||
			reference.mediaType !== "anime" ||
			!resolved ||
			resolved.id !== reference.id
		)
			throw new MetadataError({
				code: "invalid-request",
				message: "Supply a valid Bangumi anime reference.",
				retryAt: null,
			});
		const raw = await this.read(() =>
			this.client.get(Number(reference.id), signal),
		);
		const base = summary(raw);
		const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.date ?? "");
		const data: WorkDetails = {
			...base,
			description: raw.summary || null,
			startDate: parts
				? {
						year: Number(parts[1]),
						month: Number(parts[2]),
						day: Number(parts[3]),
					}
				: null,
			bannerUrl: null,
			endDate: null,
			durationMinutes: null,
			country: null,
			source: null,
			genres: [],
			tags: raw.tags.map((tag) => ({
				name: tag.name,
				rank: null,
				spoiler: false,
			})),
			studios: [],
			averageScore:
				raw.rating.score > 0 ? Math.round(raw.rating.score * 10) : null,
			streamingEpisodes: [],
			episodeCatalog: "unavailable",
			siteUrl: `https://bgm.tv/subject/${raw.id}`,
			providerUpdatedAt: null,
			unavailableFields: [
				...base.unavailableFields,
				"bannerUrl",
				"endDate",
				"durationMinutes",
				"country",
				"source",
				"genres",
				"studios",
				"streamingEpisodes",
				"episodeCatalog",
			],
		};
		return { data };
	}
	relations(): never {
		throw this.unsupported();
	}
	airing(): never {
		throw this.unsupported();
	}
	private unsupported() {
		return new MetadataError({
			code: "invalid-request",
			message: "This metadata source capability is unavailable.",
			retryAt: null,
		});
	}
}
