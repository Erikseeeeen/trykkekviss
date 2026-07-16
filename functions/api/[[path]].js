const STATES = new Set(["OPEN", "VOTING", "REVEALING", "CLOSED", "REVEALED"]);
const QUESTION_TYPES = new Set(["map-location", "fibbage"]);
const TRUTH_CHOICE_ID = "truth";
const MAP_POINTS = 10;
const TRUTH_POINTS = 10;
const FOOL_POINTS = 5;
const PLAYER_COLORS = [
  "#1565C0",
  "#AD1457",
  "#6A1B9A",
  "#2E7D32",
  "#EF6C00",
  "#00838F",
  "#5D4037",
  "#283593",
  "#C62828",
  "#00695C",
  "#7B1FA2",
  "#455A64"
];

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS quizzes (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS questions (
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
  )`,
  `CREATE INDEX IF NOT EXISTS questions_quiz_sequence
    ON questions (quiz_slug, sequence_number)`,
  `CREATE TABLE IF NOT EXISTS rooms (
    quiz_slug TEXT NOT NULL,
    room_code TEXT NOT NULL,
    current_question_id TEXT,
    state TEXT NOT NULL,
    reveal_step INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (quiz_slug, room_code),
    FOREIGN KEY (quiz_slug) REFERENCES quizzes(slug)
  )`,
  `CREATE TABLE IF NOT EXISTS room_players (
    quiz_slug TEXT NOT NULL,
    room_code TEXT NOT NULL,
    player_name TEXT NOT NULL,
    player_color TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (quiz_slug, room_code, player_name),
    FOREIGN KEY (quiz_slug) REFERENCES quizzes(slug)
  )`,
  `CREATE INDEX IF NOT EXISTS room_players_room
    ON room_players (quiz_slug, room_code)`,
  `CREATE TABLE IF NOT EXISTS guesses (
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
  )`,
  `CREATE INDEX IF NOT EXISTS guesses_room_question
    ON guesses (quiz_slug, room_code, question_id)`,
  `CREATE TABLE IF NOT EXISTS fibbage_lies (
    quiz_slug TEXT NOT NULL,
    room_code TEXT NOT NULL,
    question_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    lie_text TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    PRIMARY KEY (quiz_slug, room_code, question_id, player_name),
    FOREIGN KEY (question_id) REFERENCES questions(id)
  )`,
  `CREATE INDEX IF NOT EXISTS fibbage_lies_room_question
    ON fibbage_lies (quiz_slug, room_code, question_id)`,
  `CREATE TABLE IF NOT EXISTS fibbage_votes (
    quiz_slug TEXT NOT NULL,
    room_code TEXT NOT NULL,
    question_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    choice_id TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    PRIMARY KEY (quiz_slug, room_code, question_id, player_name),
    FOREIGN KEY (question_id) REFERENCES questions(id)
  )`,
  `CREATE INDEX IF NOT EXISTS fibbage_votes_room_question
    ON fibbage_votes (quiz_slug, room_code, question_id)`,
  `CREATE TABLE IF NOT EXISTS room_question_results (
    quiz_slug TEXT NOT NULL,
    room_code TEXT NOT NULL,
    question_id TEXT NOT NULL,
    revealed_at TEXT NOT NULL,
    PRIMARY KEY (quiz_slug, room_code, question_id),
    FOREIGN KEY (question_id) REFERENCES questions(id)
  )`
];

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    if (!env.DB) {
      return json({ error: "D1-bindingen DB mangler." }, 500);
    }

    await ensureSchema(env.DB);

    const url = new URL(request.url);
    const path = getPathParts(context.params.path);

    if (request.method === "GET" && path[0] === "quizzes" && path.length === 1) {
      return listQuizzes(env.DB);
    }

    if (request.method === "GET" && path[0] === "state") {
      return getState(request, env.DB, env);
    }

    if (request.method === "POST" && path[0] === "guess") {
      return submitGuess(request, env.DB);
    }

    if (request.method === "POST" && path[0] === "join") {
      return joinRoom(request, env.DB);
    }

    if (path[0] === "admin") {
      if (!isAdmin(request, env)) {
        return json({ error: "Adminnøkkel kreves." }, 401);
      }

      if (request.method === "POST" && path[1] === "quizzes") {
        return upsertQuiz(request, env.DB);
      }

      if (request.method === "GET" && path[1] === "quizzes" && path[2]) {
        return getAdminQuiz(env.DB, path[2]);
      }

      if (request.method === "POST" && path[1] === "questions") {
        return createQuestion(request, env.DB);
      }

      if (request.method === "PUT" && path[1] === "questions" && path[2]) {
        return updateQuestion(request, env.DB, path[2]);
      }

      if (request.method === "DELETE" && path[1] === "questions" && path[2]) {
        return deleteQuestion(env.DB, path[2]);
      }

      if (request.method === "POST" && path[1] === "room") {
        return updateRoom(request, env.DB);
      }

      if (request.method === "POST" && path[1] === "sample") {
        return createSampleQuiz(request, env.DB);
      }
    }

    return json({ error: `Ingen rute for ${request.method} ${url.pathname}` }, 404);
  } catch (error) {
    return json({ error: error.message || "Uventet feil" }, 500);
  }
}

async function ensureSchema(db) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  await addColumnIfMissing(
    db,
    "questions",
    "type",
    `ALTER TABLE questions ADD COLUMN type TEXT NOT NULL DEFAULT 'map-location'`
  );
  await addColumnIfMissing(
    db,
    "room_players",
    "player_color",
    `ALTER TABLE room_players ADD COLUMN player_color TEXT`
  );
  await addColumnIfMissing(
    db,
    "rooms",
    "reveal_step",
    `ALTER TABLE rooms ADD COLUMN reveal_step INTEGER NOT NULL DEFAULT 0`
  );
  await backfillMissingPlayerColors(db);
}

async function addColumnIfMissing(db, tableName, columnName, statement) {
  const info = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const columns = new Set((info.results || []).map((column) => column.name));

  if (!columns.has(columnName)) {
    await db.prepare(statement).run();
  }
}

async function listQuizzes(db) {
  const result = await db
    .prepare(
      `SELECT q.slug, q.title, COUNT(questions.id) AS question_count
       FROM quizzes q
       LEFT JOIN questions
        ON questions.quiz_slug = q.slug
        AND questions.type IN ('map-location', 'fibbage')
       GROUP BY q.slug
       ORDER BY q.created_at DESC`
    )
    .all();

  return json({ quizzes: result.results || [] });
}

async function getState(request, db, env) {
  const url = new URL(request.url);
  const quizSlug = cleanSlug(url.searchParams.get("quiz") || "");
  const roomCode = cleanRoomCode(url.searchParams.get("room") || "main");
  const playerName = cleanPlayerName(url.searchParams.get("playerName") || "");
  const adminRequested = url.searchParams.get("admin") === "1";

  if (adminRequested && !isAdmin(request, env)) {
    return json({ error: "Adminnøkkel kreves." }, 401);
  }

  if (!quizSlug) {
    return json({ error: "Quiz mangler." }, 400);
  }

  const quiz = await db.prepare(`SELECT * FROM quizzes WHERE slug = ?`).bind(quizSlug).first();

  if (!quiz) {
    return json({ quiz: null, room: null, question: null, guesses: [], submissionsCount: 0 });
  }

  const questions = await getQuestions(db, quizSlug);
  let room = await db
    .prepare(`SELECT * FROM rooms WHERE quiz_slug = ? AND room_code = ?`)
    .bind(quizSlug, roomCode)
    .first();

  if (!room && questions.length > 0) {
    const firstQuestion = questions[0];
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO rooms (quiz_slug, room_code, current_question_id, state, reveal_step, updated_at)
         VALUES (?, ?, ?, 'OPEN', 0, ?)`
      )
      .bind(quizSlug, roomCode, firstQuestion.id, now)
      .run();
    room = {
      quiz_slug: quizSlug,
      room_code: roomCode,
      current_question_id: firstQuestion.id,
      state: "OPEN",
      reveal_step: 0,
      updated_at: now
    };
  }

  let currentQuestion = room?.current_question_id
    ? questions.find((question) => question.id === room.current_question_id) || null
    : null;

  if (room && !currentQuestion && questions.length > 0) {
    const firstQuestion = questions[0];
    const updatedAt = new Date().toISOString();
    await db
      .prepare(
        `UPDATE rooms
         SET current_question_id = ?, state = 'OPEN', reveal_step = 0, updated_at = ?
         WHERE quiz_slug = ? AND room_code = ?`
      )
      .bind(firstQuestion.id, updatedAt, quizSlug, roomCode)
      .run();
    room = {
      ...room,
      current_question_id: firstQuestion.id,
      state: "OPEN",
      reveal_step: 0,
      updated_at: updatedAt
    };
    currentQuestion = firstQuestion;
  }

  if (room?.state === "CLOSED" && currentQuestion) {
    const updatedAt = new Date().toISOString();
    await db
      .prepare(
        `UPDATE rooms
         SET state = 'OPEN', reveal_step = 0, updated_at = ?
         WHERE quiz_slug = ? AND room_code = ?`
      )
      .bind(updatedAt, quizSlug, roomCode)
      .run();
    room = {
      ...room,
      state: "OPEN",
      reveal_step: 0,
      updated_at: updatedAt
    };
  }

  if (currentQuestion?.type === "fibbage" && room?.state === "OPEN") {
    room = await maybeAdvanceFibbageToVoting(db, quizSlug, roomCode, currentQuestion, room);
  }

  const wantsAdmin = adminRequested;
  const includeAnswers = wantsAdmin || room?.state === "REVEALED";
  const guesses = currentQuestion?.type === "map-location" && includeAnswers
    ? await getMapGuesses(db, quizSlug, roomCode, currentQuestion)
    : [];
  const fibbage = currentQuestion?.type === "fibbage"
    ? await getFibbageState(db, quizSlug, roomCode, currentQuestion, {
        state: room?.state || "CLOSED",
        includeAnswers,
        wantsAdmin,
        playerName,
        revealStep: room?.reveal_step || 0
      })
    : null;
  const submissionsCount = currentQuestion
    ? await countSubmissions(db, quizSlug, roomCode, currentQuestion, room?.state || "CLOSED")
    : 0;
  const leaderboard = await getLeaderboard(db, quizSlug, roomCode);

  return json({
    quiz,
    room: room
      ? {
          roomCode: room.room_code,
          state: room.state,
          currentQuestionId: room.current_question_id,
          revealStep: room.reveal_step || 0,
          updatedAt: room.updated_at
        }
      : null,
    question: currentQuestion ? questionDto(currentQuestion, includeAnswers) : null,
    questions: wantsAdmin ? questions.map((question) => questionDto(question, true)) : undefined,
    guesses,
    fibbage,
    leaderboard,
    submissionsCount
  });
}

