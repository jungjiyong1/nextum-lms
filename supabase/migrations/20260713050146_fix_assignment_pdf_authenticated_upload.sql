-- Resumable assignment PDF uploads use the signed-in actor's Auth JWT.
-- Staff may upload any pending job in their academy; teachers/instructors may
-- only upload jobs they created themselves. Objects remain immutable afterward.

drop policy if exists assignment_files_objects_insert on storage.objects;
create policy assignment_files_objects_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assignment-files'
    and split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and split_part(name, '/', 2) = 'match-jobs'
    and split_part(name, '/', 3) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and split_part(name, '/', 4) = 'source.pdf'
    and exists (
      select 1
      from learning.assignment_match_jobs job
      where job.id = split_part(storage.objects.name, '/', 3)::uuid
        and job.academy_id = split_part(storage.objects.name, '/', 1)::uuid
        and job.file_path = storage.objects.name
        and job.status in ('upload_pending', 'uploaded', 'failed')
        and (
          job.academy_id in (
            select private.current_academy_ids(array['owner', 'admin', 'staff'])
          )
          or (
            job.created_by = core.current_person_id()
            and job.academy_id in (
              select private.current_academy_ids(array['teacher', 'instructor'])
            )
          )
        )
    )
  );
