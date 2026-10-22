import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";
import { discoveryPolicy as policy } from "../application/policy.js";
import { type FeedEntry, RssError } from "../domain/model.js";

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function text(value: unknown): string {
	return typeof value === "string"
		? value.trim()
		: typeof object(value)["#text"] === "string"
			? String(object(value)["#text"]).trim()
			: "";
}
function list(value: unknown): unknown[] {
	return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function hashFromMagnet(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "magnet:") return null;
		for (const xt of url.searchParams.getAll("xt")) {
			const match = /^urn:btih:([a-f0-9]{40})$/i.exec(xt);
			if (match?.[1]) return match[1].toLowerCase();
		}
	} catch {
		/* Unsupported links remain unavailable. */
	}
	return null;
}
function download(value: string): string | null {
	if (!value || value.length > 8192 || /[\r\n\0]/.test(value)) return null;
	try {
		const url = new URL(value);
		return ["http:", "https:", "magnet:"].includes(url.protocol) &&
			!url.username &&
			!url.password
			? url.href
			: null;
	} catch {
		return null;
	}
}
export function parseRss(xml: string): FeedEntry[] {
	try {
		if (
			Buffer.byteLength(xml) > policy.maximumBodyBytes ||
			/<!DOCTYPE|<!ENTITY/i.test(xml)
		)
			throw new RssError("invalid_xml");
		SyntaxValidator.validate(xml);
		const parsed: unknown = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: "@",
			parseTagValue: false,
			parseAttributeValue: false,
			maxNestedTags: 32,
			processEntities: true,
		}).parse(xml);
		const rss = object(object(parsed).rss);
		if (rss["@version"] !== "2.0" || !rss.channel || Array.isArray(rss.channel))
			throw new RssError("unsupported_feed");
		const items = list(object(rss.channel).item);
		if (items.length > policy.maximumItems)
			throw new RssError("feed_too_large");
		const result = new Map<string, FeedEntry>();
		for (const value of items) {
			const item = object(value),
				title = text(item.title);
			if (!title || title.length > 4096) throw new RssError("invalid_item");
			const enclosures = list(item.enclosure).map(object);
			const enclosure = enclosures.find(
				(entry) =>
					text(entry["@type"]).toLowerCase() === "application/x-bittorrent" ||
					/\.torrent(?:[?#]|$)/i.test(text(entry["@url"])),
			);
			const attrs = list(item["torznab:attr"]).map(object);
			const magnet =
				text(item["nyaa:magnetUri"]) ||
				text(item["torrent:magnetURI"]) ||
				text(
					attrs.find((entry) => entry["@name"] === "magneturl")?.["@value"],
				) ||
				(text(item.link).startsWith("magnet:") ? text(item.link) : "");
			const downloadUrl =
				download(magnet) ?? download(text(enclosure?.["@url"]));
			const hashClaim =
				text(item["nyaa:infoHash"]) ||
				text(attrs.find((entry) => entry["@name"] === "infohash")?.["@value"]);
			const hash =
				hashFromMagnet(downloadUrl ?? "") ??
				(/^[a-f0-9]{40}$/i.test(hashClaim) ? hashClaim.toLowerCase() : null);
			const guid = text(item.guid),
				link = text(item.link);
			if (guid.length > 8192 || link.length > 8192)
				throw new RssError("invalid_item");
			const identity = hash
				? `hash:${hash}`
				: downloadUrl
					? `download:${downloadUrl}`
					: `entry:${guid || link || title}`;
			const nestedTorrent = object(item.torrent);
			const published = Date.parse(
				text(item.pubDate) || text(nestedTorrent.pubDate),
			);
			const seedersText =
				text(item["nyaa:seeders"]) ||
				text(attrs.find((attr) => attr["@name"] === "seeders")?.["@value"]);
			const seeders =
				/^\d+$/u.test(seedersText) &&
				Number.isSafeInteger(Number(seedersText)) &&
				Number(seedersText) <= 2147483647
					? Number(seedersText)
					: null;
			const entry = {
				id: digest(identity),
				seeders,
				observationId: digest(guid || link || identity),
				title,
				publishedAt: Number.isFinite(published) ? published : null,
				downloadUrl,
				hash,
			};
			result.set(entry.id, entry);
		}
		return [...result.values()];
	} catch (error) {
		if (error instanceof RssError) throw error;
		throw new RssError("invalid_xml");
	}
}
