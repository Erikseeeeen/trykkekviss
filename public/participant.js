import { $, api } from "./common.js";

const DEFAULT_QUIZ_SLUG = "kreta";
const DEFAULT_ROOM_CODE = "main";

const elements = {
  playerSetup: $("#playerSetup"),
  questionArea: $("#questionArea"),
  playerName: $("#playerName"),
  joinButton: $("#joinButton"),
  setupMessage: $("#setupMessage"),
  questionPrompt: $("#questionPrompt"),
  answerCount: $("#answerCount"),
  mapStage: $("#mapStage"),
  fibbageStage: $("#fibbageStage"),
  submitGuess: $("#submitGuess"),
  playerMessage: $("#playerMessage"),
  leaderboardList: $("#leaderboardList")
};

let latestState = null;
let pollTimer = null;
let activeQuestionId = "";
let selectedLatLng = null;
let selectedChoiceId = "";
let fibbageLieDraft = "";
let fibbageLieError = "";
let playerMap = null;
let playerLayer = null;
let hasJoined = false;

elements.playerName.value = localStorage.getItem("trykkekviss-player-name") || "";

elements.playerName.addEventListener("input", () => {
  localStorage.setItem("trykkekviss-player-name", elements.playerName.value);
});
elements.joinButton.addEventListener("click", joinRoom);
elements.submitGuess.addEventListener("click", submitCurrent);
elements.fibbageStage.addEventListener("input", (event) => {
  if (event.target.matches("#fibbageLieInput")) {
    fibbageLieDraft = event.target.value;
    fibbageLieError = "";
    updateSubmitState();
    updateMessage(latestState?.question, latestState?.room?.state || "CLOSED");
  }
});
elements.fibbageStage.addEventListener("click", (event) => {
  const button = event.target.closest("[data-choice-id]");
  if (!button || latestState?.room?.state !== "VOTING") {
    return;
  }

  selectedChoiceId = button.dataset.choiceId;
  renderFibbage(latestState.question, latestState.fibbage || {}, latestState.room.state);
  updateSubmitState();
});

if (elements.playerName.value.trim()) {
  joinRoom();
} else {
  elements.playerName.focus();
}

async function joinRoom() {
  const playerName = cleanPlayerName(elements.playerName.value);

  if (!playerName) {
    elements.setupMessage.textContent = "Navn mangler.";
    return;
  }

  localStorage.setItem("trykkekviss-player-name", playerName);
  elements.playerName.value = playerName;
  elements.joinButton.disabled = true;
  elements.setupMessage.textContent = "Blir med.";

  try {
    await api("/api/join", {
      method: "POST",
      body: JSON.stringify({
        quizSlug: DEFAULT_QUIZ_SLUG,
        roomCode: DEFAULT_ROOM_CODE,
        playerName
      })
    });
    hasJoined = true;
    elements.playerSetup.classList.add("hidden");
    elements.questionArea.classList.remove("hidden");
    elements.setupMessage.textContent = "";
    await refreshState();
    startPolling();
    elements.playerMessage.textContent = "";
  } catch (error) {
    elements.joinButton.disabled = false;
    elements.setupMessage.textContent = error.message;
  }
}

function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(refreshState, 1500);
}

async function refreshState() {
  if (!hasJoined) {
    return;
  }

  const playerName = cleanPlayerName(elements.playerName.value);

  try {
    latestState = await api(
      `/api/state?quiz=${encodeURIComponent(DEFAULT_QUIZ_SLUG)}&room=${encodeURIComponent(DEFAULT_ROOM_CODE)}&playerName=${encodeURIComponent(playerName)}`
    );
    render();
  } catch (error) {
    elements.playerMessage.textContent = error.message;
  }
}

function render() {
  const question = latestState?.question;
  const roomState = latestState?.room?.state || "CLOSED";

  if (question?.id !== activeQuestionId) {
    activeQuestionId = question?.id || "";
    selectedLatLng = null;
    selectedChoiceId = "";
    fibbageLieDraft = "";
    fibbageLieError = "";
  }

  elements.questionPrompt.textContent = question?.prompt || "Ingen spørsmål lastet";
  elements.answerCount.textContent = answerCountText(question, roomState);

  if (!question) {
    elements.mapStage.classList.add("hidden");
    elements.fibbageStage.classList.add("hidden");
    elements.submitGuess.disabled = true;
    elements.playerMessage.textContent = "";
    elements.playerMessage.classList.remove("error-text");
    renderLeaderboard(latestState?.leaderboard || []);
    return;
  }

  if (question.type === "map-location") {
    elements.mapStage.classList.remove("hidden");
    elements.fibbageStage.classList.add("hidden");
    renderMap(question, latestState.guesses || [], roomState);
  } else {
    elements.mapStage.classList.add("hidden");
    elements.fibbageStage.classList.remove("hidden");
    renderFibbage(question, latestState.fibbage || {}, roomState);
  }

  updateSubmitState();
  updateMessage(question, roomState);
  renderLeaderboard(latestState.leaderboard || []);
}

