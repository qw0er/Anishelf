import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "../../lib/utils.js";

export function Input({ className, ...props }: InputPrimitive.Props) {
	return (
		<InputPrimitive
			data-slot="input"
			className={(state) =>
				cn(
					"h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs md:text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
					typeof className === "function" ? className(state) : className,
				)
			}
			{...props}
		/>
	);
}
