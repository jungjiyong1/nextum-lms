import React, { Component, ErrorInfo, ReactNode } from "react"
import { AlertTriangle, ChevronDown, RefreshCw } from "lucide-react"

import { Button } from "./ui/button"

interface Props {
    children?: ReactNode
    fallback?: ReactNode
    onReset?: () => void
}

interface State {
    hasError: boolean
    error: Error | null
    errorInfo: ErrorInfo | null
    showDetails: boolean
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
        showDetails: false,
    }

    public static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error }
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo)
        this.setState({ error, errorInfo })
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false })
        this.props.onReset?.()
    }

    private toggleDetails = () => {
        this.setState((prev) => ({ showDetails: !prev.showDetails }))
    }

    public render() {
        if (!this.state.hasError) return this.props.children

        if (this.props.fallback) return this.props.fallback

        return (
            <div className="m-4 flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 p-8 text-center">
                <AlertTriangle className="mb-4 h-12 w-12 text-destructive" />
                <h2 className="mb-2 text-lg font-semibold text-destructive">화면을 표시하지 못했습니다</h2>
                <p className="mb-4 max-w-md text-sm text-destructive">
                    예상하지 못한 오류가 발생했습니다. 다시 시도하거나 페이지를 새로고침해 주세요.
                </p>

                <div className="mb-4 flex gap-3">
                    <Button onClick={this.handleReset} variant="destructive">
                        <RefreshCw className="h-4 w-4" />
                        다시 시도
                    </Button>
                    <Button onClick={() => window.location.reload()} variant="outline">
                        새로고침
                    </Button>
                </div>

                <Button
                    onClick={this.toggleDetails}
                    variant="ghost"
                    size="xs"
                    className="text-destructive hover:text-destructive"
                >
                    <ChevronDown className={`h-3 w-3 transition-transform ${this.state.showDetails ? "rotate-180" : ""}`} />
                    오류 정보
                </Button>

                {this.state.showDetails && (
                    <pre className="mt-3 max-h-48 w-full max-w-full overflow-auto rounded-xl bg-card p-3 text-left text-xs text-destructive">
                        {this.state.error?.toString()}
                        {this.state.errorInfo?.componentStack}
                    </pre>
                )}
            </div>
        )
    }
}
