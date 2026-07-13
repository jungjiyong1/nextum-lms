drop policy if exists assignment_match_batches_staff_select
  on learning.assignment_match_batches;
drop policy if exists assignment_match_batches_instructor_select
  on learning.assignment_match_batches;

create policy assignment_match_batches_select
  on learning.assignment_match_batches for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      created_by = core.current_person_id()
      and academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
    )
  );

drop policy if exists assignment_match_jobs_staff_select
  on learning.assignment_match_jobs;
drop policy if exists assignment_match_jobs_instructor_select
  on learning.assignment_match_jobs;

create policy assignment_match_jobs_select
  on learning.assignment_match_jobs for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      created_by = core.current_person_id()
      and academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
    )
  );

drop policy if exists assignment_match_items_staff_select
  on learning.assignment_match_items;
drop policy if exists assignment_match_items_instructor_select
  on learning.assignment_match_items;

create policy assignment_match_items_select
  on learning.assignment_match_items for select to authenticated
  using (
    exists (
      select 1
      from learning.assignment_match_jobs job
      where job.id = job_id
        and (
          job.academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
          or (
            job.created_by = core.current_person_id()
            and job.academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
          )
        )
    )
  );
