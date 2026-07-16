import { $, api, stateClass } from "./common.js";

const SUPPORTED_TYPES = new Set(["map-location", "fibbage"]);

const elements = {
  adminKey: $("#adminKey"),
  quizSlug: $("#quizSlug"),
  quizTitle: $("#quizTitle"),
  roomCode: $("#roomCode"),
  loadQuiz: $("#loadQuiz"),
  sampleQuiz: $("#sampleQuiz"),
  adminStatus: $("#adminStatus"),
  liveState: $("#liveState"),
  questionSelect: $("#questionSelect"),
  voteRoom: $("#voteRoom"),
  revealRoom: $("#revealRoom"),
  clearGuesses: $("#clearGuesses"),
  submissionCount: $("#submissionCount"),
  correctCount: $("#correctCount"),
  liveMap: $("#liveMap"),
  liveFibbage: $("#liveFibbage"),
  guessList: $("#guessList"),
  leaderboardList: $("#leaderboardList"),
  prompt: $("#prompt"),
  builderSummary: $("#builderSummary"),
  editQuestion: $("#editQuestion"),
  newQuestion: $("#newQuestion"),
  mapBuilder: $("#mapBuilder"),
  fibbageBuilder: $("#fibbageBuilder"),
  mapCenterLat: $("#mapCenterLat"),
  mapCenterLng: $("#mapCenterLng"),
  mapZoom: $("#mapZoom"),
  mapToleranceKm: $("#mapToleranceKm"),
  loadBuilderMap: $("#loadBuilderMap"),
  useCorrectAsCenter: $("#useCorrectAsCenter"),
  builderMap: $("#builderMap"),
  mapCorrectSummary: $("#mapCorrectSummary"),
  fibbageTruth: $("#fibbageTruth"),
  saveQuestion: $("#saveQuestion"),
  builderMessage: $("#builderMessage")
};

let latestState = null;
let pollTimer = null;
let builderType = "map-location";
let editingQuestionId = "";
let builderCorrect = null;
let builderBounds = null;
let builderMap = null;
let builderLayer = null;
let liveMap = null;
let liveLayer = null;

elements.adminKey.value = localStorage.getItem("trykkekviss-admin-key") || "";
elements.quizSlug.value = localStorage.getItem("trykkekviss-admin-quiz") || elements.quizSlug.value;
elements.roomCode.value = localStorage.getItem("trykkekviss-admin-room") || elements.roomCode.value;

elements.adminKey.addEventListener("input", () => {
  localStorage.setItem("trykkekviss-admin-key", elements.adminKey.value);
});
elements.quizSlug.addEventListener("input", () => {
  localStorage.setItem("trykkekviss-admin-quiz", elements.quizSlug.value);
});
elements.roomCode.addEventListener("input", () => {
  localStorage.setItem("trykkekviss-admin-room", elements.roomCode.value);
});

elements.loadQuiz.addEventListener("click", loadQuiz);
elements.sampleQuiz.addEventListener("click", createSampleQuiz);
elements.questionSelect.addEventListener("change", activateSelectedQuestion);
elements.voteRoom.addEventListener("click", () => setRoomState("VOTING"));
elements.revealRoom.addEventListener("click", revealNext);
elements.clearGuesses.addEventListener("click", clearAnswers);
elements.saveQuestion.addEventListener("click", saveQuestion);
elements.editQuestion.addEventListener("click", editSelectedQuestion);
elements.newQuestion.addEventListener("click", resetQuestionEditor);
elements.loadBuilderMap.addEventListener("click", refreshBuilderMap);
elements.useCorrectAsCenter.addEventListener("click", useCorrectAsCenter);
[
  elements.mapCenterLat,
  elements.mapCenterLng,
  elements.mapZoom
].forEach((input) => {
  input.addEventListener("change", () => {
    builderBounds = null;
    refreshBuilderMap();
  });
});
elements.mapToleranceKm.addEventListener("input", updateBuilderCorrect);

