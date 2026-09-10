-- Standalone bootstrap script for the interview API (.rule/database-rules.md).
-- Safe to run repeatedly: every statement is idempotent.

create table if not exists org (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,
  data jsonb not null default '{}'::jsonb
);

-- "user" is a reserved word in Postgres, so the table name is always quoted.
create table if not exists "user" (
  id text primary key,
  org text not null references org (id),
  email text not null,
  password_hash text not null,
  name text not null,
  avatar_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists user_org_idx on "user" (org);
-- Emails are compared case-insensitively, so uniqueness is enforced on lower(email).
create unique index if not exists user_email_unique_idx on "user" (lower(email));

-- One row per issued refresh token, so logout and password changes can revoke
-- sessions server-side instead of trusting a stateless JWT until it expires.
create table if not exists user_session (
  id text primary key,
  user_id text not null references "user" (id),
  org text not null references org (id),
  refresh_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists user_session_user_idx on user_session (user_id);
create index if not exists user_session_org_idx on user_session (org);

create table if not exists interview (
  id text primary key,
  org text not null references org (id),
  job_title text not null,
  level text not null,
  type text not null,
  job_description text null,
  question_count int not null,
  -- Which Claude model runs this interview. Null means "use the server default".
  model text null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

-- Additive migration for databases bootstrapped before the model column existed.
alter table interview add column if not exists model text null;

create index if not exists interview_org_idx on interview (org);

create table if not exists question (
  id text primary key,
  interview_id text not null references interview (id),
  org text not null references org (id),
  position int not null,
  text text not null,
  topic text not null,
  is_follow_up boolean not null default false,
  parent_id text null references question (id),
  keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists question_interview_idx on question (interview_id);
create index if not exists question_org_idx on question (org);

create table if not exists answer (
  id text primary key,
  question_id text not null references question (id),
  interview_id text not null references interview (id),
  org text not null references org (id),
  text text not null,
  submitted_at timestamptz not null default now()
);

create index if not exists answer_interview_idx on answer (interview_id);
create index if not exists answer_org_idx on answer (org);
create unique index if not exists answer_question_unique_idx on answer (question_id);

create table if not exists evaluation (
  id text primary key,
  question_id text not null references question (id),
  answer_id text not null references answer (id),
  interview_id text not null references interview (id),
  org text not null references org (id),
  grade int not null,
  summary text not null,
  strengths jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  needs_follow_up boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists evaluation_interview_idx on evaluation (interview_id);
create index if not exists evaluation_org_idx on evaluation (org);
create unique index if not exists evaluation_answer_unique_idx on evaluation (answer_id);

-- Idempotent seed: the single org every signup lands in (ORG_ID).
insert into org (id, name)
values ('default', 'Default Org')
on conflict (id) do nothing;
