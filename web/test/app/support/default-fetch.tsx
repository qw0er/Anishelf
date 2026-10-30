import type {
	DirectoryResponse,
	PlaybackSessionResponse,
	SettingsResponse,
} from "../../../src/shared/api/contracts.js";
import {
	compatibility as assetCompatibility,
	preparedAsset,
} from "../../support/playback-fixture.js";
import { trackingProvider } from "../../support/tracking-fixture.js";

import {
	appFixture,
	disconnectedList,
	file,
	json,
	runningScan,
} from "./state.js";
export const defaultAppFetch: typeof fetch = async (input, init) => {
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
	if (path === "/api/acquisition/watching")
		return json({
			revision: "unconfigured",
			enabled: false,
			reason: "disabled",
			accountId: null,
			trackingGeneration: "fixture",
			config: null,
			works: [],
		});
	if (path === "/api/acquisition/profiles")
		return json({
			profiles: [
				{
					id: "builtin:general",
					name: "General",
					description: "Any codec",
					source: "builtin",
				},
			],
			selectedProfileId: "builtin:general",
			selectionAvailable: true,
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

	if (path === "/api/playback/options" || path === "/api/playback/selection") {
		const intent = JSON.parse(String(init?.body));
		const source = {
			fileId: intent.fileId,
			sourceVersion: intent.sourceVersion ?? "version",
			audioTracks: [],
			defaultAudioStreamIndex: null,
		};
		const original = {
			...preparedAsset,
			id: intent.fileId,
			kind: "original" as const,
			inspection: appFixture.inspectionAvailable
				? ("complete" as const)
				: ("unavailable" as const),
			profileId: null,
			video: appFixture.inspectionAvailable ? preparedAsset.video : null,
			audioTracks: [],
			defaultAudioStreamIndex: null,
			durationMs: null,
			timeline: {
				sourceOriginMs: 0,
				mediaOriginMs: 0,
				sourceDurationMs: null,
			},
		};
		const ready = appFixture.preparationTasks.filter(
			(task) => task.status === "ready" && task.resource,
		);
		const assets = [
			original,
			...ready.map((task) => ({
				...original,
				id: task.artifactId ?? "artifact",
				kind: "prepared" as const,
				profileId: task.profileId,
			})),
		];
		if (path === "/api/playback/options")
			return json({
				source,
				resolvedAudioStreamIndex: null,
				pending: false,
				assets: assets.map((asset, index) => ({
					asset,
					descriptionId: (index ? "b" : "a").repeat(64),
					audio: null,
					queries: [],
				})),
			});
		const choices = assets.map((asset) => {
			const decision =
				asset.kind === "prepared"
					? { status: "supported" as const, reason: "browser-supported" }
					: {
							status: appFixture.compatibilityStatus,
							reason:
								appFixture.compatibilityStatus === "supported"
									? "browser-supported"
									: appFixture.compatibilityStatus === "unknown"
										? "browser-uncertain"
										: "browser-rejected",
						};
			return {
				asset,
				audio: null,
				compatibility: { ...assetCompatibility, overall: decision },
				unavailableReason: intent.failedResourceIds?.includes(asset.id)
					? "asset-playback-failed"
					: decision.status === "supported"
						? null
						: decision.reason,
			};
		});
		const selected = choices.find(
			(choice) =>
				(!intent.assetId || choice.asset.id === intent.assetId) &&
				!intent.failedResourceIds?.includes(choice.asset.id) &&
				(choice.compatibility.overall.status === "supported" ||
					intent.allowUnverified),
		);
		return json({
			source,
			resolvedAudioStreamIndex: null,
			pending: false,
			choices,
			active: selected
				? {
						...selected,
						resource: {
							delivery: "file",
							url:
								selected.asset.kind === "original"
									? `/api/media/${intent.fileId}`
									: ready.find((task) => task.artifactId === selected.asset.id)
											?.resource?.url,
							mimeType: selected.asset.mimeType,
							timeline: selected.asset.timeline,
						},
					}
				: null,
			reason: selected ? null : "no-playable-asset",
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
		return json({ id: "metadata-work-1" });
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
	if (path === "/api/acquisition/sources/connector")
		return json({
			generation: "fixture",
			url: null,
			origin: null,
			providers: [],
			hasApiKey: false,
			ready: false,
			error: null,
		});
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
	if (path.startsWith("/api/directories/") && path.includes("/search?")) {
		const url = new URL(path, "http://localhost");
		const id = decodeURIComponent(
			url.pathname.slice("/api/directories/".length, -"/search".length),
		);
		const query = (url.searchParams.get("q") ?? "").toLowerCase();
		const items: {
			resource: DirectoryResponse["children"][number];
			parentPath: string[];
		}[] = [];
		const visit = (directoryId: string, parentPath: string[]) => {
			for (const resource of appFixture.directories.get(directoryId)
				?.children ?? []) {
				if (resource.name.toLowerCase().includes(query))
					items.push({ resource, parentPath });
				if (resource.kind === "directory")
					visit(resource.id, [...parentPath, resource.name]);
			}
		};
		visit(id, []);
		items.sort((a, b) =>
			a.resource.kind === b.resource.kind
				? a.resource.name.localeCompare(b.resource.name, "en", {
						numeric: true,
					})
				: a.resource.kind === "directory"
					? -1
					: 1,
		);
		return json({ items });
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
};