async function submitGuess(request, db) {
  const body = await readJson(request);
  const quizSlug = cleanSlug(body.quizSlug || "");
  const roomCode = cleanRoomCode(body.roomCode || "main");
  const playerName = cleanPlayerName(body.playerName || "");

  if (!quizSlug || !playerName) {
    return json({ error: "Quiz-ID og spillernavn kreves." }, 400);
  }

  const room = await db
    .prepare(`SELECT * FROM rooms WHERE quiz_slug = ? AND room_code = ?`)
    .bind(quizSlug, roomCode)
    .first();

  if (!room || !room.current_question_id) {
    return json({ error: "Rommet har ikke et aktivt spørsmål." }, 409);
  }

  const question = await db
    .prepare(`SELECT * FROM questions WHERE id = ? AND quiz_slug = ?`)
    .bind(room.current_question_id, quizSlug)
    .first();

  if (!question || !QUESTION_TYPES.has(question.type)) {
    return json({ error: "Fant ikke aktivt spørsmål." }, 404);
  }

  await upsertRoomPlayer(db, quizSlug, roomCode, playerName);

  if (question.type === "fibbage") {
    return submitFibbageGuess(db, body, quizSlug, roomCode, playerName, question, room);
  }

  if (room.state !== "OPEN") {
    return json({ error: "Dette spørsmålet er ikke åpent for svar." }, 409);
  }

  return submitMapGuess(db, body, quizSlug, roomCode, playerName, question);
}

async function joinRoom(request, db) {
  const body = await readJson(request);
  const quizSlug = cleanSlug(body.quizSlug || "");
  const roomCode = cleanRoomCode(body.roomCode || "main");
  const playerName = cleanPlayerName(body.playerName || "");

  if (!quizSlug || !playerName) {
    return json({ error: "Quiz-ID og spillernavn kreves." }, 400);
  }

  const quiz = await db.prepare(`SELECT slug FROM quizzes WHERE slug = ?`).bind(quizSlug).first();

  if (!quiz) {
    return json({ error: "Fant ikke quizen." }, 404);
  }

  await upsertRoomPlayer(db, quizSlug, roomCode, playerName);

  return json({ ok: true });
}

async function upsertRoomPlayer(db, quizSlug, roomCode, playerName) {
  const now = new Date().toISOString();
  const playerColor = await pickPlayerColor(db, quizSlug, roomCode);
  await db
    .prepare(
      `INSERT INTO room_players (quiz_slug, room_code, player_name, player_color, joined_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (quiz_slug, room_code, player_name)
       DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        player_color = CASE
          WHEN room_players.player_color IS NULL OR room_players.player_color = ''
          THEN excluded.player_color
          ELSE room_players.player_color
        END`
    )
    .bind(quizSlug, roomCode, playerName, playerColor, now, now)
    .run();
}

async function submitMapGuess(db, body, quizSlug, roomCode, playerName, question) {
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);

  if (!isLatLng(latitude, longitude)) {
    return json({ error: "Breddegrad og lengdegrad kreves for kartspørsmål." }, 400);
  }

  const mapAnswer = normalizeMapLocation(JSON.parse(question.answer_shape_json));
  const distanceKm = haversineKm(
    { latitude, longitude },
    {
      latitude: mapAnswer.correctLatitude,
      longitude: mapAnswer.correctLongitude
    }
  );
  const isCorrect = distanceKm <= mapAnswer.toleranceKm;

  await db
    .prepare(
      `INSERT INTO guesses (
        quiz_slug, room_code, question_id, player_name, x, y, is_correct, submitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (quiz_slug, room_code, question_id, player_name)
      DO UPDATE SET
        x = excluded.x,
        y = excluded.y,
        is_correct = excluded.is_correct,
        submitted_at = excluded.submitted_at`
    )
    .bind(
      quizSlug,
      roomCode,
      question.id,
      playerName,
      longitude,
      latitude,
      isCorrect ? 1 : 0,
      new Date().toISOString()
    )
    .run();

  return json({ ok: true, correct: isCorrect, distanceKm });
}

