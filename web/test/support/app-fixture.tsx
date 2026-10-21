import { StrictMode } from "react";
import { createMemoryRouter, useLocation, useNavigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, vi } from "vitest";
import App from "../../src/app/App.js";
import { libraryRoute } from "../../src/app/routes/library.js";
import { clearCompatibilityCache } from "../../src/features/media/media-compatibility/cache.js";
import type {
	AnimeLibraryResponse,
	CatalogSourceResponse,
	DirectoryResponse,
	FileResponse,
	LibraryResponse,
	PlaybackSessionResponse,
	PreparationTaskResponse,
	ScanStateDto,
	SettingsResponse,
	TrackingAccountResponse,
	TrackingEntryResponse,
} from "../../src/shared/api/contracts.js";
import { queryClient } from "../../src/shared/api/query-client.js";
import { Toaster, toast } from "../../src/shared/components/ui/toast.js";
import {
	animeDetailFixture,
	animeFixture,
	reviewFixture,
} from "../fixtures/anime.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "../query-test-utils.js";
import { trackingProvider } from "../tracking-fixture.js";

export const appFixture = {} as {
	library: LibraryResponse;
	directories: Map<string, DirectoryResponse>;
	fileError: boolean;
	compatibilityStatus: "supported" | "unsupported" | "unknown";
	settings: SettingsResponse;
	preparationTasks: PreparationTaskResponse[];
};

export const runningScan: ScanStateDto = {
	id: "scan-1",
	status: "running",
	startedAt: "2026-09-29T00:00:00.000Z",
	finishedAt: null,
	visitedCount: 2,
	matchedCount: 1,
	warnings: { count: 0, messages: [] },
};

export const completedScan: ScanStateDto = {
	...runningScan,
	status: "completed",
	finishedAt: "2026-09-29T00:00:01.000Z",
};

export const file: FileResponse = {
	file: {
		kind: "file",
		id: "file-1",
		parentId: "season-1",
		name: "Episode 01.mp4",
		sizeBytes: 100,
		modifiedAt: "2026-09-29T00:00:00.000Z",
		mimeType: "video/mp4",
	},
	originalMediaUrl: "/api/media/file-1",
};

const disconnectedList: AnimeLibraryResponse["tracking"] = {
	provider: trackingProvider,
	accountId: null,
	generation: "fixture",
	state: "disconnected",
	fetchedAt: null,
	stale: true,
	refreshing: false,
	error: null,
};

export const fetcher = vi.fn<typeof fetch>();

const routers: ReturnType<typeof createMemoryRouter>[] = [];

