import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "../../lib/utils.js";

export function Input({ className, ...props }: InputPrimitive.Props) {
	return (
		<InputPrimitive
			data-slot="input"
			className={(state) =>
				cn(
					"form-control w-full placeholder:text-muted-foreground",
					typeof className === "function" ? className(state) : className,
				)
			}
			{...props}
		/>
	);
}
