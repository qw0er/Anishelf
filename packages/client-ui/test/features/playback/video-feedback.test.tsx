// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as media from "../../../src/features/media/subtitles/api.js";
import * as api from "../../../src/features/playback/player/api.js";
import VideoPlayer from "../../../src/features/playback/player/components/video-player.js";
import { playbackPolicy } from "../../../src/features/playback/player/policy.js";
import { PlaybackSessionController } from "../../../src/features/playback/player/session.js";
import { getClientRuntime } from "../../../src/shared/api/connection.js";
import i18n from "../../../src/shared/i18n.js";
import { mockPlayer } from "../../support/mock-libmedia.js";
import { preparedActive } from "../../support/playback-fixture.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "../../support/query-test-utils.js";
import { session } from "./support/playback-session-fixture.js";

let controller: PlaybackSessionController;
beforeEach(async () => {
	localStorage.clear();
	mockPlayer.restored = true;
	vi.spyOn(media, "getSubtitles").mockResolvedValue({
		sourceVersion: session.sourceVersion,
		tracks: [],
		warnings: [],
	});
	vi.spyOn(api, "openPlaybackSession").mockResolvedValue(session);
	vi.spyOn(api, "releasePlaybackSession").mockResolvedValue();
	vi.spyOn(api, "savePlaybackProgress").mockResolvedValue({
		status: "saved",
		progress: session.progress,
	});
	controller = new PlaybackSessionController("file", () => {}, playbackPolicy);
	await controller.open();
});
afterEach(async () => {
	cleanup();
	await controller.dispose();
	vi.restoreAllMocks();
});
function props() {
	return {
		fileId: "file",
		displayTitle: "Episode",
		sourceVersion: session.sourceVersion,
		active: preparedActive,
		silent: false,
		bind: controller.bind.bind(controller),
		startContinuation: vi.fn(async () => {}),
		onAudioChange: vi.fn(),
		onPlaybackFailure: vi.fn(),
		onPlaybackRecovered: vi.fn(),
		onReselect: vi.fn(),
	};
}
async function mounted() {
	await waitFor(() => expect(mockPlayer.instances).toHaveLength(1));
	const instance = mockPlayer.instances[0];
	if (!instance) throw Error("Missing playback fixture.");
	return instance;
}

test("loads the selected resource at restored source time with the selected audio", async () => {
	const input = props();
	const view = render(<VideoPlayer {...input} />);
	const player = await mounted();
	expect(player.props()).toMatchObject({
		src: new URL(preparedActive.resource.url, location.origin).href,
		initialPlaybackPreferences: {
			audio: { streamIndex: preparedActive.audio?.streamIndex, strict: true },
		},
		initialPositionMs: 40000,
		mediaRequest: { credentials: "include" },
	});
	view.rerender(<VideoPlayer {...input} displayTitle="Revised title" />);
	expect(view.getByRole("region", { name: "Revised title" })).toBeTruthy();
	expect(await mounted()).toBe(player);
});

test("uses the app locale without restarting the player", async () => {
	const input = props();
	render(<VideoPlayer {...input} />);
	const player = await mounted();
	const previous = i18n.language;
	try {
		await act(() => i18n.changeLanguage("zh-CN"));
		expect(player.props().locale).toBe("zh-CN");
		expect(await mounted()).toBe(player);
	} finally {
		await act(() => i18n.changeLanguage(previous));
	}
});

test("restores saved speed and subtitles without replacing the requested audio", async () => {
	const input = props();
	const view = render(<VideoPlayer {...input} />);
	const first = await mounted();
	await waitFor(() => expect(input.onPlaybackRecovered).toHaveBeenCalledOnce());
	act(() => {
		first.preference({ playbackRate: 1.25, audio: null });
		first.preference({
			subtitles: {
				enabled: true,
				externalSubtitleId: "sidecar",
				language: "eng",
			},
		});
		first.props().onPlaybackPreferenceChange?.({
			sessionId: "stale",
			src: first.props().src,
			changes: { playbackRate: 2 },
		});
	});
	view.unmount();

	const next = render(<VideoPlayer {...input} />);
	expect((await mounted()).props().initialPlaybackPreferences).toEqual({
		audio: { streamIndex: input.active.audio?.streamIndex, strict: true },
		playbackRate: 1.25,
		subtitles: {
			enabled: true,
			externalSubtitleId: "sidecar",
			language: "eng",
		},
	});
	next.unmount();

	render(<VideoPlayer {...input} fileId="another-file" />);
	expect((await mounted()).props().initialPlaybackPreferences).toMatchObject({
		playbackRate: 1.25,
		subtitles: { enabled: true, language: "eng" },
	});
	expect(
		(await mounted()).props().initialPlaybackPreferences?.subtitles,
	).not.toHaveProperty("externalSubtitleId");
});

