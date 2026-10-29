import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function InlineError({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			role="alert"
			className={cn(
				"space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm",
				className,
			)}
			{...props}
		/>
	);
}
