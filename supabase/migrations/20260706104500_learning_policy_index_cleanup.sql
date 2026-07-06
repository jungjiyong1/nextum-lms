-- Avoid duplicate permissive SELECT policies created by broad FOR ALL write
-- policies, and add indexes for newly introduced learning foreign keys.

create index if not exists learning_assignment_files_assignment_idx
  on learning.assignment_files (assignment_id, display_order);
create index if not exists learning_assignment_items_book_idx
  on learning.assignment_items (book_id)
  where book_id is not null;
create index if not exists learning_assignment_items_unit_idx
  on learning.assignment_items (unit_id)
  where unit_id is not null;
create index if not exists learning_book_assignments_assigned_by_idx
  on learning.book_assignments (assigned_by)
  where assigned_by is not null;

drop policy if exists learning_book_assignments_write on learning.book_assignments;
create policy learning_book_assignments_insert on learning.book_assignments for insert to authenticated
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy learning_book_assignments_update on learning.book_assignments for update to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy learning_book_assignments_delete on learning.book_assignments for delete to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']));

drop policy if exists learning_assignments_write on learning.assignments;
create policy learning_assignments_insert on learning.assignments for insert to authenticated
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy learning_assignments_update on learning.assignments for update to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy learning_assignments_delete on learning.assignments for delete to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']));

drop policy if exists learning_assignment_targets_write on learning.assignment_targets;
create policy learning_assignment_targets_insert on learning.assignment_targets for insert to authenticated
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );
create policy learning_assignment_targets_update on learning.assignment_targets for update to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  )
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );
create policy learning_assignment_targets_delete on learning.assignment_targets for delete to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );

drop policy if exists learning_assignment_items_write on learning.assignment_items;
create policy learning_assignment_items_insert on learning.assignment_items for insert to authenticated
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_items.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );
create policy learning_assignment_items_update on learning.assignment_items for update to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_items.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  )
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_items.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );
create policy learning_assignment_items_delete on learning.assignment_items for delete to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_items.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );

drop policy if exists learning_assignment_files_write on learning.assignment_files;
create policy learning_assignment_files_insert on learning.assignment_files for insert to authenticated
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_files.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );
create policy learning_assignment_files_update on learning.assignment_files for update to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_files.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  )
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_files.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );
create policy learning_assignment_files_delete on learning.assignment_files for delete to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_files.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );
