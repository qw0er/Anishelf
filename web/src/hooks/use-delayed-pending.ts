import { useEffect, useState } from "react";

/** Delay visual feedback without delaying requests, results, or disabled controls. */
export function useDelayedPending(pending: boolean, identity = "") {
	const [visibleFor, setVisibleFor] = useState<string | null>(null);

	useEffect(() => {
		setVisibleFor(null);
		if (!pending) return;
		const timer = setTimeout(() => setVisibleFor(identity), 200);
		return () => clearTimeout(timer);
	}, [pending, identity]);

	return pending && visibleFor === identity;
}
