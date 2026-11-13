import { useEffect } from "react";
import { getClientRuntime } from "../../shared/api/connection.js";

const checkIntervalMs = 5 * 60_000;
const minimumCheckGapMs = 30_000;

/** Revalidate visible sessions on return, with a slow fallback for idle pages. */
export function useSessionCheck() {
	useEffect(() => {
		const { platform, authentication, onAuthRequired } = getClientRuntime();
		let active = true;
		let checking = false;
		let lastCheck = Date.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		function schedule() {
			clearTimeout(timer);
			if (active && platform.isVisible())
				timer = setTimeout(check, checkIntervalMs);
		}
		function check() {
			if (!active || !platform.isVisible()) return;
			if (checking) return;
			if (Date.now() - lastCheck < minimumCheckGapMs) {
				schedule();
				return;
			}
			checking = true;
			lastCheck = Date.now();
			void authentication
				.getSession()
				.then((session) => {
					if (active && !session.authenticated) onAuthRequired();
				})
				.catch(() => {})
				.finally(() => {
					checking = false;
					schedule();
				});
		}
		function foregroundChanged() {
			clearTimeout(timer);
			if (platform.isVisible()) check();
		}
		schedule();
		const unsubscribe = platform.onForegroundChange(foregroundChanged);
		return () => {
			active = false;
			clearTimeout(timer);
			unsubscribe();
		};
	}, []);
}
