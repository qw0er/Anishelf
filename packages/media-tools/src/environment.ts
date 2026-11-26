export interface ExecutableSearch {
	readonly path: string;
	readonly pathExt: string;
}

/** Capture process environment once; adapters receive this immutable search context. */
export function captureExecutableSearch(
	env: Readonly<Record<string, string | undefined>> = process.env,
): ExecutableSearch {
	return Object.freeze({
		path: env.PATH ?? "",
		pathExt: env.PATHEXT ?? ".EXE",
	});
}
