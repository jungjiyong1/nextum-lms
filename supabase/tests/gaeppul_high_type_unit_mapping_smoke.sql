do $smoke$
begin
  if (
    select count(*)
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
      and book.metadata ->> 'unit_mapping_repair'
        = 'gaeppul-high-type-number-reset-v1'
  ) <> 7 then
    raise exception 'High-school type-workbook repair marker is incomplete';
  end if;

  if exists (
    with affected_types as (
      select
        problem_type.id,
        problem_type.book_id,
        problem_type.unit_id,
        problem_type.concept_id,
        row_number() over (
          partition by problem_type.unit_id
          order by problem_type.sort_order, problem_type.id
        ) as expected_type_number,
        substring(
          problem_type.name
          from '^유형[[:space:]]*0*([0-9]+)'
        )::integer as actual_type_number
      from content.problem_types problem_type
      join content.books book on book.id = problem_type.book_id
      where book.book_key like 'gaeppul_high_%_type'
    )
    select 1
    from affected_types affected_type
    left join content.concepts concept on concept.id = affected_type.concept_id
    where affected_type.actual_type_number is distinct from affected_type.expected_type_number
       or concept.book_id is distinct from affected_type.book_id
       or concept.unit_id is distinct from affected_type.unit_id
  ) then
    raise exception 'High-school type sequence or type/concept unit mapping is invalid';
  end if;

  if exists (
    select 1
    from content.problems problem
    join content.books book on book.id = problem.book_id
    left join content.problem_types problem_type
      on problem_type.id = problem.problem_type_id
    where book.book_key like 'gaeppul_high_%_type'
      and (
        problem_type.id is null
        or problem.type_id is distinct from problem.problem_type_id
        or problem_type.book_id is distinct from problem.book_id
        or problem_type.unit_id is distinct from problem.unit_id
        or problem_type.concept_id is distinct from problem.concept_id
      )
  ) then
    raise exception 'High-school type problem mapping is invalid';
  end if;

  if exists (
    select 1
    from learning.assignment_items assignment_item
    join content.problems problem on problem.id = assignment_item.problem_id
    join content.books book on book.id = problem.book_id
    where book.book_key like 'gaeppul_high_%_type'
      and (
        assignment_item.book_id is distinct from problem.book_id
        or assignment_item.unit_id is distinct from problem.unit_id
      )
  ) then
    raise exception 'High-school type assignment item mapping is stale';
  end if;
end;
$smoke$;
