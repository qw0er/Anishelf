import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";
import { type ReleaseEvidence, SourceError } from "../domain/model.js";
import type { JackettCapabilities, ReleaseDownload } from "./model.js";
import { indexerId } from "./validation.js";

const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const list = (value: unknown): unknown[] =>
	value === undefined ? [] : Array.isArray(value) ? value : [value];
function text(value: unknown): string {
	return typeof value === "string"
		? value.trim()
		: typeof object(value)["#text"] === "string"
			? String(object(value)["#text"]).trim()
			: "";
}
function number(value: unknown): number | null {
	const raw = text(value);
	if (!/^\d+$/.test(raw)) return null;
	const result = Number(raw);
	return Number.isSafeInteger(result) ? result : null;
}
export function document(xml: string): Record<string, unknown> {
	try {
		if (
			Buffer.byteLength(xml) > 5 * 1024 * 1024 ||
			/<!DOCTYPE|<!ENTITY/i.test(xml)
		)
			throw new Error();
		SyntaxValidator.validate(xml);
		const parsed = object(
			new XMLParser({
				ignoreAttributes: false,
				attributeNamePrefix: "@",
				removeNSPrefix: true,
				parseTagValue: false,
				parseAttributeValue: false,
				processEntities: true,
			}).parse(xml),
		);
		if (parsed.error) {
			const code = number(object(parsed.error)["@code"]) ?? 900;
			throw new SourceError(
				code >= 100 && code < 200
					? "authentication_failed"
					: code >= 200 && code < 300
						? "unsupported_capability"
						: code === 429
							? "rate_limited"
							: "upstream_failure",
				code === 429 ? Date.now() + 60000 : undefined,
			);
		}
		return parsed;
	} catch (error) {
		if (error instanceof SourceError) throw error;
		throw new SourceError("malformed_response");
	}
}
export function capabilities(xml: string): JackettCapabilities {
	const parsed = document(xml);
	if (!parsed.caps) throw new SourceError("malformed_response");
	const caps = object(parsed.caps),
		search = object(object(caps.searching).search),
		limits = object(caps.limits);
	const supported = text(search["@supportedParams"])
		.split(",")
		.map((s) => s.trim());
	const max = number(limits["@max"]) ?? 100;
	const preferred = number(limits["@default"]) ?? 100;
	if (max < 1 || preferred < 1) throw new SourceError("malformed_response");
	return {
		search: text(search["@available"]) === "yes" && supported.includes("q"),
		limit: Math.min(max, preferred, 100),
	};
}
export function indexers(xml: string): { id: string; name: string }[] {
	const parsed = document(xml);
	if (!("indexers" in parsed)) throw new SourceError("malformed_response");
	const items = list(object(parsed.indexers).indexer);
	if (items.length > 1000) throw new SourceError("item_limit");
	return items
		.map(object)
		.filter(
			(item) =>
				text(item["@configured"]) === "true" && text(item["@id"]) !== "all",
		)
		.map((item) => ({
			id: indexerId(text(item["@id"])),
			name: text(item.title).slice(0, 256),
		}));
}
const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");
export function releases(
	xml: string,
	source: { id: string; generation: string },
	download: (url: string) => ReleaseDownload | null,
) {
	const root = object(document(xml).rss),
		channel = object(root.channel);
	if (
		text(root["@version"]) !== "2.0" ||
		!("channel" in root) ||
		Array.isArray(root.channel)
	)
		throw new SourceError("malformed_response");
	const items = list(channel.item);
	if (items.length > 1000) throw new SourceError("item_limit");
	const entries = items.map((item): ReleaseEvidence => {
		const row = object(item),
			title = text(row.title),
			guid = text(row.guid);
		if (!title || title.length > 4096 || guid.length > 8192)
			throw new SourceError("malformed_response");
		const attrs = new Map(
			list(row.attr)
				.map(object)
				.map((attr) => [
					text(attr["@name"]).toLowerCase(),
					text(attr["@value"]),
				]),
		);
		const enclosure = list(row.enclosure)
			.map(object)
			.find((entry) => text(entry["@type"]) === "application/x-bittorrent");
		const locator = enclosure
			? text(enclosure["@url"])
			: (attrs.get("magneturl") ?? "");
		const descriptor = locator ? download(locator) : null;
		let hash = attrs.get("infohash")?.toLowerCase() ?? null;
		if (hash && !/^[a-f0-9]{40}$/.test(hash)) hash = null;
		if (!hash && descriptor?.kind === "magnet")
			hash =
				new URL(descriptor.uri).searchParams
					.getAll("xt")
					.map((xt) =>
						/^urn:btih:([a-f0-9]{40})$/i.exec(xt)?.[1]?.toLowerCase(),
					)
					.find(Boolean) ?? null;
		const identity =
			hash || guid || (descriptor ? JSON.stringify(descriptor) : title);
		const id = digest(`${source.generation}:${source.id}:${identity || title}`);
		const published = Date.parse(text(row.pubDate));
		return {
			id,
			observationId: digest(
				`${id}:${title}:${published}:${JSON.stringify(descriptor)}`,
			),
			title,
			guid,
			sourceId: source.id,
			generation: source.generation,
			publishedAt: Number.isFinite(published) ? published : null,
			size: number(attrs.get("size") ?? row.size ?? enclosure?.["@length"]),
			seeders: number(attrs.get("seeders")),
			peers: number(attrs.get("peers")),
			hash,
			downloadUrl: null,
			download: descriptor,
		};
	});
	const response = object(channel.response);
	return {
		entries,
		count: items.length,
		offset: number(response["@offset"]),
		total: number(response["@total"]),
	};
}
