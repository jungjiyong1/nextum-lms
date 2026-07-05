import * as React from "react"
import { cn } from "../../lib/utils"

interface ContextMenuProps {
    open: boolean
    x: number
    y: number
    onClose: () => void
    children: React.ReactNode
    /** Reference element to anchor the menu position during scroll */
    containerRef?: React.RefObject<HTMLElement>
}

export function ContextMenu({ open, x, y, onClose, children, containerRef }: ContextMenuProps) {
    const menuRef = React.useRef<HTMLDivElement>(null)
    const [position, setPosition] = React.useState({ x, y })

    // Adjust position to stay within viewport
    React.useLayoutEffect(() => {
        if (open && menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect()
            const viewportWidth = window.innerWidth
            const viewportHeight = window.innerHeight

            let newX = x
            let newY = y

            // Keep menu within viewport bounds
            if (x + rect.width > viewportWidth - 8) {
                newX = x - rect.width
            }
            if (y + rect.height > viewportHeight - 8) {
                newY = y - rect.height
            }
            if (newX < 8) newX = 8
            if (newY < 8) newY = 8

            setPosition({ x: newX, y: newY })
        }
    }, [open, x, y])

    // Close on scroll (instead of following)
    React.useEffect(() => {
        if (!open) return

        const handleScroll = () => {
            onClose()
        }

        // Listen to scroll on capture phase to catch all scrolls
        window.addEventListener('scroll', handleScroll, true)

        return () => {
            window.removeEventListener('scroll', handleScroll, true)
        }
    }, [open, onClose])

    // Close on click outside or Escape
    React.useEffect(() => {
        if (!open) return

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose()
            }
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }

        // Delay to prevent immediate close
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside)
            document.addEventListener('keydown', handleKeyDown)
        }, 0)

        return () => {
            clearTimeout(timer)
            document.removeEventListener('mousedown', handleClickOutside)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [open, onClose])

    if (!open) return null

    return (
        <div
            ref={menuRef}
            className="fixed z-[9999] min-w-[180px] overflow-hidden rounded-lg py-1"
            style={{
                left: position.x,
                top: position.y,
                backgroundColor: '#ffffff',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
            }}
            onClick={(e) => {
                // Only stop propagation if not targeting an input element
                if (!(e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) {
                    e.stopPropagation();
                }
            }}
            onMouseDown={(e) => {
                // Allow input elements to receive focus
                if (!(e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) {
                    e.stopPropagation();
                }
            }}
            onPointerDown={(e) => {
                // Allow input elements to receive focus
                if (!(e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) {
                    e.stopPropagation();
                }
            }}
            onPointerUp={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
        >
            {children}
        </div>
    )
}

interface ContextMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: React.ReactNode
    label: string
    shortcut?: string
    variant?: 'default' | 'danger'
}

export function ContextMenuItem({
    icon,
    label,
    shortcut,
    variant = 'default',
    className,
    disabled,
    ...props
}: ContextMenuItemProps) {
    return (
        <button
            type="button"
            className={cn(
                "w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px]",
                "text-left cursor-pointer",
                "transition-colors duration-75",
                variant === 'default' && "text-gray-700",
                variant === 'danger' && "text-red-600",
                disabled && "opacity-40 cursor-not-allowed",
                className
            )}
            style={{
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                margin: 0,
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                appearance: 'none',
            }}
            onMouseEnter={(e) => {
                if (!disabled) {
                    e.currentTarget.style.backgroundColor = variant === 'danger' ? '#fef2f2' : '#f3f4f6'
                }
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
            }}
            disabled={disabled}
            {...props}
        >
            {icon && (
                <span className="w-4 h-4 flex items-center justify-center shrink-0 opacity-60">
                    {icon}
                </span>
            )}
            <span className="flex-1 truncate">{label}</span>
            {shortcut && (
                <span className="text-[11px] text-gray-400 ml-auto pl-4">
                    {shortcut}
                </span>
            )}
        </button>
    )
}

export function ContextMenuSeparator() {
    return <div className="h-px my-1 mx-2" style={{ backgroundColor: '#e5e7eb' }} />
}

interface ContextMenuLabelProps {
    children: React.ReactNode
}

export function ContextMenuLabel({ children }: ContextMenuLabelProps) {
    return (
        <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>
            {children}
        </div>
    )
}