document.querySelectorAll("[data-question-type]").forEach((button) => {
  button.addEventListener("click", () => setQuestionType(button.dataset.questionType));
});

refreshBuilderMap();
loadQuiz();

async function loadQuiz() {
  const quizSlug = cleanSlug(elements.quizSlug.value);
  const title = elements.quizTitle.value.trim() || quizSlug || "Quiz";

  if (!quizSlug) {
    elements.adminStatus.textContent = "Quiz-ID mangler.";
    return;
  }

  elements.adminStatus.textContent = "Laster.";

  try {
    await api("/api/admin/quizzes", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ slug: quizSlug, title })
    });
    await refreshState();
    startPolling();
    elements.adminStatus.textContent = `Lastet: ${quizSlug}`;
  } catch (error) {
    elements.adminStatus.textContent = error.message;
  }
}

async function createSampleQuiz() {
  const quizSlug = cleanSlug(elements.quizSlug.value) || "kreta";
  const title = elements.quizTitle.value.trim() || "Kreta";
  elements.adminStatus.textContent = "Legger inn eksempel.";

  try {
    await api("/api/admin/sample", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ slug: quizSlug, title })
    });
    elements.quizSlug.value = quizSlug;
    elements.quizTitle.value = title;
    localStorage.setItem("trykkekviss-admin-quiz", quizSlug);
    await refreshState();
    startPolling();
    elements.adminStatus.textContent = "Eksempel klart.";
  } catch (error) {
    elements.adminStatus.textContent = error.message;
  }
}

function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(refreshState, 1500);
}

async function refreshState() {
  const quizSlug = cleanSlug(elements.quizSlug.value);
  const roomCode = cleanRoomCode(elements.roomCode.value);

  if (!quizSlug) {
    return;
  }

  try {
    latestState = await api(`/api/state?quiz=${encodeURIComponent(quizSlug)}&room=${encodeURIComponent(roomCode)}&admin=1`, {
      headers: adminHeaders()
    });
    render();
  } catch (error) {
    elements.adminStatus.textContent = error.message;
  }
}

function render() {
  const roomState = latestState?.room?.state || "CLOSED";
  const questions = (latestState?.questions || []).filter((question) => SUPPORTED_TYPES.has(question.type));
  renderQuestionSelect(questions);
  renderRoomState(roomState);
  syncEditorChrome(questions);

  const question = latestState?.question;
  elements.voteRoom.disabled = question?.type !== "fibbage" || roomState !== "OPEN";
  elements.revealRoom.disabled = !canRevealAnswer(question, roomState);

  if (!question) {
    elements.liveMap.classList.add("hidden");
    elements.liveFibbage.classList.add("hidden");
    elements.guessList.replaceChildren();
    elements.submissionCount.textContent = "0 levert";
    elements.correctCount.textContent = "0 riktige";
    return;
  }

  if (question.type === "map-location") {
    elements.liveMap.classList.remove("hidden");
    elements.liveFibbage.classList.add("hidden");
    renderLiveMap(question, latestState.guesses || [], roomState);
  } else {
    elements.liveMap.classList.add("hidden");
    elements.liveFibbage.classList.remove("hidden");
    renderFibbageAdmin(question, latestState.fibbage || {}, roomState);
  }

  renderStats(question, roomState);
  renderGuessList(question, latestState.guesses || [], latestState.fibbage || {}, roomState);
  renderLeaderboard(latestState.leaderboard || []);
}