function answerCountText(question, roomState) {
  if (!question) {
    return "0 svar";
  }

  if (question.type === "fibbage") {
    const fibbage = latestState?.fibbage || {};
    const playerCount = fibbage.playerCount || 0;
    return roomState === "VOTING" || roomState === "REVEALING" || roomState === "REVEALED"
      ? `${fibbage.voteCount || 0}/${playerCount} stemmer`
      : `${fibbage.lieCount || 0}/${playerCount} bløffer`;
  }

  return `${latestState?.submissionsCount || 0} svar`;
}

function renderMap(question, guesses, roomState) {
  const mapLocation = question.mapLocation;
  playerMap = playerMap || createLeafletMap(elements.mapStage);
  playerLayer = playerLayer || L.layerGroup().addTo(playerMap);
  playerLayer.clearLayers();
  unlockPlayerMapZoom(playerMap);
  setMapQuestionView(playerMap, mapLocation);
  lockPlayerMapZoom(playerMap, playerMap.getZoom());
  playerMap.off("click", handleMapClick);
  playerMap.on("click", handleMapClick);

  if (roomState === "REVEALED" && mapLocation.correctLatitude != null && mapLocation.correctLongitude != null) {
    L.circle([mapLocation.correctLatitude, mapLocation.correctLongitude], {
      radius: mapLocation.toleranceKm * 1000,
      color: "#23784f",
      fillColor: "#23784f",
      fillOpacity: 0.14,
      weight: 2
    }).addTo(playerLayer);
    L.circleMarker([mapLocation.correctLatitude, mapLocation.correctLongitude], {
      radius: 8,
      color: "#23784f",
      fillColor: "#23784f",
      fillOpacity: 1,
      weight: 2
    }).bindTooltip("Riktig sted").addTo(playerLayer);
  }

  for (const guess of guesses) {
    addPlayerGuessMarker(playerLayer, guess);
  }

  if (roomState === "OPEN" && selectedLatLng) {
    L.circleMarker([selectedLatLng.latitude, selectedLatLng.longitude], {
      radius: 4,
      color: "#1f6feb",
      fillColor: "#1f6feb",
      fillOpacity: 0.95,
      weight: 2
    }).bindTooltip("Ditt svar").addTo(playerLayer);
  }

  requestAnimationFrame(() => playerMap.invalidateSize());
}

async function handleMapClick(event) {
  if (latestState?.question?.type !== "map-location" || latestState?.room?.state !== "OPEN") {
    return;
  }

  selectedLatLng = {
    latitude: event.latlng.lat,
    longitude: event.latlng.lng
  };
  renderMap(latestState.question, latestState.guesses || [], latestState.room.state);
  updateSubmitState();
  await submitCurrent();
}

