export function registerPwa() {
	if (import.meta.env.PROD && "serviceWorker" in navigator) {
		const wasControlled = Boolean(navigator.serviceWorker.controller);
		if (wasControlled) {
			navigator.serviceWorker.addEventListener("controllerchange", () => {
				console.info("Updated service worker activated; reloading the page.");
				window.location.reload();
			});
		}
		window.addEventListener("load", () => {
			navigator.serviceWorker.register("/sw.js").then(
				(registration) => {
					console.info("Service worker registered.");
					const checkForUpdate = () => {
						if (document.visibilityState === "visible") {
							registration
								.update()
								.catch((error) =>
									console.warn("Service worker update check failed:", error),
								);
						}
					};
					checkForUpdate();
					document.addEventListener("visibilitychange", checkForUpdate);
				},
				(error) => console.error("Service worker registration failed:", error),
			);
		});
	}
}
