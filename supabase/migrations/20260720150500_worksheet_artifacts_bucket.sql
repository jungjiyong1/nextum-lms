-- Private bucket for rendered worksheet artifacts (student PDFs, answer keys,
-- batch ZIPs). Worksheet artifacts are learning evidence and must never be
-- swept by the assignment-match cleanup cron; keeping them in their own
-- bucket enforces that isolation.
--
-- No storage.objects policies are added: the LMS server (service role) is the
-- only writer, and every read goes through short-lived signed URLs issued by
-- authorized Route Handlers. Direct authenticated access stays denied.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'worksheet-artifacts',
  'worksheet-artifacts',
  false,
  52428800,
  array['application/pdf', 'application/zip']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
