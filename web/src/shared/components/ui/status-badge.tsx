import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export type StatusTone =
	| "neutral"
	| "primary"
	| "success"
	| "warning"
	| "info"
	| "error";
const tones: Record<StatusTone, string> = {
	neutral: "bg-muted text-muted-foreground",
	primary: "bg-primary/10 text-primary",
	success: "bg-success/10 text-success",
	warning: "bg-warning/10 text-warning",
	info: "bg-info/10 text-info",
	error: "bg-destructive/10 text-destructive",
};
export function StatusBadge({
	tone = "neutral",
	className,
	...props
}: ComponentProps<"span"> & { tone?: StatusTone }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-4",
				tones[tone],
				className,
			)}
			{...props}
		/>
	);
}
