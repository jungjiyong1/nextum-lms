-- Re-run backfill after staged app rollout so pre-core submissions are linked.

update learning.sessions s
set core_student_id = cs.id
from core.students cs
where cs.legacy_core_profile_id = s.student_id
  and s.core_student_id is null;

update learning.attempts a
set core_student_id = cs.id
from core.students cs
where cs.legacy_core_profile_id = a.student_id
  and a.core_student_id is null;

update learning.wrong_notes wn
set core_student_id = cs.id
from core.students cs
where cs.legacy_core_profile_id = wn.student_id
  and wn.core_student_id is null;

update learning.reports r
set core_student_id = cs.id
from core.students cs
where cs.legacy_core_profile_id = r.student_id
  and r.core_student_id is null;
