import { useLayoutEffect, useRef } from "react";

/** Measure translated labels before choosing the compact navigation layout. */
export function useCompactNavigation() {
	const ref = useRef<HTMLElement>(null);
	const previous = useRef<boolean | undefined>(undefined);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		let active = true;
		const measure = () => {
			element.dataset.compact = "false";
			const compact = element.scrollWidth > element.clientWidth;
			element.dataset.compact = String(compact);
			if (previous.current !== compact) {
				console.debug(
					`[navigation] ${element.getAttribute("aria-label")}: ${compact ? "icons" : "labels"}.`,
				);
				previous.current = compact;
			}
		};
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		const mutations = new MutationObserver(measure);
		mutations.observe(element, {
			childList: true,
			characterData: true,
			subtree: true,
		});
		measure();
		void document.fonts.ready.then(() => {
			if (active) measure();
		});
		return () => {
			active = false;
			observer.disconnect();
			mutations.disconnect();
		};
	});
	return ref;
}
