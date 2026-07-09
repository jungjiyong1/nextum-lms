import { Skeleton, SkeletonPanel } from '@/components/ui/skeleton';

export default function Loading() {
    return (
        <div className="flex min-h-screen bg-background p-6" aria-busy="true" aria-label="화면 불러오는 중">
            <div className="mx-auto w-full max-w-6xl space-y-8">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-4 w-64 max-w-full" />
                </div>
                <div className="grid gap-5 xl:grid-cols-[0.9fr_1.5fr]">
                    <SkeletonPanel rows={5} />
                    <SkeletonPanel rows={7} />
                </div>
            </div>
        </div>
    );
}