function renderFibbage(question, fibbage, roomState) {
  const stage = elements.fibbageStage;

  if (roomState === "OPEN") {
    renderFibbageOpen(stage, question, fibbage, roomState);
    return;
  }

  stage.replaceChildren();
  stage.dataset.fibbageQuestionId = question.id;
  stage.dataset.fibbagePhase = roomState;

  if (roomState === "VOTING") {
    if (fibbage.ownVote?.choiceId && !selectedChoiceId) {
      selectedChoiceId = fibbage.ownVote.choiceId;
    }

    const choices = el("div", "fibbage-choice-grid");
    for (const choice of fibbage.choices || []) {
      const isSelected = selectedChoiceId === choice.id;
      const isSubmitted = fibbage.ownVote?.choiceId === choice.id;
      const button = el("button", [
        "fibbage-choice",
        isSelected ? "selected" : "",
        isSubmitted ? "submitted" : ""
      ].filter(Boolean).join(" "));
      button.type = "button";
      button.dataset.choiceId = choice.id;
      button.appendChild(el("strong", "", choice.text));
      if (isSubmitted) {
        button.appendChild(el("span", "choice-confirmation", "Stemt"));
      }
      choices.appendChild(button);
    }
    stage.appendChild(choices);
    return;
  }

  if (roomState === "REVEALING" || roomState === "REVEALED") {
    const choices = el("div", "fibbage-choice-grid");
    for (const choice of fibbage.choices || []) {
      const card = el("div", [
        "fibbage-choice",
        choice.isTruth ? "correct" : "",
        choice.popped ? "popped" : ""
      ].filter(Boolean).join(" "));
      const metaText = fibbageChoiceMeta(choice, roomState);
      card.appendChild(el("strong", "", choice.text));
      if (metaText) {
        card.appendChild(el("span", "muted", metaText));
      }
      if (choice.popped || roomState === "REVEALED") {
        card.appendChild(renderChoiceVoters(choice));
      }
      choices.appendChild(card);
    }
    stage.appendChild(choices);

    if (roomState === "REVEALED" && fibbage.votes?.length) {
      stage.appendChild(renderTextList("Stemmer", fibbage.votes.map((vote) => ({
        text: `${vote.playerName}: ${vote.choiceText}`
      }))));
    }

    if (roomState === "REVEALED" && fibbage.scores?.length) {
      stage.appendChild(renderTextList("Poeng", fibbage.scores.map((score) => ({
        text: `${score.playerName}: ${score.total}`
      }))));
    }
    return;
  }

  stage.appendChild(el("p", "muted", "Venter på quizmaster."));
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

function renderFibbageOpen(stage, question, fibbage, roomState) {
  const existingInput = stage.querySelector("#fibbageLieInput");
  const canReuseInput = (
    existingInput &&
    stage.dataset.fibbageQuestionId === question.id &&
    stage.dataset.fibbagePhase === roomState
  );

  if (!canReuseInput) {
    stage.replaceChildren();
    stage.dataset.fibbageQuestionId = question.id;
    stage.dataset.fibbagePhase = roomState;

    const label = document.createElement("label");
    label.textContent = "Din bløff";
    const textarea = document.createElement("textarea");
    textarea.id = "fibbageLieInput";
    textarea.rows = 4;
    textarea.placeholder = "Skriv et troverdig feil svar";
    textarea.value = fibbageLieDraft || fibbage.ownLie?.text || "";
    label.appendChild(textarea);
    stage.appendChild(label);
    updateOwnLieStatus(stage, fibbage);
    return;
  }

  if (document.activeElement !== existingInput && !fibbageLieDraft && fibbage.ownLie?.text) {
    existingInput.value = fibbage.ownLie.text;
  }

  updateOwnLieStatus(stage, fibbage);
}

function updateOwnLieStatus(stage, fibbage) {
  const existing = stage.querySelector("#fibbageLieStatus");

  if (!fibbage.ownLie) {
    existing?.remove();
    return;
  }

  const status = existing || el("p", "muted");
  status.id = "fibbageLieStatus";
  status.textContent = `Levert: ${fibbage.ownLie.text}`;

  if (!existing) {
    stage.appendChild(status);
  }
}

function updateSubmitState() {
  const question = latestState?.question;
  const roomState = latestState?.room?.state || "CLOSED";

  if (!question) {
    elements.submitGuess.classList.add("hidden");
    elements.submitGuess.disabled = true;
    return;
  }

  if (question.type === "map-location") {
    elements.submitGuess.classList.add("hidden");
    elements.submitGuess.disabled = true;
    return;
  }

  elements.submitGuess.classList.remove("hidden");

  if (question.type === "fibbage" && roomState === "OPEN") {
    elements.submitGuess.textContent = "Send bløff";
    const input = $("#fibbageLieInput");
    elements.submitGuess.disabled = !cleanPlayerName(elements.playerName.value) || !input?.value.trim();
    return;
  }

  if (question.type === "fibbage" && roomState === "VOTING") {
    const submittedChoiceId = latestState?.fibbage?.ownVote?.choiceId || "";
    const hasChangedVote = selectedChoiceId && selectedChoiceId !== submittedChoiceId;
    elements.submitGuess.textContent = submittedChoiceId && !hasChangedVote ? "Stemt" : submittedChoiceId ? "Endre stemme" : "Stem";
    elements.submitGuess.disabled = !cleanPlayerName(elements.playerName.value) || !selectedChoiceId || (submittedChoiceId && !hasChangedVote);
    return;
  }

  elements.submitGuess.classList.add("hidden");
  elements.submitGuess.textContent = "Send";
  elements.submitGuess.disabled = true;
}

function updateMessage(question, roomState) {
  if (!cleanPlayerName(elements.playerName.value)) {
    elements.playerMessage.textContent = "Navn mangler.";
    elements.playerMessage.classList.remove("error-text");
    return;
  }

  if (question.type === "map-location") {
    elements.playerMessage.textContent = "";
    elements.playerMessage.classList.remove("error-text");
    return;
  }

  if (roomState === "OPEN") {
    elements.playerMessage.textContent = fibbageLieError;
    elements.playerMessage.classList.toggle("error-text", Boolean(fibbageLieError));
  } else if (roomState === "VOTING") {
    elements.playerMessage.textContent = latestState?.fibbage?.ownVote ? "Stemme registrert." : "";
    elements.playerMessage.classList.remove("error-text");
  } else if (roomState === "REVEALED") {
    elements.playerMessage.textContent = "";
    elements.playerMessage.classList.remove("error-text");
  } else {
    elements.playerMessage.textContent = "";
    elements.playerMessage.classList.remove("error-text");
  }
}

async function submitCurrent() {
  const question = latestState?.question;
  const roomState = latestState?.room?.state || "CLOSED";
  const playerName = cleanPlayerName(elements.playerName.value);

  if (!question || !playerName) {
    elements.playerMessage.textContent = "Navn mangler.";
    return;
  }

  const body = {
    quizSlug: DEFAULT_QUIZ_SLUG,
    roomCode: DEFAULT_ROOM_CODE,
    playerName
  };

  if (question.type === "map-location") {
    if (!selectedLatLng) {
      return;
    }
    body.latitude = selectedLatLng.latitude;
    body.longitude = selectedLatLng.longitude;
  } else if (roomState === "OPEN") {
    const lieText = $("#fibbageLieInput")?.value.trim() || "";
    if (!lieText) {
      return;
    }
    body.lieText = lieText;
    fibbageLieDraft = lieText;
  } else if (roomState === "VOTING") {
    if (!selectedChoiceId) {
      return;
    }
    body.choiceId = selectedChoiceId;
  } else {
    return;
  }

  try {
    await api("/api/guess", {
      method: "POST",
      body: JSON.stringify(body)
    });
    fibbageLieError = "";
    elements.playerMessage.textContent = roomState === "VOTING" ? "Stemme registrert." : "";
    elements.playerMessage.classList.remove("error-text");
    await refreshState();
  } catch (error) {
    if (question.type === "fibbage" && roomState === "OPEN") {
      fibbageLieError = error.message;
    }
    elements.playerMessage.textContent = error.message;
    elements.playerMessage.classList.toggle("error-text", question.type === "fibbage" && roomState === "OPEN");
  }
}

function createLeafletMap(element) {
  const map = L.map(element, {
    dragging: true,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: true,
    touchZoom: false,
    zoomControl: false,
    zoomSnap: 0.1
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    detectRetina: true,
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

function unlockPlayerMapZoom(map) {
  map.setMinZoom(0);
  map.setMaxZoom(19);
}

function lockPlayerMapZoom(map, zoom) {
  if (!Number.isFinite(zoom)) {
    return;
  }

  if (zoom < map.getMinZoom()) {
    map.setMinZoom(zoom);
  }

  if (zoom > map.getMaxZoom()) {
    map.setMaxZoom(zoom);
  }

  map.setMinZoom(zoom);
  map.setMaxZoom(zoom);
  map.scrollWheelZoom.disable();
  map.doubleClickZoom.disable();
  map.boxZoom.disable();
  map.keyboard.disable();

  if (map.touchZoom) {
    map.touchZoom.disable();
  }
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

function renderLeaderboard(scores) {
  elements.leaderboardList.replaceChildren();

  for (const [index, score] of scores.entries()) {
    const item = el("li");
    item.style.setProperty("--player-color", score.playerColor || "#657282");
    item.append(
      el("span", "leaderboard-rank", `${index + 1}`),
      el("span", "leaderboard-name", score.playerName),
      el("span", "leaderboard-points", `${score.total} p`),
      el("span", "leaderboard-breakdown", scoreBreakdown(score))
    );
    elements.leaderboardList.appendChild(item);
  }
}

function scoreBreakdown(score) {
  return `${score.mapPoints || 0} kart / ${score.truthPoints || 0} fasit / ${score.foolPoints || 0} lurt`;
}

function cleanPlayerName(value) {
  return String(value).trim().replace(/\s+/g, " ").slice(0, 40);
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
    iconAnchor: [14.5, 14.5],
    iconSize: [29, 29]
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
