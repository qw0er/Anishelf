import type * as React from "react";
import { cn } from "../../lib/utils.js";

type Variant = "default" | "secondary" | "outline" | "ghost";

export function buttonStyles(variant: Variant = "default", className?: string) {
	return cn(
		"inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
		variant === "default" &&
			"bg-primary text-primary-foreground hover:bg-primary/90",
		variant === "secondary" &&
			"bg-secondary text-secondary-foreground hover:bg-secondary/80",
		variant === "outline" &&
			"border bg-background hover:bg-accent hover:text-accent-foreground",
		variant === "ghost" && "hover:bg-accent hover:text-accent-foreground",
		className,
	);
}

export function Button({
	variant = "default",
	className,
	...props
}: React.ComponentProps<"button"> & { variant?: Variant }) {
	return <button className={buttonStyles(variant, className)} {...props} />;
}
