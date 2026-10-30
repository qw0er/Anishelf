import { MockAgent } from "undici";
import { expect, test, vi } from "vitest";
import { parseRss } from "../../../../src/modules/acquisition/sources/rss/parser.js";
import {
	isPublicAddress,
	RssTransport,
	rssUrl,
} from "../../../../src/modules/acquisition/sources/rss/transport.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import {
	assessor,
	cleanup,
	feed,
	hash,
	item,
	setupTestLifecycle,
	target,
} from "./support/rss-fixture.js";

vi.mock("node:fs/promises", async () => {
	const { memoryFs } = await import("../../../support/memory-filesystem.js");
	return memoryFs.promises;
});

setupTestLifecycle();

test("RSS parser extracts torrent enclosures, CDATA and known hash extensions without confusing page links", () => {
	const xml = `<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa"><channel><item><title><![CDATA[[G] Frieren - 03 [A&B]]]></title><link>https://example.org/view/1</link><guid>1</guid><nyaa:infoHash>${hash}</nyaa:infoHash><enclosure url="https://example.org/a.torrent?x=1&amp;y=2" type="application/x-bittorrent" length="100"/></item></channel></rss>`;
	const entries = parseRss(xml);
	expect(entries[0]).toMatchObject({
		title: "[G] Frieren - 03 [A&B]",
		hash,
		downloadUrl: "https://example.org/a.torrent?x=1&y=2",
	});
	expect(
		parseRss(
			`<rss version="2.0"><channel><item><title>Frieren - 03</title><link>https://example.org/view/1</link></item></channel></rss>`,
		)[0]?.downloadUrl,
	).toBeNull();
	expect(parseRss(feed(item() + item()))).toHaveLength(1);
});

test("rejects declarations, malformed feeds, unsupported formats and oversized item batches", () => {
	for (const xml of [
		"<rss>",
		"<feed/>",
		`<!DOCTYPE rss [<!ENTITY x SYSTEM 'file:///etc/passwd'>]>${feed()}`,
		feed("<item><title></title></item>"),
	])
		expect(() => parseRss(xml)).toThrow();
	expect(() =>
		parseRss(
			feed(
				Array.from({ length: 1001 }, (_, index) =>
					item("Frieren - 03", String(index)),
				).join(""),
			),
		),
	).toThrow();
});

test("public destination validation rejects loopback, private, mapped and alternate IP spellings", () => {
	for (const url of [
		"file:///etc/passwd",
		"http://127.0.0.1/rss",
		"http://2130706433/rss",
		"http://[::1]/",
		"http://[::ffff:127.0.0.1]/",
		"http://192.168.1.2/rss",
		"http://169.254.169.254/",
		"http://localhost/rss",
		"https://u:p@example.org/rss",
		"https://example.org/rss#token",
	])
		expect(() => rssUrl(url)).toThrow();
	for (const address of [
		"10.1.2.3",
		"172.16.2.3",
		"::1",
		"fd00::1",
		"::ffff:127.0.0.1",
	])
		expect(isPublicAddress(address)).toBe(false);
	expect(isPublicAddress("8.8.8.8")).toBe(true);
	expect(rssUrl("https://feeds.example.org/rss?passkey=private")).toContain(
		"passkey=private",
	);
});

test("actual RSS transport handles conditional responses and rejects private redirects and excess bytes", async () => {
	const agent = new MockAgent();
	agent.disableNetConnect();
	const pool = agent.get("https://feeds.example.org");
	const transport = new RssTransport(agent);
	cleanup.push(() => transport.close());
	pool
		.intercept({ path: "/rss", headers: { "if-none-match": "etag-1" } })
		.reply(304, "");
	expect(
		(
			await transport.fetch(
				"https://feeds.example.org/rss",
				{ etag: "etag-1", lastModified: null },
				new AbortController().signal,
			)
		).xml,
	).toBeNull();
	pool
		.intercept({ path: "/redirect" })
		.reply(302, "", { headers: { location: "http://127.0.0.1/private" } });
	await expect(
		transport.fetch(
			"https://feeds.example.org/redirect",
			{ etag: null, lastModified: null },
			new AbortController().signal,
		),
	).rejects.toMatchObject({ code: "invalid_url" });
	pool
		.intercept({ path: "/large" })
		.reply(200, "x".repeat(5 * 1024 * 1024 + 1));
	await expect(
		transport.fetch(
			"https://feeds.example.org/large",
			{ etag: null, lastModified: null },
			new AbortController().signal,
		),
	).rejects.toMatchObject({ code: "feed_too_large" });
});

test("release assessment uses leaf evidence only and skips identity, season, pack and numbering ambiguity", () => {
	expect(
		assessor.assessReleaseTitle("[G] Frieren - 03 [1080p]", target),
	).toMatchObject({
		eligible: true,
		episode: 3,
	});
	for (const title of [
		"Other Anime - 03",
		"Frieren S02 - 03",
		"Frieren - 01-12",
		"Frieren OVA - 01",
		"Frieren - 00",
		"Frieren - 29",
		"Frieren Complete Batch",
	])
		expect(assessor.assessReleaseTitle(title, target).eligible, title).toBe(
			false,
		);
	const extraction = new AnitomyIdentificationParser().extractRelease(
		"[G] Frieren / Extra - 03",
	);
	expect(extraction.inputs.map((input) => input.mode)).toEqual(["basename"]);
});