function renderQuestionSelect(questions) {
  const previous = elements.questionSelect.value;
  const currentId = latestState?.room?.currentQuestionId || "";
  const preferred = currentId || previous;
  elements.questionSelect.replaceChildren();

  for (const question of questions) {
    const option = document.createElement("option");
    option.value = question.id;
    option.textContent = `${question.sequenceNumber}. ${typeLabel(question.type)} - ${question.prompt}`;
    elements.questionSelect.appendChild(option);
  }

  if (questions.some((question) => question.id === preferred)) {
    elements.questionSelect.value = preferred;
  } else if (questions.some((question) => question.id === currentId)) {
    elements.questionSelect.value = currentId;
  } else if (questions[0]) {
    elements.questionSelect.value = questions[0].id;
  }
}

async function activateSelectedQuestion() {
  await setRoomState("OPEN", { questionId: elements.questionSelect.value });
}

function syncEditorChrome(questions = getQuestionList()) {
  if (editingQuestionId && !questions.some((question) => question.id === editingQuestionId)) {
    editingQuestionId = "";
  }

  elements.editQuestion.disabled = !getSelectedQuestion();
  elements.saveQuestion.textContent = editingQuestionId ? "Oppdater" : "Lagre";
  elements.builderSummary.textContent = editorSummaryText(questions);
}

function editorSummaryText(questions = getQuestionList()) {
  const typeText = typeLabel(builderType).toLowerCase();

  if (!editingQuestionId) {
    return builderType === "map-location" ? "Nytt kartspørsmål" : `Nytt ${typeText}-spørsmål`;
  }

  const question = questions.find((item) => item.id === editingQuestionId);
  const sequence = question?.sequenceNumber ? `${question.sequenceNumber}. ` : "";
  return `Redigerer ${sequence}${typeText}-spørsmål`;
}

function getQuestionList() {
  return (latestState?.questions || []).filter((question) => SUPPORTED_TYPES.has(question.type));
}

function getSelectedQuestion() {
  const questionId = elements.questionSelect.value;
  return getQuestionList().find((question) => question.id === questionId) || null;
}

function renderRoomState(roomState) {
  elements.liveState.textContent = stateLabel(roomState);
  elements.liveState.className = `badge ${stateClass(roomState)}`;
}

function renderStats(question, roomState) {
  if (question.type === "fibbage") {
    const fibbage = latestState.fibbage || {};
    const playerCount = fibbage.playerCount || 0;
    if (roomState === "VOTING" || roomState === "REVEALING" || roomState === "REVEALED") {
      elements.submissionCount.textContent = `${fibbage.voteCount || 0}/${playerCount} stemmer`;
      elements.correctCount.textContent = `${fibbage.lieCount || 0}/${playerCount} bløffer`;
    } else {
      elements.submissionCount.textContent = `${fibbage.lieCount || 0}/${playerCount} bløffer`;
      elements.correctCount.textContent = `${playerCount} deltakere`;
    }
    return;
  }

  const guesses = latestState.guesses || [];
  elements.submissionCount.textContent = `${guesses.length} levert`;
  elements.correctCount.textContent = `${guesses.filter((guess) => guess.correct).length} riktige`;
}

function renderLiveMap(question, guesses, roomState) {
  const mapLocation = question.mapLocation;
  liveMap = liveMap || createLeafletMap(elements.liveMap, {
    interactive: false,
    zoomControl: false
  });
  liveLayer = liveLayer || L.layerGroup().addTo(liveMap);
  liveLayer.clearLayers();
  setMapQuestionView(liveMap, mapLocation);

  if (mapLocation.correctLatitude != null && mapLocation.correctLongitude != null) {
    L.circle([mapLocation.correctLatitude, mapLocation.correctLongitude], {
      radius: mapLocation.toleranceKm * 1000,
      color: "#23784f",
      fillColor: "#23784f",
      fillOpacity: roomState === "REVEALED" ? 0.14 : 0.06,
      weight: 2
    }).addTo(liveLayer);
    L.circleMarker([mapLocation.correctLatitude, mapLocation.correctLongitude], {
      radius: 7,
      color: "#23784f",
      fillColor: "#23784f",
      fillOpacity: 1,
      weight: 2
    }).bindTooltip("Riktig sted").addTo(liveLayer);
  }

  for (const guess of guesses) {
    if (roomState === "REVEALED") {
      addPlayerGuessMarker(liveLayer, guess);
      continue;
    }

    L.circleMarker([guess.latitude, guess.longitude], {
      radius: 6,
      color: guess.correct ? "#23784f" : "#a33838",
      fillColor: guess.correct ? "#23784f" : "#a33838",
      fillOpacity: 0.9,
      weight: 2
    }).bindTooltip(`${guess.playerName}: ${formatDistance(guess.distanceKm)}`).addTo(liveLayer);
  }

  requestAnimationFrame(() => liveMap.invalidateSize());
}