async function submitFibbageGuess(db, body, quizSlug, roomCode, playerName, question, room) {
  if (room.state === "OPEN") {
    const fibbage = normalizeFibbage(JSON.parse(question.answer_shape_json));
    const lieText = cleanFibbageText(body.lieText || body.answer || "");

    if (!lieText) {
      return json({ error: "Skriv en bløff før du sender inn." }, 400);
    }

    if (sameFibbageText(lieText, fibbage.truth)) {
      return json({ error: "Det er riktig svar. Prøv en troverdig bløff i stedet." }, 400);
    }

    const existingLies = await getFibbageLies(db, quizSlug, roomCode, question.id);
    const duplicate = existingLies.find(
      (lie) => cleanPlayerName(lie.playerName) !== playerName && sameFibbageText(lie.text, lieText)
    );

    if (duplicate) {
      return json({ error: "Det svaret er allerede sendt inn. Prøv en annen bløff." }, 400);
    }

    await db
      .prepare(
        `INSERT INTO fibbage_lies (
          quiz_slug, room_code, question_id, player_name, lie_text, submitted_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (quiz_slug, room_code, question_id, player_name)
        DO UPDATE SET
          lie_text = excluded.lie_text,
          submitted_at = excluded.submitted_at`
      )
      .bind(quizSlug, roomCode, question.id, playerName, lieText, new Date().toISOString())
      .run();

    const nextRoom = await maybeAdvanceFibbageToVoting(db, quizSlug, roomCode, question, room);
    const roomState = nextRoom.state || room.state;

    return json({
      ok: true,
      phase: roomState === "VOTING" ? "vote" : "lie",
      roomState
    });
  }

  if (room.state === "VOTING") {
    const choiceId = String(body.choiceId || "");
    const choices = await getFibbageChoices(db, quizSlug, roomCode, question);
    const choice = choices.find((item) => item.id === choiceId);

    if (!choice) {
      return json({ error: "Velg et av de tilgjengelige svarene." }, 400);
    }

    if (choice.author && cleanPlayerName(choice.author) === playerName) {
      return json({ error: "Du kan ikke stemme på din egen bløff." }, 400);
    }

    await db
      .prepare(
        `INSERT INTO fibbage_votes (
          quiz_slug, room_code, question_id, player_name, choice_id, submitted_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (quiz_slug, room_code, question_id, player_name)
        DO UPDATE SET
          choice_id = excluded.choice_id,
          submitted_at = excluded.submitted_at`
      )
      .bind(quizSlug, roomCode, question.id, playerName, choiceId, new Date().toISOString())
      .run();

    return json({ ok: true, phase: "vote", correct: choice.id === TRUTH_CHOICE_ID });
  }

  return json({ error: "Fibbage tar ikke imot svar akkurat nå." }, 409);
}

async function upsertQuiz(request, db) {
  const body = await readJson(request);
  const slug = cleanSlug(body.slug || "");
  const title = cleanTitle(body.title || body.slug || "");

  if (!slug || !title) {
    return json({ error: "Quiz-ID og tittel kreves." }, 400);
  }

  await db
    .prepare(
      `INSERT INTO quizzes (slug, title, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET title = excluded.title`
    )
    .bind(slug, title, new Date().toISOString())
    .run();

  return getAdminQuiz(db, slug);
}

async function getAdminQuiz(db, quizSlug) {
  const slug = cleanSlug(quizSlug);
  const quiz = await db.prepare(`SELECT * FROM quizzes WHERE slug = ?`).bind(slug).first();

  if (!quiz) {
    return json({ error: "Fant ikke quizen." }, 404);
  }

  const questions = await getQuestions(db, slug);
  const rooms = await db
    .prepare(`SELECT * FROM rooms WHERE quiz_slug = ? ORDER BY room_code`)
    .bind(slug)
    .all();

  return json({
    quiz,
    questions: questions.map((question) => questionDto(question, true)),
    rooms: rooms.results || []
  });
}

