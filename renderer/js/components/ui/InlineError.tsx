import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './button';
import { cn } from '../../lib/utils';

interface InlineErrorProps {
    message: string;
    onRetry?: () => void;
    className?: string;
    variant?: 'default' | 'subtle' | 'minimal';
}

/**
 * 인라인 에러 표시 컴포넌트
 * - 로딩 실패, API 에러 등을 표시할 때 사용
 * - 선택적으로 재시도 버튼 제공
 */
export function InlineError({
    message,
    onRetry,
    className,
    variant = 'default'
}: InlineErrorProps) {
    if (variant === 'minimal') {
        return (
            <p className={cn("text-sm text-destructive", className)}>
                {message}
            </p>
        );
    }

    if (variant === 'subtle') {
        return (
            <div className={cn(
                "flex items-center gap-2 text-sm text-muted-foreground",
                className
            )}>
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span>{message}</span>
                {onRetry && (
                    <button
                        onClick={onRetry}
                        className="text-primary underline hover:no-underline"
                    >
                        다시 시도
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className={cn(
            "flex flex-col items-center justify-center gap-3 p-6 text-center rounded-lg border border-destructive/20 bg-destructive/5",
            className
        )}>
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive font-medium">{message}</p>
            {onRetry && (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onRetry}
                    className="gap-2"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                    다시 시도
                </Button>
            )}
        </div>
    );
}