function renderFibbageAdmin(question, fibbage, roomState) {
  const stage = elements.liveFibbage;
  stage.replaceChildren();

  const meta = el("div", "fibbage-meta");
  meta.append(
    el("span", "badge", stateLabel(roomState)),
    el("span", "", `${fibbage.playerCount || 0} deltakere`),
    el("span", "", `${fibbage.lieCount || 0} bløffer`),
    el("span", "", `${fibbage.voteCount || 0} stemmer`)
  );
  if (roomState === "REVEALING") {
    meta.appendChild(el("span", "", `${fibbage.revealStep || 0}/${fibbage.revealTotal || 0} poppet`));
  }
  stage.appendChild(meta);

  if (roomState === "REVEALED" && question.fibbage?.truth) {
    const truth = el("div", "fibbage-card correct");
    truth.append(el("strong", "", "Fasit"), el("span", "", question.fibbage.truth));
    stage.appendChild(truth);
  }

  if ((roomState === "OPEN" || roomState === "CLOSED") && fibbage.lies?.length) {
    stage.appendChild(renderTextList("Bløffer", fibbage.lies.map((lie) => ({
      text: `${lie.playerName}: ${lie.text}`
    }))));
  }

  if (fibbage.choices?.length && (roomState === "VOTING" || roomState === "REVEALING" || roomState === "REVEALED")) {
    const choices = el("div", "fibbage-choice-grid");
    for (const choice of fibbage.choices) {
      const item = el("div", [
        "fibbage-choice",
        choice.isTruth ? "correct" : "",
        choice.popped ? "popped" : ""
      ].filter(Boolean).join(" "));
      const metaText = fibbageChoiceMeta(choice, roomState);
      item.appendChild(el("strong", "", choice.text));
      if (metaText) {
        item.appendChild(el("span", "muted", metaText));
      }
      if (choice.popped || roomState === "REVEALED") {
        item.appendChild(renderChoiceVoters(choice));
      }
      choices.appendChild(item);
    }
    stage.appendChild(choices);
  }

  if (roomState === "REVEALED" && fibbage.scores?.length) {
    stage.appendChild(renderTextList("Poeng", fibbage.scores.map((score) => ({
      text: `${score.playerName}: ${score.total} (${score.truthPoints} fasit, ${score.foolPoints} lurt)`
    }))));
  }
}

function fibbageChoiceMeta(choice, roomState) {
  if (roomState === "REVEALED") {
    return choice.author ? `Bløff av ${choice.author}` : "Fasit";
  }

  if (choice.popped) {
    return choice.author ? `Bløff av ${choice.author}` : "Bløff";
  }

  return "";
}

function renderChoiceVoters(choice) {
  const block = el("div", "fibbage-voters");
  const voters = choice.voters || [];

  if (!voters.length) {
    block.appendChild(el("span", "muted", "Ingen stemmer"));
    return block;
  }

  for (const voter of voters) {
    const chip = el("span", "fibbage-voter", voter.playerName);
    chip.style.setProperty("--player-color", voter.playerColor || "#657282");
    block.appendChild(chip);
  }

  return block;
}

