import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "../../lib/utils.js";

type Variant = "default" | "secondary" | "outline" | "ghost";

type Size = "default" | "sm" | "icon";
const sizes: Record<Size, string> = {
	default: "h-9 px-4",
	sm: "h-8 px-3 text-xs",
	icon: "icon-control",
};
export function buttonStyles(
	variant: Variant = "default",
	className?: string,
	size: Size = "default",
) {
	return cn(
		"inline-flex touch-control items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
		sizes[size],
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
	size = "default",
	className,
	...props
}: ButtonPrimitive.Props & { variant?: Variant; size?: Size }) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={(state) =>
				buttonStyles(
					variant,
					typeof className === "function" ? className(state) : className,
					size,
				)
			}
			{...props}
		/>
	);
}
