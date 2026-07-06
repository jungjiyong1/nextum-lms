-- core.class_students.student_id must point to the canonical LMS student row.
-- Some remote nextum-data databases still had this FK pointing at the legacy
-- core.profiles table, which blocks LMS student registration after inserting
-- core.students.
alter table core.class_students
  drop constraint if exists class_students_student_id_fkey;

alter table core.class_students
  add constraint class_students_student_id_fkey
  foreign key (student_id)
  references core.students (id)
  on delete cascade;
