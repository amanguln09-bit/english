CREATE TABLE curriculum_sources(id text PRIMARY KEY, url text NOT NULL, title text NOT NULL, checked_at timestamptz NOT NULL, status text NOT NULL CHECK(status IN ('unverified','verified','blocked')), content_sha256 text);
CREATE TABLE objectives(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text NOT NULL REFERENCES curriculum_sources(id), code text NOT NULL UNIQUE, grade integer NOT NULL CHECK(grade BETWEEN 6 AND 8), skill text NOT NULL, official_text text NOT NULL, verified boolean NOT NULL DEFAULT false);
CREATE TABLE textbooks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL,edition text,approval_source text REFERENCES curriculum_sources(id),verified boolean NOT NULL DEFAULT false);
CREATE TABLE topics(id text PRIMARY KEY,title text NOT NULL,grade integer NOT NULL CHECK(grade BETWEEN 6 AND 8),term integer CHECK(term BETWEEN 1 AND 4),textbook_id uuid REFERENCES textbooks(id),unit text,lesson text);
CREATE TABLE topic_objectives(topic_id text REFERENCES topics(id),objective_id uuid REFERENCES objectives(id),status text NOT NULL CHECK(status IN ('unverified','verified')),rationale text NOT NULL,PRIMARY KEY(topic_id,objective_id));
CREATE TABLE games(id text PRIMARY KEY,owner uuid,title text NOT NULL,template text NOT NULL,status text NOT NULL CHECK(status IN ('draft','reviewed','published','archived')),sample boolean NOT NULL DEFAULT true,topic_id text REFERENCES topics(id),body jsonb NOT NULL);
CREATE TABLE questions(id text PRIMARY KEY,game_id text NOT NULL REFERENCES games(id),kind text NOT NULL CHECK(kind IN ('single','multiple','text','ordering','discussion')),body jsonb NOT NULL);
CREATE TABLE assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id text REFERENCES games(id),url text NOT NULL,license text NOT NULL,alt_text text NOT NULL);
CREATE TABLE sessions(id text PRIMARY KEY,owner uuid NOT NULL,game_id text REFERENCES games(id),state text NOT NULL CHECK(state IN ('CREATED','LOBBY','ACTIVE','PAUSED','FINISHED','EXPIRED','CANCELLED')),expires_at timestamptz NOT NULL,body jsonb NOT NULL);
CREATE TABLE participants(id text PRIMARY KEY,session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,nickname text NOT NULL,token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL);
CREATE TABLE answers(session_id text REFERENCES sessions(id) ON DELETE CASCADE,participant_id text REFERENCES participants(id) ON DELETE CASCADE,question_id text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(session_id,participant_id,question_id));
CREATE TABLE audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor uuid,action text NOT NULL,body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
-- Server-side persistence adapter currently uses this transactional document table.
-- Normalized educational tables above are reserved for the verified import pipeline.
CREATE TABLE runtime_records(kind text NOT NULL,id text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(kind,id));
CREATE INDEX runtime_owner ON runtime_records((body->>'owner')) WHERE kind='session';
ALTER TABLE curriculum_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_records ENABLE ROW LEVEL SECURITY;
-- No anonymous/client database policies: all reads go through authorized server APIs.
-- Use a dedicated server-only DB role. Never expose its connection string to browsers.
