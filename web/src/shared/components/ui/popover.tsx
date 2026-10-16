import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "cn";
import type * as React from "react";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
	className,
	children,
	...props
}: Omit<PopoverPrimitive.Popup.Props, "className"> & { className?: string }) {
	return (
		<PopoverPrimitive.Portal data-slot="popover-portal">
			<PopoverPrimitive.Positioner
				align="start"
				side="bottom"
				sideOffset={6}
				className="z-50"
			>
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					className={cn(
						"grid w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-md border bg-popover p-4 text-sm text-popover-foreground shadow-md outline-none",
						className,
					)}
					{...props}
				>
					{children}
				</PopoverPrimitive.Popup>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

function PopoverTitle({
	className,
	...props
}: Omit<PopoverPrimitive.Title.Props, "className"> & {
	className?: string;
}): React.ReactElement {
	return (
		<PopoverPrimitive.Title
			data-slot="popover-title"
			className={cn("font-medium", className)}
			{...props}
		/>
	);
}

export { Popover, PopoverContent, PopoverTitle, PopoverTrigger };
