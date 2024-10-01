CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  username text NOT NULL UNIQUE,
  firstName text NOT NULL,
  lastName text NOT NULL,
  password text NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name text NOT NULL UNIQUE,
  description text NOT NULL,
  secret text NOT NULL,
  redirect_uri text NOT NULL
);
