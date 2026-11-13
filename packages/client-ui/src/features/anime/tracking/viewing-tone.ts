import type { StatusTone } from "../../../shared/components/ui/status-badge.js";
export function viewingTone(status: string): StatusTone {
	switch (status) {
		case "watching":
			return "primary";
		case "completed":
			return "success";
		case "paused":
			return "warning";
		case "rewatching":
			return "info";
		default:
			return "neutral";
	}
}
