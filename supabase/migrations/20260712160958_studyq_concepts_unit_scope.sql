-- Concepts belong to a unit in the single StudyQ math bank.  The same concept
-- label may legitimately be reused in another unit, just like problem types.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'content.concepts'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (book_id, name)'
  loop
    execute format(
      'alter table content.concepts drop constraint %I',
      constraint_name
    );
  end loop;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'content.concepts'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (book_id, unit_id, name)'
  ) then
    alter table content.concepts
      add constraint concepts_book_unit_name_key
      unique (book_id, unit_id, name);
  end if;
end;
$$;
