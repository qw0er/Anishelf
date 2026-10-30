import { afterEach, beforeEach, vi } from "vitest";
import { clearCompatibilityCache } from "../../../src/features/media/media-compatibility/cache.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import { act, cleanup } from "../../support/query-test-utils.js";

import { defaultAppFetch } from "./default-fetch.js";
import { disposeAppRouters } from "./render-app.js";
import { appFixture, completedScan, fetcher, file } from "./state.js";
export function setupAppTest() {
	beforeEach(async () => {
		await clearCompatibilityCache();
		queryClient.removeQueries({ queryKey: ["compatibility"] });
		appFixture.preparationTasks = [];
		appFixture.library = {
			ready: true,
			revision: 1,
			scan: completedScan,
			error: null,
			stale: false,
		};
		appFixture.directories = new Map([
			[
				"root",
				{
					directory: {
						kind: "directory",
						id: "root",
						parentId: null,
						name: "media",
					},
					children: [
						{
							kind: "directory",
							id: "season-1",
							parentId: "root",
							name: "Season 1",
						},
					],
				},
			],
			[
				"season-1",
				{
					directory: {
						kind: "directory",
						id: "season-1",
						parentId: "root",
						name: "Season 1",
					},
					children: [file.file],
				},
			],
		]);
		appFixture.fileError = false;
		appFixture.compatibilityStatus = "supported";
		appFixture.inspectionAvailable = true;
		Object.defineProperties(HTMLVideoElement.prototype, {
			videoWidth: { configurable: true, get: () => 1920 },
			videoHeight: { configurable: true, get: () => 1080 },
		});
		appFixture.settings = { resourceRoots: ["/media"] };
		fetcher.mockReset();
		fetcher.mockImplementation(defaultAppFetch);
		vi.stubGlobal("fetch", fetcher);
		// Real browsers dispatch media events asynchronously. Happy DOM's src setter
		// dispatches canplay synchronously before the provider finishes loading.
		vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(
			function (this: HTMLMediaElement, value) {
				this.setAttribute("src", value);
			},
		);
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
		vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
	});

	afterEach(async () => {
		act(() => toast.close());
		cleanup();
		vi.useRealTimers();
		await new Promise((resolve) => setTimeout(resolve, 0));
		disposeAppRouters();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		Reflect.deleteProperty(HTMLVideoElement.prototype, "videoWidth");
		Reflect.deleteProperty(HTMLVideoElement.prototype, "videoHeight");
	});
}
