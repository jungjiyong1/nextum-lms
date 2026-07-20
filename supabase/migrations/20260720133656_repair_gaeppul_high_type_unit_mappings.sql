-- The high-school type-workbook extractor grouped rows by page-coordinate
-- ranges. A type can begin before the next unit's nominal page range, so this
-- shifted types and their problems across unit boundaries. In these books the
-- type numbering restarts at 유형01 for every unit; use that stable semantic
-- boundary to repair all seven affected imports.
do $migration$
declare
  repaired_at timestamptz;
  actual_count bigint;
  expected_count bigint;
  duplicate_count bigint;
  updated_count bigint;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '120s', true);
  perform pg_advisory_xact_lock(
    hashtextextended('content:repair-gaeppul-high-type-unit-mappings-v1', 0)
  );

  lock table
    content.books,
    content.units,
    content.concepts,
    content.problem_types,
    content.problems,
    learning.assignments,
    learning.assignment_items
  in share row exclusive mode;

  repaired_at := clock_timestamp();

  create temporary table _high_type_books
  on commit drop
  as
  select book.id, book.book_key
  from content.books book
  where book.book_key in (
      'gaeppul_high_algebra_type',
      'gaeppul_high_calculus1_type',
      'gaeppul_high_calculus2_type',
      'gaeppul_high_common1_type',
      'gaeppul_high_common2_type',
      'gaeppul_high_geometry_type',
      'gaeppul_high_probability_type'
    )
    and book.pipeline_version = 'gaeppul-text-coordinate-v2:high-type';

  select count(*) into actual_count from _high_type_books;
  if actual_count = 0 then
    -- Fresh databases (local reset, CI) never ran the affected importer, so
    -- there is nothing to repair. Only environments with partial data are an
    -- error state.
    raise notice 'No gaeppul high-type books found; skipping repair.';
    return;
  end if;
  if actual_count <> 7 then
    raise exception 'Expected 7 affected high-school type books, found %', actual_count;
  end if;

  select count(*)
  into actual_count
  from content.units unit_row
  join _high_type_books book on book.id = unit_row.book_id;
  if actual_count <> 102 then
    raise exception 'Expected 102 affected units, found %', actual_count;
  end if;

  if exists (
    select 1
    from content.units unit_row
    join _high_type_books book on book.id = unit_row.book_id
    left join content.concepts concept
      on concept.book_id = unit_row.book_id
     and concept.unit_id = unit_row.id
     and concept.name = '유형 문제'
    group by unit_row.id
    having count(concept.id) <> 1
  ) then
    raise exception 'Every affected unit must have exactly one 유형 문제 concept';
  end if;

  create temporary table _high_type_units
  on commit drop
  as
  select
    unit_row.book_id,
    unit_row.id as target_unit_id,
    concept.id as target_concept_id,
    unit_row.sort_order,
    row_number() over (
      partition by unit_row.book_id
      order by unit_row.sort_order, unit_row.id
    ) - 1 as target_unit_ordinal
  from content.units unit_row
  join _high_type_books book on book.id = unit_row.book_id
  join content.concepts concept
    on concept.book_id = unit_row.book_id
   and concept.unit_id = unit_row.id
   and concept.name = '유형 문제';

  create temporary table _parsed_high_types
  on commit drop
  as
  select
    problem_type.id as old_type_id,
    problem_type.book_id,
    problem_type.unit_id as old_unit_id,
    problem_type.concept_id as old_concept_id,
    problem_type.name,
    problem_type.sort_order,
    substring(
      problem_type.name
      from '^유형[[:space:]]*0*([0-9]+)'
    )::integer as type_number
  from content.problem_types problem_type
  join _high_type_books book on book.id = problem_type.book_id;

  select count(*) into actual_count from _parsed_high_types;
  if actual_count <> 878 then
    raise exception 'Expected 878 affected problem-type rows, found %', actual_count;
  end if;
  if exists (select 1 from _parsed_high_types where type_number is null) then
    raise exception 'Every affected problem type must begin with a parseable 유형 number';
  end if;

  if exists (
    select 1
    from _high_type_books book
    left join (
      select book_id, count(*) as unit_count
      from _high_type_units
      group by book_id
    ) unit_counts on unit_counts.book_id = book.id
    left join (
      select book_id, count(*) as reset_count
      from _parsed_high_types
      where type_number = 1
      group by book_id
    ) reset_counts on reset_counts.book_id = book.id
    where unit_counts.unit_count is distinct from reset_counts.reset_count
  ) then
    raise exception 'The 유형01 reset count does not match the unit count for an affected book';
  end if;

  create temporary table _high_type_targets
  on commit drop
  as
  with sequenced_types as (
    select
      parsed_type.*,
      sum(case when parsed_type.type_number = 1 then 1 else 0 end) over (
        partition by parsed_type.book_id
        order by parsed_type.sort_order, parsed_type.old_type_id
        rows between unbounded preceding and current row
      ) - 1 as target_unit_ordinal
    from _parsed_high_types parsed_type
  ),
  mapped_types as (
    select
      sequenced_type.old_type_id,
      sequenced_type.book_id,
      sequenced_type.old_unit_id,
      sequenced_type.old_concept_id,
      sequenced_type.name,
      sequenced_type.sort_order,
      sequenced_type.type_number,
      target_unit.target_unit_id,
      target_unit.target_concept_id
    from sequenced_types sequenced_type
    join _high_type_units target_unit
      on target_unit.book_id = sequenced_type.book_id
     and target_unit.target_unit_ordinal = sequenced_type.target_unit_ordinal
  )
  select
    mapped_type.*,
    first_value(mapped_type.old_type_id) over (
      partition by mapped_type.book_id, mapped_type.target_unit_id, mapped_type.name
      order by mapped_type.sort_order, mapped_type.old_type_id
    ) as canonical_type_id
  from mapped_types mapped_type;

  select count(*) into actual_count from _high_type_targets;
  if actual_count <> 878 then
    raise exception 'Not every affected problem type maps to a target unit: %/878', actual_count;
  end if;

  select count(*)
  into duplicate_count
  from _high_type_targets
  where old_type_id <> canonical_type_id;
  if duplicate_count <> 6 then
    raise exception 'Expected 6 split problem-type duplicates, found %', duplicate_count;
  end if;

  select count(*)
  into actual_count
  from content.problems problem
  join _high_type_books book on book.id = problem.book_id;
  if actual_count <> 3254 then
    raise exception 'Expected 3254 affected problems, found %', actual_count;
  end if;

  if exists (
    select 1
    from content.problems problem
    join _high_type_books book on book.id = problem.book_id
    left join _high_type_targets target
      on target.old_type_id = problem.problem_type_id
     and target.book_id = problem.book_id
    where problem.problem_type_id is null
       or problem.type_id is distinct from problem.problem_type_id
       or target.old_type_id is null
  ) then
    raise exception 'Affected problems must have matching legacy/current type ids in the repair set';
  end if;

  select count(*)
  into expected_count
  from content.problems problem
  join _high_type_targets target
    on target.old_type_id = problem.problem_type_id
   and target.book_id = problem.book_id
  where (problem.unit_id, problem.concept_id, problem.problem_type_id, problem.type_id)
    is distinct from (
      target.target_unit_id,
      target.target_concept_id,
      target.canonical_type_id,
      target.canonical_type_id
    );

  update content.problems problem
  set
    unit_id = target.target_unit_id,
    concept_id = target.target_concept_id,
    problem_type_id = target.canonical_type_id,
    type_id = target.canonical_type_id,
    updated_at = repaired_at
  from _high_type_targets target
  where target.old_type_id = problem.problem_type_id
    and target.book_id = problem.book_id
    and (problem.unit_id, problem.concept_id, problem.problem_type_id, problem.type_id)
      is distinct from (
        target.target_unit_id,
        target.target_concept_id,
        target.canonical_type_id,
        target.canonical_type_id
      );
  get diagnostics updated_count = row_count;
  if updated_count <> expected_count then
    raise exception 'Problem repair count changed during migration: expected %, updated %',
      expected_count, updated_count;
  end if;

  delete from content.problem_types problem_type
  using _high_type_targets target
  where problem_type.id = target.old_type_id
    and target.old_type_id <> target.canonical_type_id;
  get diagnostics updated_count = row_count;
  if updated_count <> duplicate_count then
    raise exception 'Expected to merge % split problem types, deleted %',
      duplicate_count, updated_count;
  end if;

  -- Detach the surviving rows first so the immediate book/unit/name unique
  -- constraint cannot observe transient collisions while units are reassigned.
  update content.problem_types problem_type
  set
    unit_id = null,
    concept_id = null,
    updated_at = repaired_at
  where problem_type.id in (
    select distinct target.canonical_type_id
    from _high_type_targets target
  );

  update content.problem_types problem_type
  set
    unit_id = target.target_unit_id,
    concept_id = target.target_concept_id,
    updated_at = repaired_at
  from _high_type_targets target
  where target.old_type_id = target.canonical_type_id
    and problem_type.id = target.canonical_type_id;
  get diagnostics updated_count = row_count;
  if updated_count <> 872 then
    raise exception 'Expected to reattach 872 canonical problem types, updated %', updated_count;
  end if;

  with page_ranges as (
    select
      problem.book_id,
      problem.unit_id,
      min(problem.page_printed) as page_start,
      max(problem.page_printed) as page_end
    from content.problems problem
    join _high_type_books book on book.id = problem.book_id
    group by problem.book_id, problem.unit_id
  )
  update content.units unit_row
  set
    page_start = page_range.page_start,
    page_end = page_range.page_end,
    updated_at = repaired_at
  from page_ranges page_range
  where unit_row.book_id = page_range.book_id
    and unit_row.id = page_range.unit_id
    and (unit_row.page_start, unit_row.page_end)
      is distinct from (page_range.page_start, page_range.page_end);

  update content.books book
  set
    metadata = book.metadata || jsonb_build_object(
      'unit_mapping_repair', 'gaeppul-high-type-number-reset-v1',
      'unit_mapping_repaired_at', repaired_at
    ),
    updated_at = repaired_at
  from _high_type_books affected_book
  where book.id = affected_book.id;

  create temporary table _affected_assignments
  on commit drop
  as
  select distinct assignment_item.assignment_id
  from learning.assignment_items assignment_item
  join content.problems problem on problem.id = assignment_item.problem_id
  join _high_type_books book on book.id = problem.book_id;

  update learning.assignment_items assignment_item
  set
    book_id = problem.book_id,
    unit_id = problem.unit_id
  from content.problems problem
  join _high_type_books book on book.id = problem.book_id
  where assignment_item.problem_id = problem.id
    and (assignment_item.book_id, assignment_item.unit_id)
      is distinct from (problem.book_id, problem.unit_id);

  create temporary table _assignment_rollups
  on commit drop
  as
  select
    affected_assignment.assignment_id,
    assignment.metadata ? 'problemScopes' as had_problem_scopes,
    coalesce(unit_rollup.unit_ids, '[]'::jsonb) as unit_ids,
    coalesce(type_rollup.problem_type_ids, '[]'::jsonb) as problem_type_ids,
    coalesce(scope_rollup.problem_scopes, '[]'::jsonb) as problem_scopes
  from _affected_assignments affected_assignment
  join learning.assignments assignment
    on assignment.id = affected_assignment.assignment_id
  left join lateral (
    select jsonb_agg(unit_row.unit_id order by unit_row.sort_order, unit_row.unit_id) as unit_ids
    from (
      select problem.unit_id, min(content_unit.sort_order) as sort_order
      from learning.assignment_items assignment_item
      join content.problems problem on problem.id = assignment_item.problem_id
      join content.units content_unit on content_unit.id = problem.unit_id
      where assignment_item.assignment_id = affected_assignment.assignment_id
      group by problem.unit_id
    ) unit_row
  ) unit_rollup on true
  left join lateral (
    select jsonb_agg(
      type_row.problem_type_id
      order by type_row.unit_sort_order, type_row.type_sort_order, type_row.problem_type_id
    ) as problem_type_ids
    from (
      select
        problem.problem_type_id,
        min(content_unit.sort_order) as unit_sort_order,
        min(problem_type.sort_order) as type_sort_order
      from learning.assignment_items assignment_item
      join content.problems problem on problem.id = assignment_item.problem_id
      join content.units content_unit on content_unit.id = problem.unit_id
      join content.problem_types problem_type on problem_type.id = problem.problem_type_id
      where assignment_item.assignment_id = affected_assignment.assignment_id
      group by problem.problem_type_id
    ) type_row
  ) type_rollup on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'unitId', scope_row.unit_id,
        'problemTypeId', scope_row.problem_type_id,
        'middleUnitName', null,
        'unassignedMiddleUnit', false
      )
      order by
        scope_row.unit_sort_order,
        scope_row.type_sort_order,
        scope_row.unit_id,
        scope_row.problem_type_id
    ) as problem_scopes
    from (
      select
        problem.unit_id,
        problem.problem_type_id,
        min(content_unit.sort_order) as unit_sort_order,
        min(problem_type.sort_order) as type_sort_order
      from learning.assignment_items assignment_item
      join content.problems problem on problem.id = assignment_item.problem_id
      join content.units content_unit on content_unit.id = problem.unit_id
      join content.problem_types problem_type on problem_type.id = problem.problem_type_id
      where assignment_item.assignment_id = affected_assignment.assignment_id
      group by problem.unit_id, problem.problem_type_id
    ) scope_row
  ) scope_rollup on true;

  update learning.assignments assignment
  set
    unit_id = case
      when jsonb_array_length(rollup.unit_ids) = 1
        then (rollup.unit_ids ->> 0)::uuid
      else null
    end,
    metadata = case
      when rollup.had_problem_scopes then
        jsonb_set(
          jsonb_set(
            jsonb_set(assignment.metadata, '{unitIds}', rollup.unit_ids, true),
            '{problemTypeIds}', rollup.problem_type_ids, true
          ),
          '{problemScopes}', rollup.problem_scopes, true
        )
      else
        jsonb_set(
          jsonb_set(assignment.metadata, '{unitIds}', rollup.unit_ids, true),
          '{problemTypeIds}', rollup.problem_type_ids, true
        )
    end,
    updated_at = repaired_at
  from _assignment_rollups rollup
  where assignment.id = rollup.assignment_id;

  select count(*)
  into actual_count
  from content.problem_types problem_type
  join _high_type_books book on book.id = problem_type.book_id;
  if actual_count <> 872 then
    raise exception 'Expected 872 canonical problem types after repair, found %', actual_count;
  end if;

  if exists (
    with ordered_types as (
      select
        problem_type.unit_id,
        row_number() over (
          partition by problem_type.unit_id
          order by problem_type.sort_order, problem_type.id
        ) as expected_type_number,
        substring(
          problem_type.name
          from '^유형[[:space:]]*0*([0-9]+)'
        )::integer as actual_type_number
      from content.problem_types problem_type
      join _high_type_books book on book.id = problem_type.book_id
    )
    select 1
    from ordered_types
    where actual_type_number is distinct from expected_type_number
  ) then
    raise exception 'A repaired unit does not contain a contiguous 유형01..N sequence';
  end if;

  if exists (
    select 1
    from _high_type_units target_unit
    where not exists (
      select 1
      from content.problem_types problem_type
      where problem_type.book_id = target_unit.book_id
        and problem_type.unit_id = target_unit.target_unit_id
    )
  ) then
    raise exception 'A repaired unit has no problem types';
  end if;

  if exists (
    select 1
    from content.problem_types problem_type
    join _high_type_books book on book.id = problem_type.book_id
    join content.concepts concept on concept.id = problem_type.concept_id
    where concept.book_id is distinct from problem_type.book_id
       or concept.unit_id is distinct from problem_type.unit_id
  ) then
    raise exception 'A repaired problem type is attached to a concept from another unit';
  end if;

  if exists (
    select 1
    from content.problems problem
    join _high_type_books book on book.id = problem.book_id
    left join content.problem_types problem_type
      on problem_type.id = problem.problem_type_id
    where problem_type.id is null
       or problem.type_id is distinct from problem.problem_type_id
       or problem_type.book_id is distinct from problem.book_id
       or problem_type.unit_id is distinct from problem.unit_id
       or problem_type.concept_id is distinct from problem.concept_id
  ) then
    raise exception 'A repaired problem does not match its canonical type/unit/concept';
  end if;

  if exists (
    select 1
    from content.units unit_row
    join _high_type_units target_unit
      on target_unit.target_unit_id = unit_row.id
    join lateral (
      select
        min(problem.page_printed) as page_start,
        max(problem.page_printed) as page_end
      from content.problems problem
      where problem.book_id = unit_row.book_id
        and problem.unit_id = unit_row.id
    ) page_range on true
    where (unit_row.page_start, unit_row.page_end)
      is distinct from (page_range.page_start, page_range.page_end)
  ) then
    raise exception 'A repaired unit page range does not match its problems';
  end if;

  if exists (
    select 1
    from learning.assignment_items assignment_item
    join _affected_assignments affected_assignment
      on affected_assignment.assignment_id = assignment_item.assignment_id
    join content.problems problem on problem.id = assignment_item.problem_id
    where assignment_item.book_id is distinct from problem.book_id
       or assignment_item.unit_id is distinct from problem.unit_id
  ) then
    raise exception 'An affected assignment item does not match its repaired problem unit';
  end if;

  if exists (
    select 1
    from _assignment_rollups rollup
    join learning.assignments assignment on assignment.id = rollup.assignment_id
    where assignment.unit_id is distinct from (
        case
          when jsonb_array_length(rollup.unit_ids) = 1
            then (rollup.unit_ids ->> 0)::uuid
          else null
        end
      )
       or assignment.metadata -> 'unitIds' is distinct from rollup.unit_ids
       or assignment.metadata -> 'problemTypeIds' is distinct from rollup.problem_type_ids
       or (
         rollup.had_problem_scopes
         and assignment.metadata -> 'problemScopes' is distinct from rollup.problem_scopes
       )
  ) then
    raise exception 'An affected assignment summary is stale after repair';
  end if;
end;
$migration$;
