import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../../lib/utils.js";

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-input bg-input transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-checked:bg-primary",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb className="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-5" />
		</SwitchPrimitive.Root>
	);
}
