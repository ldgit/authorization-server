/* Solution for session storage. In an enterprise-scale app we would use an in-memory database such as Redis. */
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id uuid NOT NULL references users(id)
);
