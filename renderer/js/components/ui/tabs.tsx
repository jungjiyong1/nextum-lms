import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { motion, AnimatePresence } from "framer-motion"

import { cn } from "../../lib/utils"

/**
 * Modern Tabs Component
 * 
 * Design Features:
 * - Clean, minimal segmented control design
 * - Smooth spring animations for active tab indicator
 * - Theme-aware colors from design system
 * - Intuitive hover/focus states
 */

const TabsContext = React.createContext<{
    activeValue?: string;
    setActiveValue?: (value: string) => void;
    layoutId?: string;
    variant?: "default" | "pills" | "underline";
}>({});

interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
    layoutId?: string;
    variant?: "default" | "pills" | "underline";
}

const Tabs = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Root>,
    TabsProps
>(({ className, value, onValueChange, defaultValue, layoutId = "active-tab", variant = "default", ...props }, ref) => {
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
        <TabsContext.Provider value={{ activeValue, setActiveValue: handleValueChange, layoutId, variant }}>
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
        default: "bg-[#f0f2f1] border-0",
        pills: "bg-transparent gap-2 border-0",
        underline: "bg-transparent border-b border-[#e3e8e5] rounded-none gap-0",
    };

    return (
        <TabsPrimitive.List
            ref={ref}
            className={cn(
                "relative inline-flex h-11 items-center justify-start rounded-xl p-1 text-[#5f6b66]",
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
    const { activeValue, layoutId, variant } = React.useContext(TabsContext);
    const isActive = activeValue === value;

    // Variant-specific styles
    const getVariantStyles = () => {
        switch (variant) {
            case "pills":
                return {
                    trigger: cn(
                        "rounded-full px-4 py-2 border-0",
                        isActive
                            ? "text-white"
                            : "text-[#5f6b66] hover:text-[#1b1f1c] hover:bg-[#d6f1e2]/50"
                    ),
                    indicator: "rounded-full bg-gradient-to-r from-[#1f9d57] to-[#138a48] shadow-lg shadow-[rgba(31,157,87,0.25)]",
                };
            case "underline":
                return {
                    trigger: cn(
                        "rounded-none px-4 py-2.5 border-b-2 -mb-px border-0",
                        isActive
                            ? "text-[#1f9d57] border-b-[#1f9d57]"
                            : "text-[#5f6b66] border-b-transparent hover:text-[#1b1f1c] hover:border-b-[#e3e8e5]"
                    ),
                    indicator: "absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#1f9d57] to-[#138a48] rounded-full",
                };
            default:
                return {
                    trigger: cn(
                        "rounded-lg px-4 py-2 border-0",
                        isActive
                            ? "text-white"
                            : "text-[#5f6b66] hover:text-[#1b1f1c] hover:bg-[#e3e8e5]/60"
                    ),
                    indicator: "rounded-lg bg-gradient-to-br from-[#1f9d57] to-[#138a48] shadow-md shadow-[rgba(31,157,87,0.2)]",
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
                "group relative inline-flex items-center justify-center whitespace-nowrap",
                "text-sm font-medium border-0 outline-none",
                "transition-all duration-200 ease-out",
                "focus-visible:ring-2 focus-visible:ring-[#1f9d57]/40 focus-visible:ring-offset-1",
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

            {/* Active indicator with animation */}
            <AnimatePresence mode="wait">
                {isActive && variant !== "underline" && (
                    <motion.div
                        layoutId={layoutId}
                        className={cn("absolute inset-0 z-10", styles.indicator)}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{
                            type: "spring",
                            stiffness: 350,
                            damping: 28,
                            mass: 0.8,
                        }}
                    />
                )}
                {isActive && variant === "underline" && (
                    <motion.div
                        layoutId={layoutId}
                        className={styles.indicator}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        exit={{ scaleX: 0 }}
                        transition={{
                            type: "spring",
                            stiffness: 450,
                            damping: 32,
                        }}
                    />
                )}
            </AnimatePresence>

            {/* Hover effect (subtle) - only for inactive tabs */}
            {!isActive && (
                <span className={cn(
                    "absolute inset-0 rounded-lg opacity-0 transition-opacity duration-200",
                    "bg-[#1f9d57]/5",
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
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f9d57]/40 focus-visible:ring-offset-1",
            "data-[state=inactive]:hidden",
            className
        )}
        {...props}
    />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
