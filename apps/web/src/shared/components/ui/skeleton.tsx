import type * as React from "react";
import { cn } from "../../lib/utils.js";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			aria-hidden="true"
			className={cn("motion-safe:animate-pulse rounded-md bg-muted", className)}
			{...props}
		/>
	);
}
