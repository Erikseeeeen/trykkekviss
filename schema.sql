CREATE TABLE IF NOT EXISTS quizzes (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  quiz_slug TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'map-location',
  prompt TEXT NOT NULL,
  image_data TEXT NOT NULL,
  image_width INTEGER NOT NULL,
  image_height INTEGER NOT NULL,
  answer_shape_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (quiz_slug) REFERENCES quizzes(slug)
);

CREATE INDEX IF NOT EXISTS questions_quiz_sequence
  ON questions (quiz_slug, sequence_number);

CREATE TABLE IF NOT EXISTS rooms (
  quiz_slug TEXT NOT NULL,
  room_code TEXT NOT NULL,
  current_question_id TEXT,
  state TEXT NOT NULL,
  reveal_step INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (quiz_slug, room_code),
  FOREIGN KEY (quiz_slug) REFERENCES quizzes(slug)
);

CREATE TABLE IF NOT EXISTS room_players (
  quiz_slug TEXT NOT NULL,
  room_code TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_color TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (quiz_slug, room_code, player_name),
  FOREIGN KEY (quiz_slug) REFERENCES quizzes(slug)
);

CREATE INDEX IF NOT EXISTS room_players_room
  ON room_players (quiz_slug, room_code);

CREATE TABLE IF NOT EXISTS guesses (
  quiz_slug TEXT NOT NULL,
  room_code TEXT NOT NULL,
  question_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  is_correct INTEGER NOT NULL,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (quiz_slug, room_code, question_id, player_name),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE INDEX IF NOT EXISTS guesses_room_question
  ON guesses (quiz_slug, room_code, question_id);

CREATE TABLE IF NOT EXISTS fibbage_lies (
  quiz_slug TEXT NOT NULL,
  room_code TEXT NOT NULL,
  question_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  lie_text TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (quiz_slug, room_code, question_id, player_name),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE INDEX IF NOT EXISTS fibbage_lies_room_question
  ON fibbage_lies (quiz_slug, room_code, question_id);

CREATE TABLE IF NOT EXISTS fibbage_votes (
  quiz_slug TEXT NOT NULL,
  room_code TEXT NOT NULL,
  question_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  choice_id TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (quiz_slug, room_code, question_id, player_name),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE INDEX IF NOT EXISTS fibbage_votes_room_question
  ON fibbage_votes (quiz_slug, room_code, question_id);

CREATE TABLE IF NOT EXISTS room_question_results (
  quiz_slug TEXT NOT NULL,
  room_code TEXT NOT NULL,
  question_id TEXT NOT NULL,
  revealed_at TEXT NOT NULL,
  PRIMARY KEY (quiz_slug, room_code, question_id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);