export function json(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

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
	appFixture.settings = { resourceRoots: ["/media"] };
	fetcher.mockReset();
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/auth/session")
			return json({ authenticated: true, csrfToken: "test-csrf" });
		if (String(input) === "/api/media/file-1/access-link")
			return json({
				url: "/api/media/file-1?access_token=test-token",
				expiresAt: Date.now() + 86400000,
			});
		const path = String(input);
		if (path.startsWith("/api/files/file-1/chapters?"))
			return json({ sourceVersion: "version", chapters: [] });
		if (
			path === "/api/preparations?summary=true" ||
			path.startsWith("/api/preparations?")
		)
			return json({ tasks: appFixture.preparationTasks });
		if (path === "/api/catalog/file-reviews") return json([]);
		if (path.startsWith("/api/catalog/reviews?"))
			return json({ items: [], page: 1, perPage: 20, hasNextPage: false });
		if (path.includes("/airing?"))
			return json({
				snapshotId: "airing",
				fetchedAt: 1,
				stale: false,
				refreshing: false,
				refreshError: null,
				data: { items: [], page: 1, perPage: 25, hasNextPage: false },
			});
		if (path === "/api/anime/identification")
			return json({ running: false, failed: false });
		if (path === "/api/catalog/sources/file-1")
			return json({ sourceVersion: "version", associations: [] });
		if (path.startsWith("/api/anime/library?"))
			return json({
				items: [],
				page: 1,
				perPage: 24,
				hasNextPage: false,
				localState: "available",
				tracking: disconnectedList,
			});
		if (path === "/api/transcode-profiles")
			return json({
				profiles: [
					{
						id: "builtin:web",
						name: "Browser",
						description: "Browser profile",
						container: "mp4",
						videoEncoder: "libx264",
						audioEncoder: "aac",
						source: "builtin",
						usage: "preparation",
					},
				],
				selectedProfileId: "builtin:web",
				selectionAvailable: true,
				preparationMode: "compatible" as const,
			});
		if (path === "/api/preparations/summaries")
			return json({
				files: [
					{
						fileId: "file-1",
						versions: appFixture.preparationTasks
							.filter((task) => task.status === "ready" && task.artifactId)
							.map((task) => ({
								sourceVersion: task.sourceVersion,
								publishedCopies: 1,
								pendingTasks: 0,
							})),
					},
				],
			});
		if (path.startsWith("/api/preparations/"))
			return json(
				appFixture.preparationTasks.find((task) => path.endsWith(task.id)),
			);
		if (path.startsWith("/api/files/file-1/compatibility")) {
			if (init?.method === "POST") {
				const decision = {
					status: appFixture.compatibilityStatus,
					reason:
						appFixture.compatibilityStatus === "supported"
							? "browser-supported"
							: "browser-rejected",
				};
				return json({
					fileId: "file-1",
					sourceVersion:
						init?.method === "POST"
							? JSON.parse(String(init.body)).sourceVersion
							: (new URL(path, "http://localhost").searchParams.get(
									"sourceVersion",
								) ?? "version"),
					rulesVersion: "4",
					direct: decision,
					container: decision,
					video: decision,
					audio: decision,
					selectedVideo: null,
					defaultAudioStreamIndex: null,
					selectedAudioStreamIndices: [],
					audioTracks: [],
					output: JSON.parse(String(init.body)).output
						? { combinations: { "copy-copy": "supported" } }
						: null,
					warnings: [],
				});
			}
			return json({
				fileId: "file-1",
				sourceVersion:
					init?.method === "POST"
						? JSON.parse(String(init.body)).sourceVersion
						: (new URL(path, "http://localhost").searchParams.get(
								"sourceVersion",
							) ?? "version"),
				rulesVersion: "4",
				container: "mp4",
				descriptionId: "a".repeat(64),
				output: null,
				video: null,
				defaultAudioStreamIndex: null,
				selectedAudioStreamIndices: [],
				audioTracks: [],
				multipleTracks: false,
				queries: [],
			});
		}
		if (path === "/api/playback/options")
			return json({
				original: {
					sourceVersion: "version",
					descriptionId: "a".repeat(64),
					selectedAudioStreamIndices: [],
					queries: [],
					output: null,
				},
				candidates: [],
			});
		if (path === "/api/playback/selection") {
			const intent = JSON.parse(String(init?.body));
			const decision = {
				status: appFixture.compatibilityStatus,
				reason:
					appFixture.compatibilityStatus === "supported"
						? "browser-supported"
						: "browser-rejected",
			};
			const ready = appFixture.preparationTasks.find(
				(task) => task.status === "ready" && task.resource,
			);
			const resource = {
				delivery: "file",
				url: file.originalMediaUrl,
				mimeType: "video/mp4",
				timeline: {
					sourceOriginMs: 0,
					mediaOriginMs: 0,
					sourceDurationMs: null,
				},
			};
			return json({
				sourceVersion: "version",
				pending: false,
				compatibility: {
					fileId: "file-1",
					sourceVersion: "version",
					rulesVersion: "4",
					direct: decision,
					container: decision,
					video: decision,
					audio: decision,
					selectedVideo: null,
					defaultAudioStreamIndex: null,
					selectedAudioStreamIndices: [],
					audioTracks: [],
					output: null,
					warnings: [],
				},
				plan: intent.tryOriginal
					? { mode: "direct", resource }
					: ready
						? {
								mode: "prepared",
								artifactId: ready.artifactId,
								resource: ready.resource,
							}
						: appFixture.compatibilityStatus === "supported" &&
								!intent.failedResourceIds?.includes("file-1")
							? { mode: "direct", resource }
							: { mode: "blocked", reason: "browser-rejected" },
			});
		}

		if (path === "/api/playback/sessions") {
			return json(
				{
					token: "session-token",
					sourceVersion: "version",
					file: file.file,
					progress: {
						positionMs: 0,
						durationMs: 100000,
						lastViewedAtMs: null,
						generation: 1,
						lastSequence: 0,
					},
				} satisfies PlaybackSessionResponse,
				201,
			);
		}
		if (path === "/api/playback/sessions/session-token/progress") {
			const input = JSON.parse(String(init?.body));
			return json({
				status: "saved",
				progress: {
					positionMs: input.positionMs,
					durationMs: input.durationMs,
					generation: input.generation,
					lastSequence: input.sequence,
					lastViewedAtMs: 1,
				},
			});
		}
		if (
			path === "/api/playback/sessions/session-token" &&
			init?.method === "DELETE"
		)
			return new Response(null, { status: 204 });
		if (path.startsWith("/api/metadata/reference?"))
			return json({ provider: "anilist", mediaType: "anime", id: "154587" });
		if (path === "/api/acquisition/downloads/settings")
			return json({
				destination: null,
				roots: [{ scopeId: "root", name: "media" }],
			});
		if (path.startsWith("/api/acquisition/downloads?"))
			return json({
				authorized: false,
				destination: null,
				items: [],
				total: 0,
				active: 0,
				attention: 0,
				page: 1,
			});
		if (path.startsWith("/api/acquisition/subscriptions?"))
			return json({ subscription: null, candidates: [], total: 0, page: 1 });
		if (path === "/api/acquisition/qbittorrent")
			return json({
				generation: "fixture",
				state: "unconfigured",
				url: null,
				username: "",
				passwordConfigured: false,
			});
		if (path === "/api/tracking/account")
			return json({
				provider: trackingProvider,
				generation: "fixture",
				account: null,
				state: "disconnected",
				connectivity: "unknown",
				checkedAt: null,
			});
		if (path === "/api/settings") {
			if (init?.method === "PUT") {
				const previousRoot = appFixture.settings.resourceRoots;
				appFixture.settings = JSON.parse(String(init.body)) as SettingsResponse;
				appFixture.library = {
					...appFixture.library,
					ready: appFixture.settings.resourceRoots.length > 0,
					scan:
						JSON.stringify(appFixture.settings.resourceRoots) !==
						JSON.stringify(previousRoot)
							? runningScan
							: appFixture.library.scan,
					error: null,
					stale: false,
					revision: appFixture.library.revision + 1,
				};
				const root = appFixture.directories.get("root");
				if (root) appFixture.directories.set("root", { ...root, children: [] });
			}
			return json(appFixture.settings);
		}
		if (path === "/api/library") return json(appFixture.library);
		if (path === "/api/library/scan") {
			appFixture.library = { ...appFixture.library, scan: runningScan };
			return json({ scan: runningScan }, 202);
		}
		if (path.startsWith("/api/directories/")) {
			const directory = appFixture.directories.get(
				path.slice("/api/directories/".length),
			);
			if (directory) return json(directory);
			return json(
				{
					error: {
						code: "RESOURCE_NOT_FOUND",
						message: "The resource was not found.",
						requestId: "id",
					},
				},
				404,
			);
		}
		if (path === "/api/files/file-1") {
			return appFixture.fileError
				? json(
						{
							error: {
								code: "RESOURCE_MISSING",
								message:
									"This file is no longer available. Scan the library again.",
								requestId: "id",
							},
						},
						404,
					)
				: json(file);
		}
		throw new Error(`Unexpected URL: ${path}`);
	});
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
	for (const router of routers) router.dispose();
	routers.length = 0;
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function RouterProbe() {
	const location = useLocation();
	const navigate = useNavigate();
	return (
		<>
			<output data-testid="location">
				{location.pathname}
				{location.search}
			</output>
			<button type="button" onClick={() => navigate(-1)}>
				History back
			</button>
			<button type="button" onClick={() => navigate(1)}>
				History forward
			</button>
		</>
	);
}

