import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, ChevronDown } from "lucide-react";

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
    onReset?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
    showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
        showDetails: false
    };

    public static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ error, errorInfo });
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
        this.props.onReset?.();
    };

    private toggleDetails = () => {
        this.setState(prev => ({ showDetails: !prev.showDetails }));
    };

    public render() {
        if (this.state.hasError) {
            // Custom fallback provided
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default error UI
            return (
                <div className="flex flex-col items-center justify-center min-h-[200px] p-8 bg-red-50 border border-red-200 rounded-lg m-4">
                    <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
                    <h2 className="text-lg font-semibold text-red-800 mb-2">
                        문제가 발생했습니다
                    </h2>
                    <p className="text-sm text-red-600 mb-4 text-center max-w-md">
                        예기치 않은 오류가 발생했습니다. 페이지를 새로고침하거나 다시 시도해주세요.
                    </p>

                    <div className="flex gap-3 mb-4">
                        <button
                            onClick={this.handleReset}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm font-medium"
                        >
                            <RefreshCw className="h-4 w-4" />
                            다시 시도
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-white border border-red-300 text-red-700 rounded-md hover:bg-red-50 transition-colors text-sm font-medium"
                        >
                            페이지 새로고침
                        </button>
                    </div>

                    {/* Error details (collapsible) */}
                    <button
                        onClick={this.toggleDetails}
                        className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                    >
                        <ChevronDown className={`h-3 w-3 transition-transform ${this.state.showDetails ? 'rotate-180' : ''}`} />
                        세부정보
                    </button>

                    {this.state.showDetails && (
                        <pre className="mt-3 p-3 bg-red-100 rounded text-xs text-red-800 max-w-full overflow-auto max-h-48 w-full">
                            {this.state.error?.toString()}
                            {this.state.errorInfo?.componentStack}
                        </pre>
                    )}
                </div>
            );
        }

        return this.props.children;
    }
}

