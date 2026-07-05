import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const loginId = process.env.LMS_DEV_ADMIN_LOGIN_ID || 'admin';
const password = process.env.LMS_DEV_ADMIN_PASSWORD || '1234';
const academyName = process.env.LMS_DEV_ACADEMY_NAME || 'NEXTUM Academy';
const emailDomain = process.env.LMS_LOGIN_EMAIL_DOMAIN || 'nextum.local';
const email = `${loginId}@${emailDomain}`;

if (process.env.LMS_DEV_SEED_ALLOW !== 'true') {
  console.error('Refusing to seed a development admin account without LMS_DEV_SEED_ALLOW=true.');
  console.error('PowerShell: $env:LMS_DEV_SEED_ALLOW = "true"; npm run seed:dev-admin');
  process.exit(1);
}

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function upsertSingle(schema, table, payload, onConflict, select = '*') {
  const { data, error } = await supabase
    .schema(schema)
    .from(table)
    .upsert(payload, { onConflict })
    .select(select)
    .single();

  if (error) throw error;
  return data;
}

async function findOrCreateAcademy() {
  const { data: existing, error: findError } = await supabase
    .schema('core')
    .from('academies')
    .select('id,name')
    .eq('name', academyName)
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing;

  const { data, error } = await supabase
    .schema('core')
    .from('academies')
    .insert({ name: academyName, status: 'active' })
    .select('id,name')
    .single();

  if (error) throw error;
  return data;
}

async function findOrCreatePerson(academyId) {
  const { data: existing, error: findError } = await supabase
    .schema('core')
    .from('people')
    .select('id,full_name')
    .eq('email', email)
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) {
    const { error: updateError } = await supabase
      .schema('core')
      .from('people')
      .update({
        primary_academy_id: academyId,
        full_name: '관리자',
        display_name: '관리자',
        metadata: { dev_seed: true },
      })
      .eq('id', existing.id);
    if (updateError) throw updateError;
    return existing;
  }

  const { data, error } = await supabase
    .schema('core')
    .from('people')
    .insert({
      primary_academy_id: academyId,
      full_name: '관리자',
      display_name: '관리자',
      email,
      metadata: { dev_seed: true },
    })
    .select('id,full_name')
    .single();

  if (error) throw error;
  return data;
}

async function main() {
  const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { login_id: loginId, name: '관리자' },
  });

  let user = createdUser.user;
  if (createError) {
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;
    user = users.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase()) ?? null;
    if (!user) throw createError;

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { ...(user.user_metadata || {}), login_id: loginId, name: '관리자' },
    });
    if (updateError) throw updateError;
  }

  const academy = await findOrCreateAcademy();
  const person = await findOrCreatePerson(academy.id);

  const account = await upsertSingle(
    'core',
    'user_accounts',
    {
      auth_user_id: user.id,
      person_id: person.id,
      auth_email: email,
      login_id: loginId,
      status: 'active',
      metadata: { dev_seed: true },
    },
    'auth_user_id',
    'id,person_id',
  );

  await upsertSingle(
    'core',
    'staff_members',
    {
      academy_id: academy.id,
      person_id: person.id,
      role: 'admin',
      status: 'active',
      metadata: { dev_seed: true },
    },
    'academy_id,person_id,role',
    'id',
  );

  await upsertSingle(
    'core',
    'academy_members',
    {
      academy_id: academy.id,
      person_id: person.id,
      user_account_id: account.id,
      role: 'admin',
      active: true,
    },
    'academy_id,person_id,role',
    'id',
  );

  await upsertSingle(
    'core',
    'user_security_settings',
    {
      user_account_id: account.id,
      idle_timeout: 10,
    },
    'user_account_id',
    'user_account_id',
  );

  console.log(`Seeded development LMS admin: ${loginId} / ${password}`);
  console.log(`Supabase Auth email: ${email}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
