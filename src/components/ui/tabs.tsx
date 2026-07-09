import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "../../lib/utils"

/**
 * Modern Tabs Component
 * 
 * Design Features:
 * - Clean, minimal segmented control design
 * - Lightweight CSS transitions for the active tab indicator
 * - Theme-aware colors from design system
 * - Intuitive hover/focus states
 */

const TabsContext = React.createContext<{
    activeValue?: string;
    variant?: "default" | "pills" | "underline";
}>({});

interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
    variant?: "default" | "pills" | "underline";
}

const Tabs = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Root>,
    TabsProps
>(({ className, value, onValueChange, defaultValue, variant = "default", ...props }, ref) => {
    const [activeValue, setActiveValue] = React.useState<string | undefined>(value || defaultValue);

    React.useEffect(() => {
        if (value !== undefined) {
            setActiveValue(value);
        }
    }, [value]);

    const handleValueChange = (val: string) => {
        setActiveValue(val);
        onValueChange?.(val);
    };

    return (
        <TabsContext.Provider value={{ activeValue, variant }}>
            <TabsPrimitive.Root
                ref={ref}
                className={className}
                value={value}
                defaultValue={defaultValue}
                onValueChange={handleValueChange}
                {...props}
            />
        </TabsContext.Provider>
    )
})
Tabs.displayName = TabsPrimitive.Root.displayName

const TabsList = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.List>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
    const { variant } = React.useContext(TabsContext);

    const variantStyles = {
        default: "bg-muted/70 border-0",
        pills: "bg-transparent gap-2 border-0",
        underline: "bg-transparent border-b border-border rounded-none gap-0",
    };

    return (
        <TabsPrimitive.List
            ref={ref}
            className={cn(
                "relative inline-flex h-10 items-center justify-start rounded-xl p-1 text-muted-foreground",
                variantStyles[variant || "default"],
                className
            )}
            {...props}
        />
    )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, value, children, ...props }, ref) => {
    const { activeValue, variant } = React.useContext(TabsContext);
    const isActive = activeValue === value;

    // Variant-specific styles
    const getVariantStyles = () => {
        switch (variant) {
            case "pills":
                return {
                    trigger: cn(
                        "rounded-md px-4 py-2 border-0",
                        isActive
                            ? "text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    ),
                    indicator: "rounded-md bg-primary",
                };
            case "underline":
                return {
                    trigger: cn(
                        "rounded-none px-4 py-2.5 border-b-2 -mb-px border-0",
                        isActive
                            ? "text-primary border-b-primary"
                            : "text-muted-foreground border-b-transparent hover:text-foreground hover:border-b-border"
                    ),
                    indicator: "absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full",
                };
            default:
                return {
                    trigger: cn(
                        "rounded-md px-3.5 py-1.5 border-0",
                        isActive
                            ? "text-primary-strong"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    ),
                    indicator: "rounded-md bg-primary-soft",
                };
        }
    };

    const styles = getVariantStyles();

    return (
        <TabsPrimitive.Trigger
            ref={ref}
            value={value}
            className={cn(
                // Base styles - ensure NO border
                "group relative inline-flex appearance-none items-center justify-center whitespace-nowrap",
                "text-sm font-semibold border-0 outline-none",
                "transition-all duration-200 ease-out",
                "focus-visible:ring-0",
                "disabled:pointer-events-none disabled:opacity-50",
                "select-none cursor-pointer",
                styles.trigger,
                className
            )}
            {...props}
        >
            {/* Text content */}
            <span className={cn(
                "relative z-20 transition-all duration-200",
                isActive && "font-semibold"
            )}>
                {children}
            </span>

            <span
                aria-hidden="true"
                className={cn(
                    "pointer-events-none z-10 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                    variant === "underline"
                        ? cn(styles.indicator, "origin-left")
                        : cn("absolute inset-0 origin-center", styles.indicator),
                    isActive
                        ? "scale-100 opacity-100"
                        : variant === "underline"
                            ? "scale-x-0 opacity-0"
                            : "scale-[0.96] opacity-0",
                )}
            />

            {/* Hover effect (subtle) - only for inactive tabs */}
            {!isActive && (
                <span className={cn(
                    "absolute inset-0 rounded-lg opacity-0 transition-opacity duration-200",
                    "bg-muted",
                    "group-hover:opacity-100"
                )} />
            )}
        </TabsPrimitive.Trigger>
    )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
    <TabsPrimitive.Content
        ref={ref}
        className={cn(
            "mt-4",
            "focus-visible:outline-none focus-visible:ring-0",
            "data-[state=inactive]:hidden",
            className
        )}
        {...props}
    />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
