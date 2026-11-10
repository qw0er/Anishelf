import { Type } from "typebox";
import {
	PlaybackSourceSchema,
	ResourceParamsSchema,
} from "../../contracts/schemas/index.js";
import { SourceVersionSchema } from "../../contracts/schemas/playback.js";
import type { HttpInstance } from "../../transport/instance.js";
import type { MediaInspectionApplication } from "./inspection/application.js";
import { registerChapterRoutes } from "./inspection/http/chapters.js";
import { describeAudio } from "./inspection/public.js";
import type { PreparationApplication } from "./preparation/application/preparation.js";
import { registerPreparationRoutes } from "./preparation/http/preparation.js";
import type { SubtitleApplication } from "./subtitles/application/subtitles.js";
import { registerSubtitleRoutes } from "./subtitles/http/subtitles.js";
export function registerMediaHttp(
	app: HttpInstance,
	owners: {
		inspection: MediaInspectionApplication;
		preparation: PreparationApplication;
		subtitles: SubtitleApplication;
	},
): void {
	app.get(
		"/api/files/:id/preparation-source",
		{
			schema: {
				params: ResourceParamsSchema,
				querystring: Type.Object(
					{ sourceVersion: Type.Optional(SourceVersionSchema) },
					{ additionalProperties: false },
				),
				response: { 200: PlaybackSourceSchema },
			},
		},
		async (request) => {
			const { source, info } = await owners.inspection.inspect(
				request.params.id,
			);
			const tracks = info.streams.filter((s) => s.type === "audio");
			return {
				fileId: request.params.id,
				sourceVersion: source.identity.sourceVersion,
				audioTracks: tracks.map(describeAudio),
				defaultAudioStreamIndex:
					(tracks.find((s) => s.default) ?? tracks[0])?.index ?? null,
			};
		},
	);
	registerChapterRoutes(app, owners.inspection);
	registerPreparationRoutes(app, owners.preparation);
	registerSubtitleRoutes(app, owners.subtitles);
}
