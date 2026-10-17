import { useEffect } from "react";
import { loadAuthSession } from "../../shared/api/client.js";

const checkIntervalMs = 5 * 60_000;
const minimumCheckGapMs = 30_000;

/** Revalidate visible sessions on return, with a slow fallback for idle pages. */
export function useSessionCheck() {
	useEffect(() => {
		let active = true;
		let checking = false;
		let lastCheck = Date.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		function schedule() {
			clearTimeout(timer);
			if (active && document.visibilityState !== "hidden")
				timer = setTimeout(check, checkIntervalMs);
		}
		function check() {
			if (!active || document.visibilityState === "hidden") return;
			if (checking) return;
			if (Date.now() - lastCheck < minimumCheckGapMs) {
				schedule();
				return;
			}
			checking = true;
			lastCheck = Date.now();
			void loadAuthSession()
				.then((session) => {
					if (active && !session.authenticated)
						window.dispatchEvent(new Event("anishelf:auth-required"));
				})
				.catch(() => {})
				.finally(() => {
					checking = false;
					schedule();
				});
		}
		function visibilityChanged() {
			clearTimeout(timer);
			if (document.visibilityState !== "hidden") check();
		}
		schedule();
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", visibilityChanged);
		return () => {
			active = false;
			clearTimeout(timer);
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", visibilityChanged);
		};
	}, []);
}
