import type { MoviElement } from "movi-player/element";

/** Keep application portals in the same fullscreen tree as the player controls. */
export function bindFullscreen(
	player: MoviElement,
	surface: HTMLElement,
	onChange: (active: boolean) => void,
) {
	let viewport = false;
	let disposed = false;
	let requesting = false;
	const oldOverflow = document.body.style.overflow;
	const exitOwnedFullscreen = () => {
		if (document.fullscreenElement === surface)
			void document.exitFullscreen().catch(() => {});
	};
	const sync = () => {
		if (disposed) return;
		const active = document.fullscreenElement === surface || viewport;
		player.setHostFullscreen(active);
		onChange(active);
	};
	const fillViewport = (active: boolean) => {
		viewport = active;
		surface.toggleAttribute("data-viewport-fullscreen", active);
		document.body.style.overflow = active ? "hidden" : oldOverflow;
		sync();
	};
	const toggle = (event: Event) => {
		event.preventDefault();
		if (viewport) {
			fillViewport(false);
			return;
		}
		if (document.fullscreenElement === surface) {
			exitOwnedFullscreen();
			return;
		}
		if (requesting) return;
		if (!surface.requestFullscreen || !document.fullscreenEnabled) {
			fillViewport(true);
			return;
		}
		requesting = true;
		void surface
			.requestFullscreen()
			.then(() => {
				if (disposed) exitOwnedFullscreen();
				else sync();
			})
			.catch(() => {
				if (!disposed) fillViewport(true);
			})
			.finally(() => {
				requesting = false;
			});
	};
	const handleEscape = (event: KeyboardEvent) => {
		if (event.key === "Escape" && viewport) fillViewport(false);
	};
	player.addEventListener("movi-fullscreen-request", toggle);
	document.addEventListener("fullscreenchange", sync);
	document.addEventListener("keydown", handleEscape);
	return () => {
		if (disposed) return;
		disposed = true;
		player.removeEventListener("movi-fullscreen-request", toggle);
		document.removeEventListener("fullscreenchange", sync);
		document.removeEventListener("keydown", handleEscape);
		if (viewport) {
			viewport = false;
			surface.removeAttribute("data-viewport-fullscreen");
			document.body.style.overflow = oldOverflow;
		}
		exitOwnedFullscreen();
		player.setHostFullscreen(false);
		onChange(false);
	};
}
