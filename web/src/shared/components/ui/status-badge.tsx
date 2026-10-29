import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";
import { Badge } from "./badge.js";

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
		<Badge
			variant="secondary"
			className={cn("h-auto min-h-5 leading-4", tones[tone], className)}
			{...props}
		/>
	);
}
