export const playbackKeys = {
	chapters: (scope: string, fileId: string, sourceVersion: string) =>
		["chapters", scope, fileId, sourceVersion] as const,
};
