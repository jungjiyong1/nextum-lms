import { PdfAssignmentMatchPage } from '@/features/lms/pdf-assignment-match-page';
import { isPdfAssignmentMatchEnabled } from '@/lib/lms/pdf-assignment-match-feature';
import { notFound } from 'next/navigation';

export default function Page() {
    if (!isPdfAssignmentMatchEnabled()) notFound();
    return <PdfAssignmentMatchPage />;
}