export function renderApp(path = "/directories/root", strict = false) {
	const router = createMemoryRouter(
		[
			{
				...libraryRoute,
				element: (
					<>
						<App />
						<RouterProbe />
					</>
				),
			},
		],
		{ initialEntries: [path] },
	);
	routers.push(router);
	const app = (
		<>
			<RouterProvider router={router} />
			<Toaster />
		</>
	);
	return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), router };
}

export async function openFile() {
	fireEvent.click(await screen.findByRole("link", { name: "Season 1" }));
	fireEvent.click(await screen.findByRole("link", { name: "Episode 01.mp4" }));
}

async function fixtureViewing(
	key: string,
): Promise<TrackingEntryResponse | undefined> {
	const implementation = requiredFetch(fetcher.getMockImplementation());
	const account = (await (
		await implementation("/api/tracking/account")
	).json()) as TrackingAccountResponse;
	if (!account.account) return undefined;
	return (
		await implementation(
			`/api/tracking/entries/${encodeURIComponent(key)}?generation=${account.generation}`,
		)
	).json() as Promise<TrackingEntryResponse>;
}
export function mockAnime(detail: ReturnType<typeof animeFixture>) {
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.startsWith("/api/anime/library?"))
			return json({
				items: [{ ...detail.work, localWorkId: detail.work.id, viewing: null }],
				page: Number(
					new URL(path, "http://localhost").searchParams.get("page") ?? 1,
				),
				perPage: 24,
				hasNextPage: true,
				localState: "available",
				tracking: disconnectedList,
			});
		if (path === "/api/anime/details/local/work-1") {
			const key = "anilist:anime:154587";
			return json(animeDetailFixture(detail, await fixtureViewing(key)));
		}
		if (path.startsWith("/api/anime/details/works/")) {
			const key = decodeURIComponent(
				path.slice("/api/anime/details/works/".length),
			);
			const viewing = await fixtureViewing(key);
			const id = decodeURIComponent(key.split(":")[2] ?? "");
			const response = await requiredFetch(fetcher.getMockImplementation())(
				`/api/metadata/anilist/${encodeURIComponent(id)}`,
			);
			return json({
				...animeDetailFixture(detail, viewing),
				reference: { provider: "anilist", mediaType: "anime", id },
				local: null,
				displayTitle: viewing?.entry?.titles[0] ?? key,
				metadata: response.ok ? await response.json() : null,
				metadataError: response.ok
					? null
					: { code: "unavailable", message: "Unavailable", retryAt: null },
			});
		}
		if (path === "/api/catalog/works/work-1/refresh") return json(detail);
		if (path.startsWith("/api/metadata/anilist/154587/relations"))
			return json({
				snapshotId: "relations",
				fetchedAt: 1,
				stale: false,
				refreshing: false,
				refreshError: null,
				data: { items: [], page: 1, perPage: 25, hasNextPage: false },
			});
		if (!fallback) throw new Error("Missing fetch fixture");
		return fallback(input, init);
	});
}

