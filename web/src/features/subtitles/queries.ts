export const subtitlesKeys = {
	subtitles: (scope: string, fileId: string) =>
		["subtitles", scope, fileId] as const,
};
