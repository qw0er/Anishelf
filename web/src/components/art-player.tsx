import Artplayer from "artplayer";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiClientError, getFile, isRequestCancelled } from "../api/client.js";
import type { FileResponse } from "../api/contracts.js";
import { getErrorTranslationKey } from "../lib/error-translation.js";

// Retry is an explicit application action; omit the unrelated context menu.
Artplayer.RECONNECT_TIME_MAX = 0;
Artplayer.CONTEXTMENU = false;

function enableKeyboardControls(player: Artplayer) {
	const video = player.video;
	video.tabIndex = 0;
	player.proxy(video, "keydown", (event) => {
		const key = event as KeyboardEvent;
		if (key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) return;
		switch (key.code) {
			case "Space":
				player.toggle();
				break;
			case "ArrowLeft":
				player.backward = 5;
				break;
			case "ArrowRight":
				player.forward = 5;
				break;
			case "ArrowUp":
				player.volume += 0.1;
				break;
			case "ArrowDown":
				player.volume -= 0.1;
				break;
			default:
				return;
		}
		key.preventDefault();
	});
	for (const name of ["playAndPause", "fullscreen"]) {
		const control = player.query<HTMLElement>(`.art-control-${name}`);
		if (!control) continue;
		control.tabIndex = 0;
		control.setAttribute("role", "button");
		// ArtPlayer's tooltip labels are omitted on mobile devices.
		if (name === "playAndPause") {
			control.setAttribute("aria-label", "Play");
			player.on("video:play", () =>
				control.setAttribute("aria-label", "Pause"),
			);
			player.on("video:pause", () =>
				control.setAttribute("aria-label", "Play"),
			);
		} else {
			control.setAttribute("aria-label", "Fullscreen");
			player.on("fullscreen", (active) =>
				control.setAttribute(
					"aria-label",
					active ? "Exit Fullscreen" : "Fullscreen",
				),
			);
		}
		player.proxy(control, "keydown", (event) => {
			const key = event as KeyboardEvent;
			if (key.code === "Enter" || key.code === "Space") {
				key.preventDefault();
				control.click();
			}
		});
	}
	player.proxy(player.template.$player, "focusin", () => {
		player.controls.show = true;
	});
}

export default function ArtPlayer({
	file,
	playbackUrl,
	onMedia,
}: FileResponse & { onMedia?(video: HTMLVideoElement | null): void }) {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let errorRequest: AbortController | null = null;
		const player = new Artplayer({
			container,
			url: playbackUrl,
			lang: "en",
			fullscreen: true,
			hotkey: false,
			autoPlayback: false,
			moreVideoAttr: {
				preload: "metadata",
			},
		});
		player.video.setAttribute(
			"aria-label",
			t("player.videoLabel", { name: file.name }),
		);
		enableKeyboardControls(player);
		onMedia?.(player.video);
		player.on("video:error", async () => {
			setError(t("errors.mediaPlayback"));
			errorRequest?.abort();
			const controller = new AbortController();
			errorRequest = controller;
			try {
				await getFile(file.id, { signal: controller.signal });
			} catch (error) {
				if (controller.signal.aborted || isRequestCancelled(error)) return;
				if (error instanceof ApiClientError)
					setError(t(getErrorTranslationKey(error) ?? "errors.requestFailed"));
			}
		});
		return () => {
			errorRequest?.abort();
			onMedia?.(null);
			player.pause();
			player.destroy();
		};
	}, [file.id, file.name, playbackUrl, t, onMedia]);

	return (
		<>
			<div
				ref={containerRef}
				className="anishelf-player aspect-video max-h-[75vh] w-full bg-black"
			/>
			{error && (
				<p className="text-base text-destructive" role="alert">
					{error}
				</p>
			)}
		</>
	);
}