async function createQuestion(request, db) {
  const body = await readJson(request);
  const type = cleanQuestionType(body.type || "map-location");
  const quizSlug = cleanSlug(body.quizSlug || "");
  const prompt = cleanPrompt(body.prompt || "");

  if (!QUESTION_TYPES.has(type)) {
    return json({ error: "Bare kart- og Fibbage-spørsmål støttes." }, 400);
  }

  const input = {
    quizSlug,
    prompt,
    mapLocation: body.mapLocation || {},
    fibbage: body.fibbage || {}
  };
  const validation = validateQuestionInput(type, input);

  if (validation) {
    return json({ error: validation }, 400);
  }

  const quiz = await db.prepare(`SELECT slug FROM quizzes WHERE slug = ?`).bind(quizSlug).first();

  if (!quiz) {
    return json({ error: "Opprett quizen før du legger til spørsmål." }, 404);
  }

  const nextRow = await db
    .prepare(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
       FROM questions
       WHERE quiz_slug = ? AND type IN ('map-location', 'fibbage')`
    )
    .bind(quizSlug)
    .first();

  await insertQuestion(db, {
    id: crypto.randomUUID(),
    quizSlug,
    sequenceNumber: nextRow.next_sequence,
    type,
    prompt,
    mapLocation: normalizeMapLocation(body.mapLocation || {}),
    fibbage: normalizeFibbage(body.fibbage || {})
  });

  return getAdminQuiz(db, quizSlug);
}

async function updateQuestion(request, db, questionId) {
  const body = await readJson(request);
  const existing = await db.prepare(`SELECT * FROM questions WHERE id = ?`).bind(questionId).first();

  if (!existing) {
    return json({ error: "Fant ikke spørsmålet." }, 404);
  }

  const type = cleanQuestionType(body.type || existing.type);

  if (!QUESTION_TYPES.has(type)) {
    return json({ error: "Bare kart- og Fibbage-spørsmål støttes." }, 400);
  }

  const prompt = cleanPrompt(body.prompt || existing.prompt);
  const existingConfig = safeJson(existing.answer_shape_json);
  const mapLocation = body.mapLocation
    ? normalizeMapLocation(body.mapLocation)
    : normalizeMapLocation(existingConfig);
  const fibbage = body.fibbage
    ? normalizeFibbage(body.fibbage)
    : normalizeFibbage(existingConfig);
  const validation = validateQuestionInput(type, {
    quizSlug: existing.quiz_slug,
    prompt,
    mapLocation,
    fibbage
  });

  if (validation) {
    return json({ error: validation }, 400);
  }

  await db
    .prepare(
      `UPDATE questions
       SET type = ?, prompt = ?, image_data = '', image_width = 0, image_height = 0, answer_shape_json = ?
       WHERE id = ?`
    )
    .bind(type, prompt, JSON.stringify(type === "map-location" ? mapLocation : fibbage), questionId)
    .run();

  await clearQuestionSubmissions(db, questionId);

  return getAdminQuiz(db, existing.quiz_slug);
}

async function deleteQuestion(db, questionId) {
  const existing = await db.prepare(`SELECT * FROM questions WHERE id = ?`).bind(questionId).first();

  if (!existing) {
    return json({ error: "Fant ikke spørsmålet." }, 404);
  }

  await clearQuestionSubmissions(db, questionId);
  await db.prepare(`UPDATE rooms SET current_question_id = NULL WHERE current_question_id = ?`).bind(questionId).run();
  await db.prepare(`DELETE FROM questions WHERE id = ?`).bind(questionId).run();
  await resequenceQuizQuestions(db, existing.quiz_slug);

  return getAdminQuiz(db, existing.quiz_slug);
}

async function resequenceQuizQuestions(db, quizSlug) {
  const result = await db
    .prepare(
      `SELECT id
       FROM questions
       WHERE quiz_slug = ? AND type IN ('map-location', 'fibbage')
       ORDER BY sequence_number, created_at, id`
    )
    .bind(quizSlug)
    .all();
  const rows = result.results || [];

  if (rows.length === 0) {
    return;
  }

  await db.batch(
    rows.map((row, index) =>
      db
        .prepare(`UPDATE questions SET sequence_number = ? WHERE id = ?`)
        .bind(index + 1, row.id)
    )
  );
}

async function updateRoom(request, db) {
  const body = await readJson(request);
  const quizSlug = cleanSlug(body.quizSlug || "");
  const roomCode = cleanRoomCode(body.roomCode || "main");
  const questionId = body.questionId ? String(body.questionId) : null;
  const state = String(body.state || "").toUpperCase();

  if (!quizSlug || !STATES.has(state)) {
    return json({ error: "Quiz-ID og gyldig status kreves." }, 400);
  }

  let question = null;

  if (questionId) {
    question = await db
      .prepare(`SELECT id, type, answer_shape_json FROM questions WHERE id = ? AND quiz_slug = ?`)
      .bind(questionId, quizSlug)
      .first();

    if (!question || !QUESTION_TYPES.has(question.type)) {
      return json({ error: "Fant ikke spørsmålet i denne quizen." }, 404);
    }
  }

  if ((state === "VOTING" || state === "REVEALING") && question?.type !== "fibbage") {
    return json({ error: "Avstemning brukes bare for Fibbage-spørsmål." }, 400);
  }

  if (body.clearGuesses && questionId) {
    await clearRoomQuestionSubmissions(db, quizSlug, roomCode, questionId);
  }

  const existingRoom = await db
    .prepare(`SELECT * FROM rooms WHERE quiz_slug = ? AND room_code = ?`)
    .bind(quizSlug, roomCode)
    .first();
  const revealStep = await nextRevealStep(db, quizSlug, roomCode, question, questionId, state, existingRoom);

  await db
    .prepare(
      `INSERT INTO rooms (quiz_slug, room_code, current_question_id, state, reveal_step, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (quiz_slug, room_code)
       DO UPDATE SET
         current_question_id = excluded.current_question_id,
         state = excluded.state,
         reveal_step = excluded.reveal_step,
         updated_at = excluded.updated_at`
    )
    .bind(quizSlug, roomCode, questionId, state, revealStep, new Date().toISOString())
    .run();

  if (state === "REVEALED" && questionId) {
    await markQuestionRevealed(db, quizSlug, roomCode, questionId);
  }

  return getState(
    new Request(`https://local/api/state?quiz=${encodeURIComponent(quizSlug)}&room=${encodeURIComponent(roomCode)}&admin=1`),
    db,
    {}
  );
}

async function markQuestionRevealed(db, quizSlug, roomCode, questionId) {
  await db
    .prepare(
      `INSERT INTO room_question_results (quiz_slug, room_code, question_id, revealed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (quiz_slug, room_code, question_id)
       DO UPDATE SET revealed_at = excluded.revealed_at`
    )
    .bind(quizSlug, roomCode, questionId, new Date().toISOString())
    .run();
}

async function nextRevealStep(db, quizSlug, roomCode, question, questionId, state, existingRoom) {
  if (!question || question.type !== "fibbage" || !questionId) {
    return 0;
  }

  const falseChoiceCount = await countFibbageFalseChoices(db, quizSlug, roomCode, question);

  if (state === "REVEALING") {
    const previousStep = existingRoom?.current_question_id === questionId
      ? clampRevealStep(existingRoom.reveal_step, falseChoiceCount)
      : 0;
    return clampRevealStep(previousStep + 1, falseChoiceCount);
  }

  if (state === "REVEALED") {
    return falseChoiceCount;
  }

  return 0;
}

async function countFibbageFalseChoices(db, quizSlug, roomCode, question) {
  const choices = await getFibbageChoices(db, quizSlug, roomCode, question);
  return choices.filter((choice) => !choice.isTruth).length;
}

async function createSampleQuiz(request, db) {
  const body = await readJson(request);
  const slug = cleanSlug(body.slug || "kreta");
  const title = cleanTitle(body.title || "Kreta");

  if (!slug) {
    return json({ error: "Quiz-ID kreves." }, 400);
  }

  await db
    .prepare(
      `INSERT INTO quizzes (slug, title, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET title = excluded.title`
    )
    .bind(slug, title, new Date().toISOString())
    .run();

  let nextRow = await db
    .prepare(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
       FROM questions
       WHERE quiz_slug = ? AND type IN ('map-location', 'fibbage')`
    )
    .bind(slug)
    .first();

  for (const sample of sampleQuestions(slug)) {
    const existing = await db
      .prepare(`SELECT id FROM questions WHERE quiz_slug = ? AND prompt = ? AND type = ?`)
      .bind(slug, sample.prompt, sample.type)
      .first();

    if (!existing) {
      await insertQuestion(db, {
        ...sample,
        sequenceNumber: nextRow.next_sequence
      });
      nextRow = { next_sequence: nextRow.next_sequence + 1 };
    }
  }

  const firstQuestion = await db
    .prepare(
      `SELECT id FROM questions
       WHERE quiz_slug = ? AND type IN ('map-location', 'fibbage')
       ORDER BY sequence_number LIMIT 1`
    )
    .bind(slug)
    .first();

  if (firstQuestion) {
    await db
      .prepare(
        `INSERT INTO rooms (quiz_slug, room_code, current_question_id, state, reveal_step, updated_at)
         VALUES (?, 'main', ?, 'OPEN', 0, ?)
         ON CONFLICT (quiz_slug, room_code)
         DO UPDATE SET
           current_question_id = excluded.current_question_id,
           state = excluded.state,
           reveal_step = excluded.reveal_step,
           updated_at = excluded.updated_at`
      )
      .bind(slug, firstQuestion.id, new Date().toISOString())
      .run();
  }

  return getAdminQuiz(db, slug);
}

async function insertQuestion(db, question) {
  const id = question.id || crypto.randomUUID();
  const type = cleanQuestionType(question.type);
  const now = new Date().toISOString();
  const config = type === "map-location"
    ? normalizeMapLocation(question.mapLocation || {})
    : normalizeFibbage(question.fibbage || {});

  await db
    .prepare(
      `INSERT INTO questions (
        id, quiz_slug, sequence_number, type, prompt, image_data, image_width, image_height,
        answer_shape_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, '', 0, 0, ?, ?)`
    )
    .bind(
      id,
      question.quizSlug,
      question.sequenceNumber,
      type,
      question.prompt,
      JSON.stringify(config),
      now
    )
    .run();

  return id;
}

async function getQuestions(db, quizSlug) {
  const result = await db
    .prepare(
      `SELECT *
       FROM questions
       WHERE quiz_slug = ? AND type IN ('map-location', 'fibbage')
       ORDER BY sequence_number`
    )
    .bind(quizSlug)
    .all();

  return result.results || [];
}

async function getMapGuesses(db, quizSlug, roomCode, question) {
  const result = await db
    .prepare(
      `SELECT
        guesses.player_name,
        guesses.x,
        guesses.y,
        guesses.is_correct,
        guesses.submitted_at,
        room_players.player_color
       FROM guesses
       LEFT JOIN room_players
        ON room_players.quiz_slug = guesses.quiz_slug
        AND room_players.room_code = guesses.room_code
        AND room_players.player_name = guesses.player_name
       WHERE guesses.quiz_slug = ? AND guesses.room_code = ? AND guesses.question_id = ?
       ORDER BY guesses.submitted_at ASC`
    )
    .bind(quizSlug, roomCode, question.id)
    .all();
  const mapAnswer = normalizeMapLocation(JSON.parse(question.answer_shape_json));

  return (result.results || []).map((guess) => {
    const latitude = guess.y;
    const longitude = guess.x;
    const distanceKm = haversineKm(
      { latitude, longitude },
      {
        latitude: mapAnswer.correctLatitude,
        longitude: mapAnswer.correctLongitude
      }
    );

    return {
      type: "map-location",
      playerName: guess.player_name,
      playerColor: normalizePlayerColor(guess.player_color) || fallbackPlayerColor(guess.player_name),
      latitude,
      longitude,
      distanceKm,
      correct: distanceKm <= mapAnswer.toleranceKm,
      submittedAt: guess.submitted_at
    };
  });
}

async function maybeAdvanceFibbageToVoting(db, quizSlug, roomCode, question, room) {
  if (!room || room.state !== "OPEN") {
    return room;
  }

  const [playerCount, lieCount] = await Promise.all([
    countRoomPlayers(db, quizSlug, roomCode),
    countFibbageLies(db, quizSlug, roomCode, question.id)
  ]);

  if (playerCount < 1 || lieCount < playerCount) {
    return room;
  }

  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      `UPDATE rooms
       SET state = 'VOTING', reveal_step = 0, updated_at = ?
       WHERE quiz_slug = ? AND room_code = ? AND current_question_id = ?`
    )
    .bind(updatedAt, quizSlug, roomCode, question.id)
    .run();

  return {
    ...room,
    state: "VOTING",
    reveal_step: 0,
    updated_at: updatedAt
  };
}

async function countRoomPlayers(db, quizSlug, roomCode) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM room_players
       WHERE quiz_slug = ? AND room_code = ?`
    )
    .bind(quizSlug, roomCode)
    .first();

  return row?.count || 0;
}

async function countFibbageLies(db, quizSlug, roomCode, questionId) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM fibbage_lies
       WHERE quiz_slug = ? AND room_code = ? AND question_id = ?`
    )
    .bind(quizSlug, roomCode, questionId)
    .first();

  return row?.count || 0;
}

async function countSubmissions(db, quizSlug, roomCode, question, state) {
  if (question.type === "fibbage") {
    const table = state === "VOTING" || state === "REVEALING" || state === "REVEALED"
      ? "fibbage_votes"
      : "fibbage_lies";
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ${table}
         WHERE quiz_slug = ? AND room_code = ? AND question_id = ?`
      )
      .bind(quizSlug, roomCode, question.id)
      .first();
    return row?.count || 0;
  }

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM guesses
       WHERE quiz_slug = ? AND room_code = ? AND question_id = ?`
    )
    .bind(quizSlug, roomCode, question.id)
    .first();

  return row?.count || 0;
}

async function getLeaderboard(db, quizSlug, roomCode) {
  const players = await getRoomPlayers(db, quizSlug, roomCode);
  const scores = new Map();
  const playerColors = new Map();

  for (const player of players) {
    playerColors.set(cleanPlayerName(player.playerName), player.playerColor);
    ensureLeaderboardScore(scores, player.playerName, player.playerColor);
  }

  const revealed = await db
    .prepare(
      `SELECT questions.*
       FROM room_question_results
       INNER JOIN questions
        ON questions.id = room_question_results.question_id
       WHERE room_question_results.quiz_slug = ?
        AND room_question_results.room_code = ?
        AND questions.quiz_slug = ?
        AND questions.type IN ('map-location', 'fibbage')
       ORDER BY questions.sequence_number ASC`
    )
    .bind(quizSlug, roomCode, quizSlug)
    .all();

  for (const question of revealed.results || []) {
    const type = cleanQuestionType(question.type);
    if (type === "map-location") {
      await addMapLeaderboardPoints(db, quizSlug, roomCode, question.id, scores, playerColors);
    } else if (type === "fibbage") {
      await addFibbageLeaderboardPoints(db, quizSlug, roomCode, question, scores, playerColors);
    }
  }

  return [...scores.values()].sort((a, b) =>
    b.total - a.total || a.playerName.localeCompare(b.playerName, "nb-NO")
  );
}

async function addMapLeaderboardPoints(db, quizSlug, roomCode, questionId, scores, playerColors) {
  const result = await db
    .prepare(
      `SELECT guesses.player_name, guesses.is_correct, room_players.player_color
       FROM guesses
       LEFT JOIN room_players
        ON room_players.quiz_slug = guesses.quiz_slug
        AND room_players.room_code = guesses.room_code
        AND room_players.player_name = guesses.player_name
       WHERE guesses.quiz_slug = ? AND guesses.room_code = ? AND guesses.question_id = ?`
    )
    .bind(quizSlug, roomCode, questionId)
    .all();

  for (const guess of result.results || []) {
    const playerName = cleanPlayerName(guess.player_name);
    const playerColor = normalizePlayerColor(guess.player_color) ||
      playerColors.get(playerName) ||
      fallbackPlayerColor(playerName);
    const score = ensureLeaderboardScore(scores, playerName, playerColor);

    if (score && Number(guess.is_correct) === 1) {
      score.mapPoints += MAP_POINTS;
      score.total += MAP_POINTS;
    }
  }
}

async function addFibbageLeaderboardPoints(db, quizSlug, roomCode, question, scores, playerColors) {
  const lies = await getFibbageLies(db, quizSlug, roomCode, question.id);
  const votes = await getFibbageVotes(db, quizSlug, roomCode, question.id);
  const choices = await getFibbageChoices(db, quizSlug, roomCode, question);
  const questionScores = fibbageScores(votes, choices, lies);

  for (const questionScore of questionScores) {
    const playerName = cleanPlayerName(questionScore.playerName);
    const playerColor = playerColors.get(playerName) || fallbackPlayerColor(playerName);
    const score = ensureLeaderboardScore(scores, playerName, playerColor);
    if (!score) {
      continue;
    }
    score.truthPoints += questionScore.truthPoints;
    score.foolPoints += questionScore.foolPoints;
    score.total += questionScore.total;
  }
}

function ensureLeaderboardScore(scores, playerName, playerColor) {
  const cleanName = cleanPlayerName(playerName);

  if (!cleanName) {
    return null;
  }

  if (!scores.has(cleanName)) {
    scores.set(cleanName, {
      playerName: cleanName,
      playerColor: normalizePlayerColor(playerColor) || fallbackPlayerColor(cleanName),
      mapPoints: 0,
      truthPoints: 0,
      foolPoints: 0,
      total: 0
    });
  } else if (playerColor) {
    scores.get(cleanName).playerColor = normalizePlayerColor(playerColor) || scores.get(cleanName).playerColor;
  }

  return scores.get(cleanName);
}

function questionDto(row, includeAnswer) {
  const type = cleanQuestionType(row.type);
  const dto = {
    id: row.id,
    quizSlug: row.quiz_slug,
    sequenceNumber: row.sequence_number,
    type,
    prompt: row.prompt
  };

  if (type === "map-location") {
    const mapLocation = normalizeMapLocation(JSON.parse(row.answer_shape_json));
    dto.mapLocation = {
      centerLatitude: mapLocation.centerLatitude,
      centerLongitude: mapLocation.centerLongitude,
      zoom: mapLocation.zoom,
      toleranceKm: mapLocation.toleranceKm
    };

    if (hasValidMapBounds(mapLocation)) {
      dto.mapLocation.boundsNorth = mapLocation.boundsNorth;
      dto.mapLocation.boundsSouth = mapLocation.boundsSouth;
      dto.mapLocation.boundsEast = mapLocation.boundsEast;
      dto.mapLocation.boundsWest = mapLocation.boundsWest;
    }

    if (includeAnswer) {
      dto.mapLocation.correctLatitude = mapLocation.correctLatitude;
      dto.mapLocation.correctLongitude = mapLocation.correctLongitude;
    }
  }

  if (type === "fibbage") {
    const fibbage = normalizeFibbage(JSON.parse(row.answer_shape_json));
    dto.fibbage = {};

    if (includeAnswer) {
      dto.fibbage.truth = fibbage.truth;
    }
  }

  return dto;
}

async function getFibbageState(db, quizSlug, roomCode, question, options) {
  const state = options.state || "CLOSED";
  const playerName = options.playerName || "";
  const includePrivateDetails = options.includeAnswers || options.wantsAdmin;
  const fullyRevealed = state === "REVEALED";
  const players = await getRoomPlayers(db, quizSlug, roomCode);
  const lies = await getFibbageLies(db, quizSlug, roomCode, question.id);
  const votes = await getFibbageVotes(db, quizSlug, roomCode, question.id);
  const choices = await getFibbageChoices(db, quizSlug, roomCode, question);
  const falseChoices = choices.filter((choice) => !choice.isTruth);
  const revealStep = fullyRevealed
    ? falseChoices.length
    : state === "REVEALING"
      ? clampRevealStep(options.revealStep, falseChoices.length)
      : 0;
  const poppedChoiceIds = new Set(falseChoices.slice(0, revealStep).map((choice) => choice.id));
  const playerByName = new Map(players.map((player) => [cleanPlayerName(player.playerName), player]));
  const ownLie = playerName
    ? lies.find((lie) => cleanPlayerName(lie.playerName) === playerName)
    : null;
  const ownVote = playerName
    ? votes.find((vote) => cleanPlayerName(vote.playerName) === playerName)
    : null;
  const choiceById = new Map(choices.map((choice) => [choice.id, choice]));
  const voteDetails = votes.map((vote) => {
    const choice = choiceById.get(vote.choiceId);
    return {
      playerName: vote.playerName,
      choiceId: vote.choiceId,
      choiceText: choice?.text || "Unknown",
      correct: vote.choiceId === TRUTH_CHOICE_ID,
      fooledPlayerName: choice?.author || null,
      submittedAt: vote.submittedAt
    };
  });
  const votersByChoiceId = new Map();
  for (const vote of votes) {
    const player = playerByName.get(cleanPlayerName(vote.playerName));
    const voter = {
      playerName: vote.playerName,
      playerColor: player?.playerColor || fallbackPlayerColor(vote.playerName)
    };
    const voters = votersByChoiceId.get(vote.choiceId) || [];
    voters.push(voter);
    votersByChoiceId.set(vote.choiceId, voters);
  }
  const visibleChoices = choices
    .filter((choice) => includePrivateDetails || !isOwnFibbageLie(choice, playerName, state))
    .map((choice) => publicFibbageChoice(choice, {
      fullyRevealed,
      popped: poppedChoiceIds.has(choice.id),
      voters: votersByChoiceId.get(choice.id) || []
    }));
  const scores = includePrivateDetails ? fibbageScores(votes, choices, lies) : [];

  const payload = {
    phase: state,
    playerCount: players.length,
    lieCount: lies.length,
    voteCount: votes.length,
    revealStep,
    revealTotal: falseChoices.length,
    ownLie: ownLie ? { text: ownLie.text, submittedAt: ownLie.submittedAt } : null,
    ownVote: ownVote ? { choiceId: ownVote.choiceId, submittedAt: ownVote.submittedAt } : null
  };

  if (state === "VOTING" || state === "REVEALING" || includePrivateDetails || options.wantsAdmin) {
    payload.choices = visibleChoices;
  }

  if (includePrivateDetails || options.wantsAdmin) {
    payload.players = players;
    payload.lies = lies;
    payload.votes = voteDetails;
    payload.scores = scores;
  }

  return payload;
}

function isOwnFibbageLie(choice, playerName, state) {
  return state === "VOTING" &&
    playerName &&
    choice.author &&
    cleanPlayerName(choice.author) === playerName;
}

async function getRoomPlayers(db, quizSlug, roomCode) {
  const result = await db
    .prepare(
      `SELECT player_name, player_color, joined_at, last_seen_at
       FROM room_players
       WHERE quiz_slug = ? AND room_code = ?
       ORDER BY joined_at ASC`
    )
    .bind(quizSlug, roomCode)
    .all();

  return (result.results || []).map((player) => ({
    playerName: player.player_name,
    playerColor: normalizePlayerColor(player.player_color) || fallbackPlayerColor(player.player_name),
    joinedAt: player.joined_at,
    lastSeenAt: player.last_seen_at
  }));
}

async function backfillMissingPlayerColors(db) {
  const result = await db
    .prepare(
      `SELECT quiz_slug, room_code, player_name
       FROM room_players
       WHERE player_color IS NULL OR player_color = ''`
    )
    .all();

  for (const player of result.results || []) {
    const playerColor = await pickPlayerColor(db, player.quiz_slug, player.room_code);
    await db
      .prepare(
        `UPDATE room_players
         SET player_color = ?
         WHERE quiz_slug = ? AND room_code = ? AND player_name = ?`
      )
      .bind(playerColor, player.quiz_slug, player.room_code, player.player_name)
      .run();
  }
}

async function pickPlayerColor(db, quizSlug, roomCode) {
  const result = await db
    .prepare(
      `SELECT player_color
       FROM room_players
       WHERE quiz_slug = ? AND room_code = ?
        AND player_color IS NOT NULL
        AND player_color <> ''`
    )
    .bind(quizSlug, roomCode)
    .all();
  const usedColors = new Set(
    (result.results || [])
      .map((row) => normalizePlayerColor(row.player_color))
      .filter(Boolean)
  );
  const availableColors = PLAYER_COLORS.filter((color) => !usedColors.has(color));
  const palette = availableColors.length ? availableColors : PLAYER_COLORS;

  return palette[randomIndex(palette.length)];
}

function normalizePlayerColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : "";
}

function fallbackPlayerColor(playerName) {
  return PLAYER_COLORS[stableHash(cleanPlayerName(playerName)) % PLAYER_COLORS.length];
}

function randomIndex(length) {
  if (length <= 1) {
    return 0;
  }

  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] % length;
  }

  return Math.floor(Math.random() * length);
}

async function getFibbageLies(db, quizSlug, roomCode, questionId) {
  const result = await db
    .prepare(
      `SELECT player_name, lie_text, submitted_at
       FROM fibbage_lies
       WHERE quiz_slug = ? AND room_code = ? AND question_id = ?
       ORDER BY submitted_at ASC`
    )
    .bind(quizSlug, roomCode, questionId)
    .all();

  return (result.results || []).map((lie) => ({
    playerName: lie.player_name,
    text: lie.lie_text,
    submittedAt: lie.submitted_at
  }));
}

async function getFibbageVotes(db, quizSlug, roomCode, questionId) {
  const result = await db
    .prepare(
      `SELECT player_name, choice_id, submitted_at
       FROM fibbage_votes
       WHERE quiz_slug = ? AND room_code = ? AND question_id = ?
       ORDER BY submitted_at ASC`
    )
    .bind(quizSlug, roomCode, questionId)
    .all();

  return (result.results || []).map((vote) => ({
    playerName: vote.player_name,
    choiceId: vote.choice_id,
    submittedAt: vote.submitted_at
  }));
}

async function getFibbageChoices(db, quizSlug, roomCode, question) {
  const fibbage = normalizeFibbage(JSON.parse(question.answer_shape_json));
  const lies = await getFibbageLies(db, quizSlug, roomCode, question.id);
  const choices = [
    {
      id: TRUTH_CHOICE_ID,
      text: fibbage.truth,
      source: "truth",
      author: null,
      isTruth: true
    }
  ];

  for (const lie of lies) {
    choices.push({
      id: fibbageLieChoiceId(question.id, lie.playerName),
      text: lie.text,
      source: "lie",
      author: lie.playerName,
      isTruth: false
    });
  }

  return uniqueChoices(choices).sort((a, b) =>
    stableHash(question.id + "|" + a.id) - stableHash(question.id + "|" + b.id)
  );
}

function publicFibbageChoice(choice, options = {}) {
  const fullyRevealed = Boolean(options.fullyRevealed);
  const popped = Boolean(options.popped);
  const dto = {
    id: choice.id,
    text: choice.text
  };

  if (popped) {
    dto.popped = true;
    dto.source = choice.source;
    dto.author = choice.author;
    dto.isTruth = false;
    dto.voters = options.voters || [];
  }

  if (fullyRevealed) {
    dto.source = choice.source;
    dto.author = choice.author;
    dto.isTruth = choice.isTruth;
    dto.voters = options.voters || [];
  }

  return dto;
}

function clampRevealStep(value, max) {
  const numeric = Number(value);
  const step = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
  return Math.max(0, Math.min(step, Math.max(0, max)));
}

function fibbageScores(votes, choices, lies) {
  const choiceById = new Map(choices.map((choice) => [choice.id, choice]));
  const scores = new Map();

  for (const lie of lies) {
    ensureFibbageScore(scores, lie.playerName);
  }

  for (const vote of votes) {
    const voter = cleanPlayerName(vote.playerName);
    const choice = choiceById.get(vote.choiceId);

    if (!choice) {
      continue;
    }

    ensureFibbageScore(scores, voter);

    if (choice.id === TRUTH_CHOICE_ID) {
      const score = scores.get(voter);
      score.truthPoints += TRUTH_POINTS;
      score.total += TRUTH_POINTS;
      continue;
    }

    if (choice.author && cleanPlayerName(choice.author) !== voter) {
      const author = cleanPlayerName(choice.author);
      ensureFibbageScore(scores, author);
      const score = scores.get(author);
      score.foolPoints += FOOL_POINTS;
      score.total += FOOL_POINTS;
    }
  }

  return [...scores.values()].sort((a, b) => b.total - a.total || a.playerName.localeCompare(b.playerName));
}

function ensureFibbageScore(scores, playerName) {
  const cleanName = cleanPlayerName(playerName);

  if (cleanName && !scores.has(cleanName)) {
    scores.set(cleanName, { playerName: cleanName, truthPoints: 0, foolPoints: 0, total: 0 });
  }
}

function uniqueChoices(choices) {
  const seenText = new Set();
  const result = [];

  for (const choice of choices) {
    const normalized = normalizeFibbageComparable(choice.text);
    if (!normalized || seenText.has(normalized)) {
      continue;
    }
    seenText.add(normalized);
    result.push(choice);
  }

  return result;
}

async function clearQuestionSubmissions(db, questionId) {
  await db.prepare(`DELETE FROM guesses WHERE question_id = ?`).bind(questionId).run();
  await db.prepare(`DELETE FROM fibbage_lies WHERE question_id = ?`).bind(questionId).run();
  await db.prepare(`DELETE FROM fibbage_votes WHERE question_id = ?`).bind(questionId).run();
  await db.prepare(`DELETE FROM room_question_results WHERE question_id = ?`).bind(questionId).run();
}

async function clearRoomQuestionSubmissions(db, quizSlug, roomCode, questionId) {
  await db
    .prepare(`DELETE FROM guesses WHERE quiz_slug = ? AND room_code = ? AND question_id = ?`)
    .bind(quizSlug, roomCode, questionId)
    .run();
  await db
    .prepare(`DELETE FROM fibbage_lies WHERE quiz_slug = ? AND room_code = ? AND question_id = ?`)
    .bind(quizSlug, roomCode, questionId)
    .run();
  await db
    .prepare(`DELETE FROM fibbage_votes WHERE quiz_slug = ? AND room_code = ? AND question_id = ?`)
    .bind(quizSlug, roomCode, questionId)
    .run();
  await db
    .prepare(`DELETE FROM room_question_results WHERE quiz_slug = ? AND room_code = ? AND question_id = ?`)
    .bind(quizSlug, roomCode, questionId)
    .run();
}

function validateQuestionInput(type, input) {
  if (!input.quizSlug) {
    return "Quiz-ID kreves.";
  }

  if (!input.prompt) {
    return "Spørsmålstekst kreves.";
  }

  if (type === "map-location") {
    return validateMapLocationInput(input.mapLocation);
  }

  if (type === "fibbage") {
    return validateFibbageInput(input.fibbage);
  }

  return "Bare kart- og Fibbage-spørsmål støttes.";
}

function validateMapLocationInput(mapLocation) {
  const normalized = normalizeMapLocation(mapLocation);

  if (!isLatLng(normalized.centerLatitude, normalized.centerLongitude)) {
    return "Sett et gyldig kartsenter.";
  }

  if (!isLatLng(normalized.correctLatitude, normalized.correctLongitude)) {
    return "Klikk på riktig sted på kartet.";
  }

  if (!Number.isFinite(normalized.zoom) || normalized.zoom < 1 || normalized.zoom > 19) {
    return "Sett et gyldig zoomnivå mellom 1 og 19.";
  }

  if (hasAnyMapBounds(normalized) && !hasValidMapBounds(normalized)) {
    return "Sett et gyldig kartutsnitt.";
  }

  if (!Number.isFinite(normalized.toleranceKm) || normalized.toleranceKm <= 0 || normalized.toleranceKm > 20000) {
    return "Sett en gyldig toleranse i kilometer.";
  }

  return "";
}

function validateFibbageInput(fibbage) {
  const normalized = normalizeFibbage(fibbage);

  if (!normalized.truth) {
    return "Legg inn riktig svar for Fibbage-spørsmålet.";
  }

  return "";
}

function normalizeMapLocation(mapLocation) {
  return {
    centerLatitude: Number(mapLocation.centerLatitude),
    centerLongitude: Number(mapLocation.centerLongitude),
    zoom: Number(mapLocation.zoom),
    toleranceKm: Number(mapLocation.toleranceKm),
    correctLatitude: Number(mapLocation.correctLatitude),
    correctLongitude: Number(mapLocation.correctLongitude),
    boundsNorth: optionalNumber(mapLocation.boundsNorth),
    boundsSouth: optionalNumber(mapLocation.boundsSouth),
    boundsEast: optionalNumber(mapLocation.boundsEast),
    boundsWest: optionalNumber(mapLocation.boundsWest)
  };
}

function hasAnyMapBounds(mapLocation) {
  return (
    Number.isFinite(mapLocation.boundsNorth) ||
    Number.isFinite(mapLocation.boundsSouth) ||
    Number.isFinite(mapLocation.boundsEast) ||
    Number.isFinite(mapLocation.boundsWest)
  );
}

function hasValidMapBounds(mapLocation) {
  return (
    isLatLng(mapLocation.boundsNorth, mapLocation.boundsEast) &&
    isLatLng(mapLocation.boundsSouth, mapLocation.boundsWest) &&
    mapLocation.boundsNorth > mapLocation.boundsSouth &&
    mapLocation.boundsEast > mapLocation.boundsWest
  );
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeFibbage(fibbage) {
  const truth = cleanFibbageText(fibbage.truth || "");

  return {
    truth
  };
}

function cleanFibbageText(value) {
  return String(value).trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeFibbageComparable(value) {
  return cleanFibbageText(value).toLocaleLowerCase("nb-NO");
}

function sameFibbageText(a, b) {
  return normalizeFibbageComparable(a) === normalizeFibbageComparable(b);
}

function fibbageLieChoiceId(questionId, playerName) {
  return `lie:${stableHash(questionId + ":" + cleanPlayerName(playerName)).toString(36)}`;
}

function stableHash(value) {
  let hash = 2166136261;

  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function isLatLng(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function haversineKm(a, b) {
  const earthRadiusKm = 6371.0088;
  const lat1 = degreesToRadians(a.latitude);
  const lat2 = degreesToRadians(b.latitude);
  const deltaLat = degreesToRadians(b.latitude - a.latitude);
  const deltaLng = degreesToRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function sampleQuestions(slug) {
  return [
    sampleMap(slug, "Hvor er vi?", {
      centerLatitude: 35.45,
      centerLongitude: 24.2,
      zoom: 12,
      toleranceKm: 3,
      correctLatitude: 35.4506,
      correctLongitude: 24.2037
    }),
    sampleMap(
      slug,
      "Marina Satti fra Heraklion representerte Hellas i Eurovision i 2024 og endte p\u00e5 11. plass. Hvilket land vant?",
      {
        centerLatitude: 46.82,
        centerLongitude: 8.23,
        zoom: 5,
        toleranceKm: 150,
        correctLatitude: 46.8182,
        correctLongitude: 8.2275
      }
    ),
    sampleMap(
      slug,
      "Landet Hellas omtales med sitt endonym i dagligtalen til kun et f\u00e5tall spr\u00e5k. Hvor?",
      {
        centerLatitude: 61,
        centerLongitude: 8,
        zoom: 4,
        toleranceKm: 650,
        correctLatitude: 61,
        correctLongitude: 8
      }
    ),
    sampleMap(
      slug,
      "Den albanske visekongen Muhammad Ali ble i 1821 tildelt Kreta. Hvilket st\u00f8rre omr\u00e5de kontrollerte han i tillegg?",
      {
        centerLatitude: 26.82,
        centerLongitude: 30.8,
        zoom: 5,
        toleranceKm: 500,
        correctLatitude: 26.8206,
        correctLongitude: 30.8025
      }
    ),
    sampleMap(
      slug,
      "Hvilket italiensk fyrsted\u00f8mme styrte \u00f8ya fra det 13. til det 17. \u00e5rhundre?",
      {
        centerLatitude: 45.44,
        centerLongitude: 12.32,
        zoom: 6,
        toleranceKm: 65,
        correctLatitude: 45.4408,
        correctLongitude: 12.3155
      }
    ),
    sampleFibbage(slug, "Hva het maleren El Greco egentlig?", "Dom\u00e9nikos Theotok\u00f3poulos"),
    sampleFibbage(
      slug,
      "\u00d8ya Spinalonga utenfor Kreta var lenge en s\u00e5kalt spedalskkoloni. Hvilket objekt var forbudt p\u00e5 \u00f8ya?",
      "Speil"
    ),
    sampleFibbage(
      slug,
      "Den tyske Generalmajor Heinrich Kreipe ble i 1944 kidnappet av greske motstandsfolk. Hva kledde kidnapperen seg ut som?",
      "Generalmajoren selv"
    ),
    sampleFibbage(
      slug,
      "Hvilke to dyr levde tidligere p\u00e5 Kreta i egne dvergvarianter?",
      "Mammut og flodhest"
    ),
    sampleFibbage(
      slug,
      "Hvilket gigantisk objekt finnes p\u00e5 \u00f8ya Gavdos, og markerer Europas s\u00f8rligste punkt?",
      "Stol"
    ),
    sampleFibbage(
      slug,
      "Hva best\u00e5r de \u00f8vre etasjene av minospalasset p\u00e5 Knossos hovedsakelig av?",
      "Armert betong"
    ),
    sampleFibbage(
      slug,
      "Hvordan lyder den kretiske filosofen Epimenides' paradoks?",
      "Alle kretere er l\u00f8gnere"
    ),
    sampleFibbage(
      slug,
      "Hva var if\u00f8lge myten drapsv\u00e5penet da den kretiske kong Minos ble drept?",
      "Kokende vann"
    )
  ];
}

function sampleMap(slug, prompt, mapLocation) {
  return {
    id: crypto.randomUUID(),
    quizSlug: slug,
    type: "map-location",
    prompt,
    mapLocation
  };
}

function sampleFibbage(slug, prompt, truth) {
  return {
    id: crypto.randomUUID(),
    quizSlug: slug,
    type: "fibbage",
    prompt,
    fibbage: { truth }
  };
}

function cleanQuestionType(type) {
  return String(type || "").trim().toLowerCase();
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function getPathParts(pathParam) {
  if (Array.isArray(pathParam)) {
    return pathParam.flatMap((part) => String(part).split("/")).filter(Boolean);
  }

  if (typeof pathParam === "string") {
    return pathParam.split("/").filter(Boolean);
  }

  return [];
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function isAdmin(request, env) {
  const expected = env.ADMIN_KEY;

  if (!expected) {
    return true;
  }

  return request.headers.get("x-admin-key") === expected;
}

function cleanSlug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function cleanRoomCode(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "main";
}

function cleanPlayerName(value) {
  return String(value).trim().replace(/\s+/g, " ").slice(0, 40);
}

function cleanTitle(value) {
  return String(value).trim().replace(/\s+/g, " ").slice(0, 100);
}

function cleanPrompt(value) {
  return String(value).trim().replace(/\s+/g, " ").slice(0, 240);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-admin-key"
  };
}
