-- Students should read problem payloads through content.student_problems only.
-- Keep direct content.problems reads limited to public columns so answer/answer_key
-- cannot be selected with the publishable key.

revoke select on content.problems from authenticated;

grant select (
  id,
  book_id,
  unit_id,
  concept_id,
  problem_type_id,
  type_id,
  page_printed,
  number,
  image_path,
  public_payload,
  position_in_type,
  is_example,
  difficulty_hint,
  verified,
  created_at,
  updated_at
) on content.problems to authenticated;

grant select on content.student_problems to authenticated;
