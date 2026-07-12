-- Avoid evaluating an ALL policy alongside the dedicated SELECT policy.
-- Mutations retain the same authorization predicates as the initial rollout.

drop policy if exists class_target_grades_write on lms.class_target_grades;
create policy class_target_grades_insert on lms.class_target_grades
for insert to authenticated
with check (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);
create policy class_target_grades_update on lms.class_target_grades
for update to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
)
with check (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);
create policy class_target_grades_delete on lms.class_target_grades
for delete to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);

drop policy if exists class_instructors_write on lms.class_instructors;
create policy class_instructors_insert on lms.class_instructors
for insert to authenticated
with check (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])));
create policy class_instructors_update on lms.class_instructors
for update to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])))
with check (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])));
create policy class_instructors_delete on lms.class_instructors
for delete to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])));

drop policy if exists rule_instructors_write on lms.class_schedule_rule_instructors;
create policy rule_instructors_insert on lms.class_schedule_rule_instructors
for insert to authenticated
with check (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);
create policy rule_instructors_update on lms.class_schedule_rule_instructors
for update to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
)
with check (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);
create policy rule_instructors_delete on lms.class_schedule_rule_instructors
for delete to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);

drop policy if exists occurrence_instructors_write on lms.lesson_occurrence_instructors;
create policy occurrence_instructors_insert on lms.lesson_occurrence_instructors
for insert to authenticated
with check (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);
create policy occurrence_instructors_update on lms.lesson_occurrence_instructors
for update to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
)
with check (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);
create policy occurrence_instructors_delete on lms.lesson_occurrence_instructors
for delete to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);

drop policy if exists instructor_pay_rates_write on lms.instructor_pay_rates;
create policy instructor_pay_rates_insert on lms.instructor_pay_rates
for insert to authenticated
with check (academy_id in (select private.current_academy_ids(array['owner','admin'])));
create policy instructor_pay_rates_update on lms.instructor_pay_rates
for update to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin'])))
with check (academy_id in (select private.current_academy_ids(array['owner','admin'])));
create policy instructor_pay_rates_delete on lms.instructor_pay_rates
for delete to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin'])));

-- PostgreSQL does not automatically index referencing columns. These indexes
-- cover the composite tenant-safe foreign keys used by deletes and joins.
create index class_target_grades_class_academy_fk_idx
  on lms.class_target_grades (class_id, academy_id);
create index class_instructors_class_academy_fk_idx
  on lms.class_instructors (class_id, academy_id);
create index class_instructors_staff_academy_fk_idx
  on lms.class_instructors (instructor_staff_id, academy_id);
create index rule_instructors_rule_academy_class_fk_idx
  on lms.class_schedule_rule_instructors (rule_id, academy_id, class_id);
create index rule_instructors_staff_academy_fk_idx
  on lms.class_schedule_rule_instructors (instructor_staff_id, academy_id);
create index occurrence_instructors_occurrence_academy_class_fk_idx
  on lms.lesson_occurrence_instructors (occurrence_id, academy_id, class_id);
create index occurrence_instructors_staff_academy_fk_idx
  on lms.lesson_occurrence_instructors (instructor_staff_id, academy_id);
create index occurrence_instructors_replaces_academy_fk_idx
  on lms.lesson_occurrence_instructors (replaces_staff_id, academy_id)
  where replaces_staff_id is not null;
create index instructor_pay_rates_staff_academy_fk_idx
  on lms.instructor_pay_rates (instructor_id, academy_id);
