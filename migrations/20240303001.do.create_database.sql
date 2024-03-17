CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  firstName text NOT NULL,
  lastName text NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name text NOT NULL,
  description text NOT NULL
);
