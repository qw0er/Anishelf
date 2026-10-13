import type { HttpInstance } from "../../transport/instance.js";
import type { MediaInspectionApplication } from "./media-inspection/application.js";
import { registerChapterRoutes } from "./media-inspection/http/chapters.js";
import type { MediaPlanningApplication } from "./media-planning/application/planning.js";
import { registerMediaPlanningRoutes } from "./media-planning/http/planning.js";
import type { PreparationApplication } from "./preparation/application/preparation.js";
import { registerPreparationRoutes } from "./preparation/http/preparation.js";
import type { SubtitleApplication } from "./subtitles/application/subtitles.js";
import { registerSubtitleRoutes } from "./subtitles/http/subtitles.js";
export function registerMediaHttp(
	app: HttpInstance,
	owners: {
		inspection: MediaInspectionApplication;
		planning: MediaPlanningApplication;
		preparation: PreparationApplication;
		subtitles: SubtitleApplication;
	},
): void {
	registerChapterRoutes(app, owners.inspection);
	registerMediaPlanningRoutes(app, owners.planning);
	registerPreparationRoutes(app, owners.preparation);
	registerSubtitleRoutes(app, owners.subtitles);
}