export function mockReview(confirmed = false) {
	const item = reviewFixture(confirmed);
	const detail = animeFixture();
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.startsWith("/api/catalog/reviews?"))
			return json({ items: [item], page: 1, perPage: 20, hasNextPage: false });
		if (path === `/api/catalog/reviews/${item.id}`) return json(item);
		if (path.startsWith("/api/metadata/search?"))
			return json({
				...detail.metadata,
				data: {
					items: [detail.metadata.data],
					page: 1,
					perPage: 10,
					hasNextPage: false,
				},
			});
		if (path === "/api/metadata/anilist/154587") return json(detail.metadata);
		if (path === "/api/catalog/previews") {
			const body = JSON.parse(String(init?.body));
			const row = body.rows[0];
			return json({
				id: "preview-1",
				expiresAt: Date.now() + 60000,
				reference: body.reference,
				workId: confirmed ? "work-1" : null,
				workRevision: confirmed ? 1 : null,
				metadata: detail.metadata,
				rows: [
					{
						reviewId: item.id,
						revision: item.revision,
						relativePath: item.relativePath,
						rawNumbers: item.evidence.rawEpisodes,
						before: item.associations.map(
							({ workId, episodeId, kind, number }) => ({
								workId,
								episodeId,
								kind,
								number,
							}),
						),
						targets: row.targets.map(
							(target: { kind: string; number: string }) => ({
								...target,
								number:
									target.kind === "regular"
										? String(Number(target.number) + row.offset)
										: target.number,
							}),
						),
						offset: row.offset,
						reason: row.reason,
					},
				],
			});
		}
		if (path === "/api/catalog/confirmations") {
			item.decision = "confirmed";
			item.revision += 1;
			return json({ workId: "work-1", revision: 2, reviewIds: [item.id] });
		}
		if (path === `/api/catalog/reviews/${item.id}/remove`) {
			item.associations = [];
			item.decision = "rejected";
			item.revision += 1;
			return json(item);
		}
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	return item;
}

export async function selectReviewWork() {
	const input = await screen.findByLabelText("Provider ID or work URL");
	fireEvent.change(input, {
		target: { value: "https://anilist.co/anime/154587/Frieren" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Look up" }));
	await screen.findByLabelText("Episode numbers");
}

export function playbackTitleFixture(): CatalogSourceResponse {
	return {
		sourceVersion: "version",
		associations: [1, 2].map((number) => ({
			workId: "work-1",
			workTitle: "Local Frieren",
			episodeId: `episode-${number}`,
			kind: "regular",
			number: String(number),
			label: "Custom episode title",
		})),
	};
}

export function requiredFetch(
	value: ReturnType<typeof fetcher.getMockImplementation>,
) {
	if (!value) throw new Error("Missing fetch mock");
	return value;
}
