/** HTTP owns delivery URLs; the business selection contains only actual asset facts. */
export function playbackSelectionResponse(
	result: import("../public.js").PlaybackSelection,
): import("../../../../contracts/http.js").PlaybackSelectionResponse {
	const active = result.active;
	return {
		...result,
		active: active
			? {
					...active,
					resource: {
						delivery: "file",
						url:
							active.asset.kind === "original"
								? `/api/media/${encodeURIComponent(result.source.fileId)}`
								: `/api/prepared-media/${active.asset.id}`,
						mimeType: active.asset.mimeType,
						timeline: active.asset.timeline,
					},
				}
			: null,
	};
}
