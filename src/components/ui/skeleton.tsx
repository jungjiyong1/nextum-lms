import { cn } from "../../lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'text' | 'card' | 'table' | 'avatar' | 'list';
}

interface SkeletonRowsProps {
    count?: number;
    className?: string;
    rowClassName?: string;
}

interface SkeletonPanelProps extends React.HTMLAttributes<HTMLDivElement> {
    rows?: number;
    showHeader?: boolean;
}

const variantStyles: Record<string, string> = {
    default: 'h-4 w-full',
    text: 'h-4 w-3/4',
    card: 'h-32 w-full rounded-lg',
    table: 'h-10 w-full',
    avatar: 'h-10 w-10 rounded-full',
    list: 'h-16 w-full rounded-md',
};

function Skeleton({
    className,
    variant = 'default',
    ...props
}: SkeletonProps) {
    return (
        <div
            aria-hidden="true"
            className={cn(
                "animate-shimmer bg-gradient-to-r from-slate-100 via-slate-200 to-slate-100 bg-[length:200%_100%] rounded-md",
                variantStyles[variant],
                className
            )}
            {...props}
        />
    )
}

/**
 * 반복되는 스켈레톤 목록을 생성하는 헬퍼
 */
function SkeletonList({
    count = 3,
    variant = 'list',
    className
}: {
    count?: number;
    variant?: SkeletonProps['variant'];
    className?: string;
}) {
    return (
        <div className={cn("space-y-2", className)}>
            {Array.from({ length: count }).map((_, i) => (
                <Skeleton key={i} variant={variant} />
            ))}
        </div>
    );
}

function SkeletonRows({
    count = 3,
    className,
    rowClassName,
}: SkeletonRowsProps) {
    return (
        <div className={cn("space-y-3", className)}>
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className={cn("rounded-lg border bg-white p-4", rowClassName)}>
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-4 w-1/3" />
                            <Skeleton className="h-3 w-2/3" />
                        </div>
                        <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function SkeletonPanel({
    rows = 3,
    showHeader = true,
    className,
    ...props
}: SkeletonPanelProps) {
    return (
        <div className={cn("rounded-lg border bg-white", className)} {...props}>
            {showHeader && (
                <div className="border-b p-4">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="mt-2 h-3 w-64 max-w-full" />
                </div>
            )}
            <div className="space-y-4 p-4">
                {Array.from({ length: rows }).map((_, i) => (
                    <div key={i} className="space-y-2">
                        <Skeleton className={cn("h-4", i % 2 === 0 ? "w-3/4" : "w-1/2")} />
                        <Skeleton className="h-3 w-full" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function SkeletonPage() {
    return (
        <div className="grid min-h-[620px] gap-5 xl:grid-cols-[0.9fr_1.5fr]">
            <SkeletonPanel rows={5} />
            <SkeletonPanel rows={6} />
        </div>
    );
}

export { Skeleton, SkeletonList, SkeletonRows, SkeletonPanel, SkeletonPage }

