-- Backfill operational LMS defaults for data that existed before the LMS
-- UUID schema cutover. This preserves grade-app content/learning data.

insert into lms.class_profiles (
  class_id,
  academy_id,
  status
)
select
  c.id,
  c.academy_id,
  case when c.active then 'active' else 'inactive' end
from core.classes c
where not exists (
  select 1
  from lms.class_profiles cp
  where cp.class_id = c.id
);

insert into lms.student_billing_contracts (
  academy_id,
  student_id,
  billing_mode,
  base_monthly_fee,
  status,
  effective_from
)
select
  s.academy_id,
  s.id,
  'monthly_plus_classes',
  0,
  'active',
  coalesce(s.enrollment_date, current_date)
from core.students s
where s.status = 'active'
  and not exists (
    select 1
    from lms.student_billing_contracts c
    where c.student_id = s.id
      and c.status = 'active'
      and c.effective_to is null
  );

insert into lms.billing_class_rules (
  academy_id,
  contract_id,
  class_id,
  rule_type,
  amount,
  effective_from
)
select
  c.academy_id,
  c.id,
  cs.class_id,
  'included',
  0,
  coalesce(c.effective_from, current_date)
from lms.student_billing_contracts c
join core.class_students cs
  on cs.student_id = c.student_id
 and cs.status = 'active'
join core.classes cl
  on cl.id = cs.class_id
 and cl.academy_id = c.academy_id
where c.status = 'active'
  and c.effective_to is null
  and not exists (
    select 1
    from lms.billing_class_rules r
    where r.contract_id = c.id
      and r.class_id = cs.class_id
  );
