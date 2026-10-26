import { useEffect, useState } from "react";
import { interactionDefaults } from "../config/interaction-defaults.js";

/** Delay visual feedback without delaying requests, results, or disabled controls. */
export function useDelayedPending(pending: boolean, identity = "") {
	const [visibleFor, setVisibleFor] = useState<string | null>(null);

	useEffect(() => {
		setVisibleFor(null);
		if (!pending) return;
		const timer = setTimeout(
			() => setVisibleFor(identity),
			interactionDefaults.pendingDelayMs,
		);
		return () => clearTimeout(timer);
	}, [pending, identity]);

	return pending && visibleFor === identity;
}