function renderTextList(title, items) {
  const block = el("div", "fibbage-list");
  block.appendChild(el("h3", "", title));
  const list = document.createElement("ol");

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item.text;
    list.appendChild(li);
  }

  block.appendChild(list);
  return block;
}

function renderGuessList(question, guesses, fibbage, roomState) {
  elements.guessList.replaceChildren();

  if (question.type === "fibbage") {
    if (roomState === "REVEALED") {
      appendGuessRows((fibbage.votes || []).map((vote) => ({
        className: vote.correct ? "correct" : "wrong",
        text: `${vote.playerName}: ${vote.choiceText}${vote.fooledPlayerName ? ` (bløffen til ${vote.fooledPlayerName})` : ""}`
      })));
      return;
    }

    if (roomState === "REVEALING") {
      appendGuessRows((fibbage.choices || [])
        .filter((choice) => choice.popped)
        .flatMap((choice) => (choice.voters || []).map((voter) => ({
          className: "wrong",
          text: `${voter.playerName}: ${choice.text}`
        }))));
      return;
    }

    const rows = roomState === "OPEN" || roomState === "CLOSED"
      ? (fibbage.lies || []).map((lie) => ({
          className: "",
          text: `${lie.playerName}: ${lie.text}`
        }))
      : [];
    appendGuessRows(rows);
    return;
  }

  appendGuessRows(guesses.map((guess) => ({
    className: guess.correct ? "correct" : "wrong",
    text: `${guess.playerName}: ${formatDistance(guess.distanceKm)} (${guess.correct ? "riktig" : "utenfor toleranse"})`
  })));
}

function appendGuessRows(rows) {
  for (const row of rows) {
    const item = document.createElement("li");
    item.className = row.className;
    item.textContent = row.text;
    elements.guessList.appendChild(item);
  }
}

async function setRoomState(state, options = {}) {
  const quizSlug = cleanSlug(elements.quizSlug.value);
  const roomCode = cleanRoomCode(elements.roomCode.value);
  const selectedQuestionId = elements.questionSelect.value;
  const currentQuestionId = latestState?.room?.currentQuestionId || selectedQuestionId;
  const questionId = options.questionId || (state === "OPEN" ? selectedQuestionId : currentQuestionId);

  if (!quizSlug || !questionId) {
    elements.adminStatus.textContent = "Spørsmål mangler.";
    return;
  }

  try {
    await api("/api/admin/room", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ quizSlug, roomCode, questionId, state })
    });
    await refreshState();
  } catch (error) {
    elements.adminStatus.textContent = error.message;
  }
}

async function revealNext() {
  const question = latestState?.question;
  const roomState = latestState?.room?.state || "CLOSED";

  if (!question) {
    return;
  }

  if (question.type === "fibbage") {
    const fibbage = latestState?.fibbage || {};
    const nextState = (roomState === "OPEN" || roomState === "VOTING" || roomState === "REVEALING") &&
      (fibbage.revealStep || 0) < (fibbage.revealTotal || 0)
      ? "REVEALING"
      : "REVEALED";
    await setRoomState(nextState);
    return;
  }

  await setRoomState("REVEALED");
}

function canRevealAnswer(question, roomState) {
  if (!question || roomState === "REVEALED") {
    return false;
  }

  if (question.type === "fibbage") {
    return roomState === "OPEN" || roomState === "VOTING" || roomState === "REVEALING";
  }

  return true;
}

async function clearAnswers() {
  const quizSlug = cleanSlug(elements.quizSlug.value);
  const roomCode = cleanRoomCode(elements.roomCode.value);
  const questionId = latestState?.room?.currentQuestionId || elements.questionSelect.value;

  if (!quizSlug || !questionId) {
    return;
  }

  try {
    await api("/api/admin/room", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ quizSlug, roomCode, questionId, state: "OPEN", clearGuesses: true })
    });
    await refreshState();
  } catch (error) {
    elements.adminStatus.textContent = error.message;
  }
}