test("maps same-language asset tracks and silence back to source audio without reopening media", async () => {
	const input = props();
	const first = input.active.asset.audioTracks[0];
	if (!first || !input.active.audio) throw new Error("Missing audio tracks.");
	const active = {
		...input.active,
		asset: {
			...input.active.asset,
			audioTracks: [
				...input.active.asset.audioTracks,
				{ stream: { ...first.stream, index: 2 }, sourceStreamIndex: 7 },
			],
		},
	};
	const view = render(<VideoPlayer {...input} active={active} />);
	const player = await mounted();
	await waitFor(() => expect(input.onPlaybackRecovered).toHaveBeenCalledOnce());
	await act(() => {
		player.track(first.stream.index);
		player.track(2);
	});
	expect(input.onAudioChange).toHaveBeenCalledExactlyOnceWith(7);
	view.rerender(
		<VideoPlayer
			{...input}
			active={{
				...active,
				audio: { streamIndex: 2, sourceStreamIndex: 7, position: 1 },
			}}
		/>,
	);
	expect(await mounted()).toBe(player);
	expect(player.selectAudio).not.toHaveBeenCalled();
	await act(() => player.track(null));
	expect(input.onAudioChange).toHaveBeenLastCalledWith(null);
});

test("reports structured failures, then reloads at the last settled position", async () => {
	const input = props();
	const view = render(<VideoPlayer {...input} />);
	const first = await mounted();
	await waitFor(() =>
		expect(input.onPlaybackRecovered).toHaveBeenCalledTimes(1),
	);
	first.video.currentTime = 55;
	await act(() =>
		first.error({
			fatal: true,
			operation: "playback",
			reason: "server",
			httpStatus: 503,
			message: "HTTP error.",
		}),
	);
	expect(input.onPlaybackFailure).toHaveBeenCalledWith({
		reason: "server",
		httpStatus: 503,
	});
	fireEvent.click(view.getByRole("button", { name: "Retry" }));
	await waitFor(() => {
		expect(mockPlayer.instances[0]).not.toBe(first);
		expect(mockPlayer.instances[0]?.props().initialPositionMs).toBe(55000);
	});
});

test("expired media credentials use the host sign-in flow before retrying", async () => {
	const runtime = getClientRuntime();
	const checkSession = vi
		.spyOn(runtime.authentication, "getSession")
		.mockResolvedValue({ authenticated: false });
	const signIn = vi
		.spyOn(runtime, "onAuthRequired")
		.mockImplementation(() => {});
	const input = props();
	const view = render(<VideoPlayer {...input} />);
	const first = await mounted();
	await act(() =>
		first.error({
			fatal: true,
			operation: "load",
			reason: "credentials",
			httpStatus: 401,
			message: "Sign in required.",
		}),
	);
	fireEvent.click(view.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(signIn).toHaveBeenCalledOnce());
	expect(checkSession).toHaveBeenCalledOnce();
	expect(mockPlayer.instances).toEqual([first]);
});

test("a failed initial seek disables playback and preserves the saved position on retry", async () => {
	mockPlayer.restored = false;
	const input = props();
	const view = render(<VideoPlayer {...input} />);
	await view.findByText(
		"Your saved position could not be restored. Retry to resume playback.",
	);
	const first = await mounted();
	expect(first.video.closest("[inert]")).toBeTruthy();
	expect(input.startContinuation).not.toHaveBeenCalled();
	await controller.flush();
	expect(api.savePlaybackProgress).not.toHaveBeenCalled();
	mockPlayer.restored = true;
	fireEvent.click(view.getByRole("button", { name: "Retry" }));
	await waitFor(() => {
		expect(mockPlayer.instances[0]).not.toBe(first);
		expect(mockPlayer.instances[0]?.video.currentTime).toBe(40);
		expect(input.onPlaybackRecovered).toHaveBeenCalledOnce();
	});
});

test("detaching during sidecar discovery prevents a stale player from starting", async () => {
	let finish:
		| ((result: Awaited<ReturnType<typeof media.getSubtitles>>) => void)
		| undefined;
	vi.mocked(media.getSubtitles).mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const view = render(<VideoPlayer {...props()} />);
	await waitFor(() => expect(finish).toBeDefined());
	view.unmount();
	await act(() =>
		finish?.({
			sourceVersion: session.sourceVersion,
			tracks: [],
			warnings: [],
		}),
	);
	expect(mockPlayer.instances).toHaveLength(0);
});
