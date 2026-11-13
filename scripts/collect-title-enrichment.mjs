import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Explicit maintenance command only. Tests consume frozen JSON and never use the network.
const root = resolve("apps/server/test/fixtures/title-enrichment");
const { seeds } = JSON.parse(await readFile(`${root}/seeds.json`, "utf8"));
const headers = {
	"User-Agent":
		"qw0er/Anishelf title-corpus (https://github.com/qw0er/Anishelf)",
	"Content-Type": "application/json",
};
const selection =
	"id type title { native romaji english } synonyms format status episodes duration seasonYear startDate {year month day} endDate {year month day} siteUrl relations {edges {relationType node {id type title {native romaji english} format episodes startDate {year month day}}}}";
let lastRequest = 0;
async function request(url, body) {
	for (let attempt = 0; attempt < 4; attempt++) {
		await new Promise((done) =>
			setTimeout(done, Math.max(0, 1100 - (Date.now() - lastRequest))),
		);
		lastRequest = Date.now();
		const response = await fetch(url, {
			headers,
			...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
			signal: AbortSignal.timeout(30_000),
		});
		const text = await response.text();
		if (response.status === 429 || response.status >= 500) {
			const delay = Number(response.headers.get("retry-after"));
			console.log(
				JSON.stringify({
					event: "title_corpus.retry",
					host: new URL(url).hostname,
					status: response.status,
					attempt,
				}),
			);
			await new Promise((done) =>
				setTimeout(
					done,
					Number.isFinite(delay) && delay > 0
						? delay * 1000
						: (attempt + 1) * 3000,
				),
			);
			continue;
		}
		if (!response.ok)
			throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
		return {
			data: JSON.parse(text),
			sha256: createHash("sha256").update(text).digest("hex"),
			fetchedAt: new Date().toISOString(),
		};
	}
	throw new Error(`Request retries exhausted: ${url}`);
}
function bangumiFields(data) {
	return Object.fromEntries(
		[
			"id",
			"type",
			"name",
			"name_cn",
			"date",
			"platform",
			"eps",
			"total_episodes",
			"infobox",
		].map((key) => [
			key,
			key === "infobox"
				? data.infobox?.filter((field) =>
						/别名|名|话数|放送|上映|播放/.test(field.key),
					)
				: data[key],
		]),
	);
}
await mkdir(`${root}/snapshots`, { recursive: true });
for (const seed of seeds) {
	const path = `${root}/snapshots/${seed.id}.json`;
	let existing;
	try {
		existing = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (existing) {
		for (const id of [seed.bangumiId, ...(seed.extraBangumiIds ?? [])].filter(
			Boolean,
		)) {
			if (!existing.bangumiCandidates.some((item) => item.data.id === id)) {
				const item = await request(`https://api.bgm.tv/v0/subjects/${id}`);
				existing.bangumiCandidates.push({
					sourceUrl: `https://bgm.tv/subject/${id}`,
					requestUrl: `https://api.bgm.tv/v0/subjects/${id}`,
					fetchedAt: item.fetchedAt,
					responseSha256: item.sha256,
					data: bangumiFields(item.data),
				});
				await writeFile(path, `${JSON.stringify(existing, null, "\t")}\n`);
			}
		}
		console.log(JSON.stringify({ event: "title_corpus.cached", id: seed.id }));
		continue;
	}
	const ani = await request("https://graphql.anilist.co", {
		query: `query($id:Int!){Media(id:$id,type:ANIME){${selection}}}`,
		variables: { id: seed.anilistId },
	});
	if (!ani.data.data?.Media || ani.data.errors)
		throw new Error(`AniList record missing: ${seed.id}`);
	const media = ani.data.data.Media;
	const query = media.title.native ?? media.title.romaji;
	const search = await request(
		"https://api.bgm.tv/v0/search/subjects?limit=20&offset=0",
		{ keyword: query, sort: "match", filter: { type: [2] } },
	);
	const ids = [
		...new Set([
			...(seed.bangumiId ? [seed.bangumiId] : []),
			...(seed.extraBangumiIds ?? []),
			...search.data.data.slice(0, 3).map((item) => item.id),
		]),
	];
	const candidates = [];
	for (const id of ids) {
		const item = await request(`https://api.bgm.tv/v0/subjects/${id}`);
		candidates.push({
			sourceUrl: `https://bgm.tv/subject/${id}`,
			requestUrl: `https://api.bgm.tv/v0/subjects/${id}`,
			fetchedAt: item.fetchedAt,
			responseSha256: item.sha256,
			data: bangumiFields(item.data),
		});
	}
	await writeFile(
		path,
		`${JSON.stringify({ schemaVersion: 1, id: seed.id, anilist: { sourceUrl: `https://anilist.co/anime/${seed.anilistId}`, requestUrl: "https://graphql.anilist.co", fetchedAt: ani.fetchedAt, responseSha256: ani.sha256, data: media }, bangumiSearch: { query, requestUrl: "https://api.bgm.tv/v0/search/subjects?limit=20&offset=0", fetchedAt: search.fetchedAt, responseSha256: search.sha256, total: search.data.total, limit: search.data.limit, offset: search.data.offset, ids: search.data.data.map((item) => item.id) }, bangumiCandidates: candidates }, null, "\t")}\n`,
	);
	console.log(
		JSON.stringify({
			event: "title_corpus.collected",
			id: seed.id,
			anilistId: media.id,
			candidateIds: ids,
		}),
	);
}