function editSelectedQuestion() {
  const question = getSelectedQuestion();

  if (!question) {
    elements.builderMessage.textContent = "Velg et spørsmål å redigere.";
    return;
  }

  loadQuestionIntoEditor(question);
}

function loadQuestionIntoEditor(question) {
  editingQuestionId = question.id;
  elements.prompt.value = question.prompt || "";

  if (question.type === "map-location") {
    const mapLocation = question.mapLocation || {};
    setQuestionType("map-location", { keepMessage: true });
    setNumberInput(elements.mapCenterLat, mapLocation.centerLatitude, 5);
    setNumberInput(elements.mapCenterLng, mapLocation.centerLongitude, 5);
    setNumberInput(elements.mapZoom, mapLocation.zoom, 1);
    setNumberInput(elements.mapToleranceKm, mapLocation.toleranceKm, 2);
    builderBounds = mapBoundsFromLocation(mapLocation);
    builderCorrect = isFiniteCoordinate(mapLocation.correctLatitude, mapLocation.correctLongitude)
      ? {
          latitude: Number(mapLocation.correctLatitude),
          longitude: Number(mapLocation.correctLongitude)
        }
      : null;
    refreshBuilderMap();
  } else {
    setQuestionType("fibbage", { keepMessage: true });
    builderCorrect = null;
    builderBounds = null;
    elements.fibbageTruth.value = question.fibbage?.truth || "";
    updateBuilderCorrect();
  }

  elements.builderMessage.textContent = "Lastet for redigering.";
  syncEditorChrome();
}

function resetQuestionEditor() {
  editingQuestionId = "";
  elements.prompt.value = "";
  elements.fibbageTruth.value = "";
  builderCorrect = null;
  builderBounds = null;
  setQuestionType(builderType, { keepMessage: true });
  updateBuilderCorrect();
  elements.builderMessage.textContent = defaultBuilderMessage();
  syncEditorChrome();
}

function setQuestionType(type, options = {}) {
  builderType = SUPPORTED_TYPES.has(type) ? type : "map-location";

  if (builderType !== "map-location") {
    builderBounds = null;
  }

  document.querySelectorAll("[data-question-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.questionType === builderType);
  });

  elements.mapBuilder.classList.toggle("hidden", builderType !== "map-location");
  elements.fibbageBuilder.classList.toggle("hidden", builderType !== "fibbage");
  syncEditorChrome();

  if (!options.keepMessage) {
    elements.builderMessage.textContent = defaultBuilderMessage();
  }

  if (builderType === "map-location") {
    refreshBuilderMap();
  }
}

async function saveQuestion() {
  const quizSlug = cleanSlug(elements.quizSlug.value);
  const prompt = elements.prompt.value.trim();

  if (!quizSlug || !prompt) {
    elements.builderMessage.textContent = "Quiz-ID og spørsmålstekst mangler.";
    return;
  }

  const body = {
    quizSlug,
    prompt,
    type: builderType
  };

  if (builderType === "map-location") {
    if (!builderCorrect) {
      elements.builderMessage.textContent = "Kartfasit ikke satt.";
      return;
    }
    body.mapLocation = {
      ...readMapInputs(),
      ...readBuilderBounds(),
      correctLatitude: builderCorrect.latitude,
      correctLongitude: builderCorrect.longitude
    };
  } else {
    body.fibbage = {
      truth: elements.fibbageTruth.value.trim()
    };
  }

  const isEditing = Boolean(editingQuestionId);
  const path = isEditing
    ? `/api/admin/questions/${encodeURIComponent(editingQuestionId)}`
    : "/api/admin/questions";

  try {
    await api(path, {
      method: isEditing ? "PUT" : "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body)
    });

    if (!isEditing) {
      elements.prompt.value = "";
      elements.fibbageTruth.value = "";
      builderCorrect = null;
      builderBounds = null;
      updateBuilderCorrect();
    }

    await refreshState();
    elements.builderMessage.textContent = isEditing ? "Oppdatert." : "Lagret.";
  } catch (error) {
    elements.builderMessage.textContent = error.message;
  }
}

