import { createHash } from "node:crypto";
import {
	type JackettScan,
	type JackettScanStop,
	type SourceEntry,
	sourcePolicy,
} from "../domain/model.js";
import type { SearchCoverage } from "./model.js";
import type { releases } from "./xml.js";

type Page = ReturnType<typeof releases>;
export const hasMoreHistory = (scan: JackettScan) =>
	scan.keywords.some((cursor) => !cursor || "offset" in cursor);

export function pageFingerprint(page: Page) {
	return createHash("sha256")
		.update(
			page.entries
				.map((entry) => entry.id)
				.sort()
				.join("\n"),
		)
		.digest("hex");
}

/** Run one bounded collection round, giving every title's newest page priority. */
export async function readHistory(
	titles: readonly string[],
	readPage: (title: string, offset: number) => Promise<Page>,
	previous: JackettScan,
) {
	const keywords = titles.map((_, index) => previous.keywords[index] ?? null);
	let firstKeyword = previous.firstKeyword;
	const offsets = titles.map(() => 0);
	const seen = titles.map(() => new Set<string>());
	const found = new Map<string, SourceEntry>();
	const coverage: SearchCoverage = {
		limited: false,
		reason: null,
		pages: 0,
		queries: titles.length,
	};
	let remaining: number = sourcePolicy.maximumItems;
	const stop = (index: number, reason: JackettScanStop) => {
		keywords[index] = { stop: reason };
		if (reason !== "end") coverage.reason ??= reason;
	};
	const collect = async (index: number, offset: number) => {
		const title = titles[index];
		const fingerprints = seen[index];
		if (title === undefined || !fingerprints) return;
		const cursor = keywords[index];
		const page = await readPage(title, offset);
		const fingerprint = pageFingerprint(page);
		coverage.pages++;
		const priorPages = cursor && "offset" in cursor ? cursor.fingerprints : [];
		const wrongOffset = page.offset !== null && page.offset !== offset;
		if (
			(offset > 0 && wrongOffset) ||
			(page.count > 0 &&
				(fingerprints.has(fingerprint) ||
					(offset > 0 && priorPages.includes(fingerprint))))
		) {
			stop(index, "repeated_page");
			return;
		}
		fingerprints.add(fingerprint);
		for (const entry of page.entries.slice(0, remaining)) {
			const existing = found.get(entry.id);
			if (!existing || (entry.observedAt ?? 0) > (existing.observedAt ?? 0))
				found.set(entry.id, entry);
		}
		const partial = page.count > remaining;
		remaining -= Math.min(remaining, page.count);
		if (partial) {
			coverage.reason = "item_limit";
			return true;
		}
		if (wrongOffset) {
			stop(index, "repeated_page");
			return;
		}
		const end = offset + page.count;
		if (cursor && "stop" in cursor) {
			if (cursor.stop !== "end") coverage.reason ??= cursor.stop;
			return;
		}
		if (page.total === null && (page.count || offset > 0)) {
			stop(index, "missing_pagination");
			return;
		}
		if (!page.count || (page.total !== null && end >= page.total)) {
			stop(index, "end");
			return;
		}
		if (offset === 0 && cursor && "offset" in cursor) {
			offsets[index] = Math.max(end, cursor.offset - cursor.overlap);
			if (page.total !== null && (offsets[index] ?? 0) >= page.total)
				stop(index, "end");
			return;
		}
		offsets[index] = end;
		keywords[index] = {
			offset: Math.max(end, cursor && "offset" in cursor ? cursor.offset : 0),
			overlap: Math.min(10, Math.floor(page.count / 4)),
			fingerprints: [...priorPages.slice(-1), fingerprint],
		};
	};
	for (const index of titles.keys()) await collect(index, 0);
	const order = titles.map(
		(_, index) => (index + firstKeyword) % titles.length,
	);
	history: for (let pass = 0; pass < 2; pass++) {
		for (const index of order) {
			const cursor = keywords[index];
			const offset = offsets[index];
			if (!cursor || "stop" in cursor || !offset) continue;
			if (!remaining) {
				firstKeyword = index;
				coverage.reason = "item_limit";
				break history;
			}
			if (await collect(index, offset)) {
				firstKeyword = index;
				break history;
			}
		}
	}
	const scan: JackettScan = { keywords, firstKeyword };
	if (hasMoreHistory(scan)) coverage.reason ??= "page_limit";
	coverage.limited = coverage.reason !== null;
	return {
		entries: [...found.values()],
		coverage,
		outcome: found.size ? ("matches" as const) : ("no_match" as const),
		scan,
	};
}
