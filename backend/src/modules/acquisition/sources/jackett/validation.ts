import { SourceError } from "../domain/model.js";

export function jackettUrl(input: string): string {
	try {
		if (!input || input.length > 2048 || /[\s\\%]/.test(input))
			throw new Error();
		const url = new URL(input);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			throw new Error();
		url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
		return url.href;
	} catch {
		throw new SourceError("invalid_source_url");
	}
}
export function indexerId(input: string): string {
	if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(input) || input === "all")
		throw new SourceError("invalid_indexer");
	return input;
}
export function titleQueries(values: readonly string[]): string[] {
	if (!values.length || values.length > 4)
		throw new SourceError("invalid_query");
	const titles = values.map((value) => value.normalize("NFKC").trim());
	if (
		titles.some(
			(title) => !title || title.length > 256 || /[\r\n\0]/.test(title),
		)
	)
		throw new SourceError("invalid_query");
	return [...new Set(titles)];
}