function refreshBuilderMap() {
  if (builderType !== "map-location") {
    return;
  }

  const mapLocation = readMapInputs();
  const bounds = builderBounds;
  builderMap = builderMap || createLeafletMap(elements.builderMap, {
    interactive: true,
    zoomControl: true
  });
  builderLayer = builderLayer || L.layerGroup().addTo(builderMap);
  if (bounds) {
    builderMap.fitBounds(bounds, { animate: false, padding: [0, 0] });
    builderBounds = null;
  } else {
    builderMap.setView([mapLocation.centerLatitude, mapLocation.centerLongitude], mapLocation.zoom);
  }
  builderMap.off("click", handleBuilderMapClick);
  builderMap.on("click", handleBuilderMapClick);
  builderMap.off("moveend", syncBuilderMapInputs);
  builderMap.off("zoomend", syncBuilderMapInputs);
  builderMap.on("moveend", syncBuilderMapInputs);
  builderMap.on("zoomend", syncBuilderMapInputs);
  syncBuilderMapInputs();
  updateBuilderCorrect();
  requestAnimationFrame(() => builderMap.invalidateSize());
}

function handleBuilderMapClick(event) {
  builderCorrect = {
    latitude: event.latlng.lat,
    longitude: event.latlng.lng
  };
  updateBuilderCorrect();
}

function syncBuilderMapInputs() {
  if (!builderMap || builderType !== "map-location") {
    return;
  }

  const center = builderMap.getCenter();
  setNumberInput(elements.mapCenterLat, center.lat, 5);
  setNumberInput(elements.mapCenterLng, center.lng, 5);
  setNumberInput(elements.mapZoom, builderMap.getZoom(), 1);
}

function updateBuilderCorrect() {
  if (!builderLayer) {
    return;
  }

  builderLayer.clearLayers();

  if (!builderCorrect) {
    elements.mapCorrectSummary.textContent = "Fasit ikke satt.";
    return;
  }

  const toleranceKm = Number(elements.mapToleranceKm.value) || 1;
  L.circle([builderCorrect.latitude, builderCorrect.longitude], {
    radius: toleranceKm * 1000,
    color: "#23784f",
    fillColor: "#23784f",
    fillOpacity: 0.16,
    weight: 2
  }).addTo(builderLayer);
  L.circleMarker([builderCorrect.latitude, builderCorrect.longitude], {
    radius: 7,
    color: "#23784f",
    fillColor: "#23784f",
    fillOpacity: 1,
    weight: 2
  }).addTo(builderLayer);
  elements.mapCorrectSummary.textContent = `Fasit: ${builderCorrect.latitude.toFixed(5)}, ${builderCorrect.longitude.toFixed(5)}`;
}

function useCorrectAsCenter() {
  if (!builderCorrect) {
    elements.builderMessage.textContent = "Kartfasit ikke satt.";
    return;
  }

  elements.mapCenterLat.value = builderCorrect.latitude.toFixed(5);
  elements.mapCenterLng.value = builderCorrect.longitude.toFixed(5);
  refreshBuilderMap();
}

function readMapInputs() {
  return {
    centerLatitude: Number(elements.mapCenterLat.value),
    centerLongitude: Number(elements.mapCenterLng.value),
    zoom: Number(elements.mapZoom.value),
    toleranceKm: Number(elements.mapToleranceKm.value)
  };
}

function readBuilderBounds() {
  if (!builderMap) {
    return {};
  }

  const bounds = builderMap.wrapLatLngBounds
    ? builderMap.wrapLatLngBounds(builderMap.getBounds())
    : builderMap.getBounds();

  return {
    boundsNorth: bounds.getNorth(),
    boundsSouth: bounds.getSouth(),
    boundsEast: bounds.getEast(),
    boundsWest: bounds.getWest()
  };
}

