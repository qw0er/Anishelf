import { Menu } from "@base-ui/react/menu";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<Menu.Portal keepMounted>
			<Menu.Positioner align="end" sideOffset={4} className="z-50">
				<Menu.Popup className="min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none">
					{children}
				</Menu.Popup>
			</Menu.Positioner>
		</Menu.Portal>
	);
}

export function DropdownMenuItem({ className, ...props }: Menu.Item.Props) {
	return (
		<Menu.Item
			className={(state) =>
				`flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50 ${typeof className === "function" ? className(state) : (className ?? "")}`
			}
			{...props}
		/>
	);
}
