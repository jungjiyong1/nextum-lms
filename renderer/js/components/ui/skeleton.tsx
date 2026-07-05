import { cn } from "../../lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'text' | 'card' | 'table' | 'avatar' | 'list';
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
            className={cn(
                "animate-shimmer bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] rounded-md",
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

export { Skeleton, SkeletonList }

