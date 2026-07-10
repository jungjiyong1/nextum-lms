-- Create one active study/exam plan with its scope and optional materials in a
-- single transaction. The HTTP route uses service_role, so this function
-- independently verifies the represented actor and class assignment.

create or replace function learning.create_analysis_plan_v1(
  p_actor_auth_user_id uuid,
  p_academy_id uuid,
  p_input jsonb
)
returns table (
  plan_id uuid,
  scope_count integer,
  material_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_account_id uuid;
  v_actor_person_id uuid;
  v_actor_role text;
  v_class_id uuid;
  v_plan_type text;
  v_track_kind text;
  v_name text;
  v_target_band smallint;
  v_exam_date date;
  v_maintenance_interval smallint;
  v_recheck_interval smallint;
  v_revision_id uuid;
  v_scope_ids uuid[];
  v_material_ids uuid[];
  v_student_overrides jsonb;
  v_plan_id uuid;
  v_today date := (pg_catalog.now() at time zone 'Asia/Seoul')::date;
  v_expected_count integer;
begin
  if p_actor_auth_user_id is null or p_academy_id is null then
    raise exception using errcode = '22023', message = 'actor and academy are required';
  end if;
  if jsonb_typeof(coalesce(p_input, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'input must be a JSON object';
  end if;

  select account.id, account.person_id
  into v_actor_account_id, v_actor_person_id
  from core.user_accounts account
  where account.auth_user_id = p_actor_auth_user_id
    and account.status = 'active'
  limit 1;

  if v_actor_account_id is null or v_actor_person_id is null then
    raise exception using errcode = '42501', message = 'active staff account is required';
  end if;

  select member.role
  into v_actor_role
  from core.academy_members member
  where member.academy_id = p_academy_id
    and member.person_id = v_actor_person_id
    and member.active
    and member.role in ('owner', 'admin', 'staff', 'teacher', 'instructor')
    and (
      member.user_account_id is null
      or member.user_account_id = v_actor_account_id
    )
  order by case member.role
    when 'owner' then 1
    when 'admin' then 2
    when 'staff' then 3
    when 'teacher' then 4
    else 5
  end
  limit 1;

  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'active academy staff membership is required';
  end if;

  if jsonb_typeof(coalesce(p_input -> 'scope_skill_ids', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_input -> 'material_book_ids', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_input -> 'student_overrides', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'scope, material, and override values must be JSON arrays';
  end if;

  begin
    v_class_id := nullif(p_input ->> 'class_id', '')::uuid;
    v_target_band := nullif(p_input ->> 'target_challenge_band', '')::smallint;
    v_exam_date := nullif(p_input ->> 'exam_date', '')::date;
    v_maintenance_interval := nullif(p_input ->> 'maintenance_interval_days', '')::smallint;
    v_recheck_interval := nullif(p_input ->> 'recheck_interval_days', '')::smallint;
    v_scope_ids := coalesce(array(
      select value::uuid
      from jsonb_array_elements_text(coalesce(p_input -> 'scope_skill_ids', '[]'::jsonb)) value
    ), array[]::uuid[]);
    v_material_ids := coalesce(array(
      select value::uuid
      from jsonb_array_elements_text(coalesce(p_input -> 'material_book_ids', '[]'::jsonb)) value
    ), array[]::uuid[]);
    v_student_overrides := coalesce(p_input -> 'student_overrides', '[]'::jsonb);
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'input contains an invalid id, number, or date';
  end;

  v_plan_type := p_input ->> 'plan_type';
  v_track_kind := nullif(p_input ->> 'track_kind', '');
  v_name := btrim(coalesce(p_input ->> 'name', ''));

  if v_class_id is null then
    raise exception using errcode = '22023', message = 'class_id is required';
  end if;
  if length(v_name) < 1 or length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'name must contain 1..120 characters';
  end if;
  if v_target_band is null or v_target_band not between 1 and 4 then
    raise exception using errcode = '22023', message = 'target challenge band must be 1..4';
  end if;
  if cardinality(v_scope_ids) < 1 or cardinality(v_scope_ids) > 500 then
    raise exception using errcode = '22023', message = 'scope must contain 1..500 skills';
  end if;
  if cardinality(v_material_ids) > 100 then
    raise exception using errcode = '22023', message = 'at most 100 materials are allowed';
  end if;
  if jsonb_array_length(v_student_overrides) > 1000 then
    raise exception using errcode = '22023', message = 'at most 1000 student overrides are allowed';
  end if;
  if exists (select 1 from unnest(v_scope_ids) value where value is null)
     or exists (select 1 from unnest(v_material_ids) value where value is null) then
    raise exception using errcode = '22023', message = 'scope and material ids cannot contain nulls';
  end if;
  if cardinality(v_scope_ids) <> (select count(distinct value) from unnest(v_scope_ids) value)
     or cardinality(v_material_ids) <> (select count(distinct value) from unnest(v_material_ids) value) then
    raise exception using errcode = '22023', message = 'scope and material ids must be unique';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_student_overrides) override_row(
      student_id uuid,
      target_challenge_band smallint
    )
    where override_row.student_id is null
       or override_row.target_challenge_band is null
       or override_row.target_challenge_band not between 1 and 4
  ) or jsonb_array_length(v_student_overrides) <> (
    select count(distinct override_row.student_id)
    from jsonb_to_recordset(v_student_overrides) override_row(student_id uuid)
  ) then
    raise exception using errcode = '22023', message = 'student overrides must contain unique students and target bands 1..4';
  end if;

  if v_plan_type = 'study_track' then
    if v_track_kind is null
       or v_track_kind not in ('current', 'advance', 'maintenance')
       or v_exam_date is not null
       or v_maintenance_interval is null
       or v_maintenance_interval not in (7, 14, 21, 30)
       or v_recheck_interval is not null then
      raise exception using errcode = '22023', message = 'study track settings are invalid';
    end if;
  elsif v_plan_type = 'exam' then
    if v_track_kind is not null
       or v_exam_date is null
       or v_exam_date < v_today
       or v_maintenance_interval is not null
       or v_recheck_interval is null
       or v_recheck_interval not between 1 and 90 then
      raise exception using errcode = '22023', message = 'exam plan settings are invalid';
    end if;
  else
    raise exception using errcode = '22023', message = 'plan_type must be study_track or exam';
  end if;

  if not exists (
    select 1
    from core.classes class
    where class.id = v_class_id
      and class.academy_id = p_academy_id
      and class.active
  ) then
    raise exception using errcode = '42501', message = 'class is unavailable to this academy';
  end if;

  if v_actor_role in ('teacher', 'instructor') and not exists (
    select 1
    from core.staff_members staff
    where staff.person_id = v_actor_person_id
      and staff.academy_id = p_academy_id
      and staff.status = 'active'
      and (
        exists (
          select 1
          from lms.class_profiles profile
          where profile.class_id = v_class_id
            and profile.status = 'active'
            and profile.default_instructor_staff_id = staff.id
        )
        or exists (
          select 1
          from lms.class_schedule_rules rule
          where rule.class_id = v_class_id
            and rule.active
            and rule.instructor_staff_id = staff.id
            and rule.start_date <= v_today
            and (rule.end_date is null or rule.end_date >= v_today)
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'instructor is not assigned to this class';
  end if;

  select revision.id
  into v_revision_id
  from content.analysis_taxonomy_revisions revision
  where revision.status = 'published'
  order by revision.revision_number desc
  limit 1;

  if v_revision_id is null then
    raise exception using errcode = '22023', message = 'a published taxonomy revision is required';
  end if;

  select count(*)::integer
  into v_expected_count
  from content.analysis_skills skill
  where skill.id = any(v_scope_ids)
    and skill.taxonomy_revision_id = v_revision_id
    and skill.active;
  if v_expected_count <> cardinality(v_scope_ids) then
    raise exception using errcode = '22023', message = 'every scope skill must be active in the published revision';
  end if;

  select count(*)::integer
  into v_expected_count
  from content.books book
  where book.id = any(v_material_ids)
    and (book.academy_id is null or book.academy_id = p_academy_id);
  if v_expected_count <> cardinality(v_material_ids) then
    raise exception using errcode = '22023', message = 'every material must be available to the academy';
  end if;

  select count(*)::integer
  into v_expected_count
  from jsonb_to_recordset(v_student_overrides) override_row(student_id uuid)
  join core.students student
    on student.id = override_row.student_id
   and student.academy_id = p_academy_id
   and student.status = 'active'
  join core.class_students enrollment
    on enrollment.student_id = student.id
   and enrollment.class_id = v_class_id
   and enrollment.status = 'active';
  if v_expected_count <> jsonb_array_length(v_student_overrides) then
    raise exception using errcode = '22023', message = 'every overridden student must be active in the plan class';
  end if;

  insert into learning.analysis_plans (
    academy_id,
    class_id,
    plan_type,
    name,
    status,
    target_challenge_band,
    maintenance_interval_days,
    exam_date,
    recheck_interval_days,
    starts_on,
    ends_on,
    taxonomy_revision_id,
    created_by,
    updated_by,
    metadata
  ) values (
    p_academy_id,
    v_class_id,
    v_plan_type,
    v_name,
    'active',
    v_target_band,
    v_maintenance_interval,
    v_exam_date,
    v_recheck_interval,
    v_today,
    case when v_plan_type = 'exam' then v_exam_date else null end,
    v_revision_id,
    v_actor_person_id,
    v_actor_person_id,
    jsonb_build_object(
      'track_kind', v_track_kind,
      'created_via', 'learning.create_analysis_plan_v1'
    )
  )
  returning id into v_plan_id;

  insert into learning.analysis_plan_scope (
    plan_id,
    analysis_skill_id,
    sort_order
  )
  select v_plan_id, value, ordinal::integer - 1
  from unnest(v_scope_ids) with ordinality as scope(value, ordinal);

  insert into learning.analysis_plan_materials (
    plan_id,
    material_type,
    book_id,
    label,
    created_by,
    metadata
  )
  select
    v_plan_id,
    'book',
    book.id,
    book.title,
    v_actor_person_id,
    jsonb_build_object('created_via', 'learning.create_analysis_plan_v1')
  from unnest(v_material_ids) with ordinality as material(value, ordinal)
  join content.books book on book.id = material.value
  order by material.ordinal;

  insert into learning.analysis_plan_student_overrides (
    plan_id,
    student_id,
    included,
    target_challenge_band,
    updated_by,
    metadata
  )
  select
    v_plan_id,
    override_row.student_id,
    true,
    override_row.target_challenge_band,
    v_actor_person_id,
    jsonb_build_object('created_via', 'learning.create_analysis_plan_v1')
  from jsonb_to_recordset(v_student_overrides) override_row(
    student_id uuid,
    target_challenge_band smallint
  );

  return query
  select v_plan_id, cardinality(v_scope_ids), cardinality(v_material_ids);
end;
$$;

revoke all on function learning.create_analysis_plan_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function learning.create_analysis_plan_v1(uuid, uuid, jsonb)
  to service_role;