function defaultBuilderMessage() {
  return builderType === "fibbage" ? "Riktig svar mangler." : "Kartfasit ikke satt.";
}

function setNumberInput(input, value, decimals) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return;
  }

  input.value = decimals > 0
    ? String(Number(number.toFixed(decimals)))
    : String(Math.round(number));
}

function isFiniteCoordinate(latitude, longitude) {
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
}

function createLeafletMap(element, options = {}) {
  const map = L.map(element, {
    dragging: options.interactive,
    scrollWheelZoom: options.interactive,
    doubleClickZoom: options.interactive,
    boxZoom: options.interactive,
    keyboard: options.interactive,
    tap: options.interactive,
    touchZoom: options.interactive,
    zoomControl: options.zoomControl,
    zoomSnap: 0.1
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  return map;
}

function setMapQuestionView(map, mapLocation) {
  const bounds = mapBoundsFromLocation(mapLocation);

  if (bounds) {
    map.fitBounds(bounds, { animate: false, padding: [0, 0] });
    return;
  }

  map.setView([mapLocation.centerLatitude, mapLocation.centerLongitude], mapLocation.zoom);
}

function mapBoundsFromLocation(mapLocation) {
  if (!hasMapBounds(mapLocation)) {
    return null;
  }

  return [
    [Number(mapLocation.boundsSouth), Number(mapLocation.boundsWest)],
    [Number(mapLocation.boundsNorth), Number(mapLocation.boundsEast)]
  ];
}

function hasMapBounds(mapLocation) {
  const north = Number(mapLocation.boundsNorth);
  const south = Number(mapLocation.boundsSouth);
  const east = Number(mapLocation.boundsEast);
  const west = Number(mapLocation.boundsWest);

  return (
    Number.isFinite(north) &&
    Number.isFinite(south) &&
    Number.isFinite(east) &&
    Number.isFinite(west) &&
    north > south &&
    east > west
  );
}

function adminHeaders() {
  const key = elements.adminKey.value.trim();
  return key ? { "x-admin-key": key } : {};
}

function cleanSlug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanRoomCode(value) {
  return cleanSlug(value) || "main";
}

function typeLabel(type) {
  if (type === "fibbage") {
    return "Fibbage";
  }

  return "Kart";
}

function stateLabel(state) {
  const normalized = String(state || "CLOSED").toUpperCase();

  if (normalized === "OPEN") {
    return "Åpen";
  }

  if (normalized === "VOTING") {
    return "Avstemning";
  }

  if (normalized === "REVEALING") {
    return "Popper";
  }

  if (normalized === "REVEALED") {
    return "Fasit";
  }

  return "Stengt";
}

function formatDistance(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return value < 10 ? `${value.toFixed(1)} km` : `${Math.round(value)} km`;
}

function addPlayerGuessMarker(layer, guess) {
  L.marker([guess.latitude, guess.longitude], {
    icon: playerAnswerIcon(guess)
  })
    .bindTooltip(`${guess.playerName}: ${formatDistance(guess.distanceKm)}`)
    .addTo(layer);
}

function playerAnswerIcon(guess) {
  const playerColor = safeHexColor(guess.playerColor);
  const statusColor = guess.correct ? "#23784f" : "#a33838";
  const playerName = String(guess.playerName || "").trim() || "Deltaker";

  return L.divIcon({
    className: "player-answer-icon",
    html: `<div class="player-answer-dot" style="--player-color: ${playerColor}; --answer-status-color: ${statusColor};"><span>${escapeHtml(playerName)}</span></div>`,
    iconAnchor: [29, 29],
    iconSize: [58, 58]
  });
}

function safeHexColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#146c6f";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function el(tagName, className = "", text = "") {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (text) {
    node.textContent = text;
  }

  return node;
}
