import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
            <section className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
                <p className="text-sm font-medium text-primary">404</p>
                <h1 className="mt-2 text-xl font-semibold">페이지를 찾을 수 없습니다</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    주소가 바뀌었거나 접근할 수 없는 화면입니다.
                </p>
                <Button asChild className="mt-6">
                    <Link href="/">대시보드로 이동</Link>
                </Button>
            </section>
        </main>
    );
}
