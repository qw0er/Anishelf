export interface PwaOptions {
	production?: boolean;
	serviceWorker?: ServiceWorkerContainer;
	reload?: () => void;
}

export function registerPwa({
	production = import.meta.env.PROD,
	serviceWorker = "serviceWorker" in navigator
		? navigator.serviceWorker
		: undefined,
	reload = () => window.location.reload(),
}: PwaOptions = {}): () => void {
	if (!production || !serviceWorker) return () => {};
	const container = serviceWorker;
	let checkForUpdate: (() => void) | undefined;
	const onControllerChange = () => {
		console.info("Updated service worker activated; reloading the page.");
		reload();
	};
	const onLoad = () => {
		container.register("/sw.js").then(
			(registration) => {
				console.info("Service worker registered.");
				checkForUpdate = () => {
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
	};
	if (container.controller)
		container.addEventListener("controllerchange", onControllerChange);
	window.addEventListener("load", onLoad);
	return () => {
		container.removeEventListener("controllerchange", onControllerChange);
		window.removeEventListener("load", onLoad);
		if (checkForUpdate)
			document.removeEventListener("visibilitychange", checkForUpdate);
	};
}
