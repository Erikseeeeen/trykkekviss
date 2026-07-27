import { $, api, stateClass } from "./common.js";

const DEFAULT_QUIZ_SLUG = "kreta";
const DEFAULT_ROOM_CODE = "main";

const elements = {
  questionPrompt: $("#questionPrompt"),
  liveState: $("#liveState"),
  answerCount: $("#answerCount"),
  mapStage: $("#mapStage"),
  fibbageStage: $("#fibbageStage"),
  spectatorMessage: $("#spectatorMessage"),
  leaderboardList: $("#leaderboardList")
};

let latestState = null;
let spectatorMap = null;
let spectatorLayer = null;

refreshState();
window.setInterval(refreshState, 1500);

async function refreshState() {
  try {
    latestState = await api(`/api/state?quiz=${encodeURIComponent(DEFAULT_QUIZ_SLUG)}&room=${encodeURIComponent(DEFAULT_ROOM_CODE)}`);
    render();
  } catch (error) {
    elements.spectatorMessage.textContent = error.message;
  }
}

function render() {
  const question = latestState?.question;
  const roomState = latestState?.room?.state || "CLOSED";

  renderRoomState(roomState);
  elements.questionPrompt.textContent = question?.prompt || "Ingen aktivt spørsmål";
  elements.answerCount.textContent = answerCountText(question, roomState);
  elements.spectatorMessage.textContent = "";

  if (!question) {
    elements.mapStage.classList.add("hidden");
    elements.fibbageStage.classList.add("hidden");
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

  renderLeaderboard(latestState?.leaderboard || []);
}

function renderRoomState(roomState) {
  elements.liveState.textContent = stateLabel(roomState);
  elements.liveState.className = `badge ${stateClass(roomState)}`;
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
  spectatorMap = spectatorMap || createLeafletMap(elements.mapStage);
  spectatorLayer = spectatorLayer || L.layerGroup().addTo(spectatorMap);
  spectatorLayer.clearLayers();
  setMapQuestionView(spectatorMap, mapLocation);

  if (roomState === "REVEALED" && mapLocation.correctLatitude != null && mapLocation.correctLongitude != null) {
    L.circle([mapLocation.correctLatitude, mapLocation.correctLongitude], {
      radius: mapLocation.toleranceKm * 1000,
      color: "#23784f",
      fillColor: "#23784f",
      fillOpacity: 0.14,
      weight: 2
    }).addTo(spectatorLayer);
    L.circleMarker([mapLocation.correctLatitude, mapLocation.correctLongitude], {
      radius: 8,
      color: "#23784f",
      fillColor: "#23784f",
      fillOpacity: 1,
      weight: 2
    }).bindTooltip("Riktig sted").addTo(spectatorLayer);
  }

  for (const guess of guesses) {
    addPlayerGuessMarker(spectatorLayer, guess);
  }

  requestAnimationFrame(() => spectatorMap.invalidateSize());
}

function renderFibbage(question, fibbage, roomState) {
  const stage = elements.fibbageStage;
  stage.replaceChildren();

  const meta = el("div", "fibbage-meta");
  meta.append(
    el("span", "", `${fibbage.playerCount || 0} deltakere`),
    el("span", "", `${fibbage.lieCount || 0} bløffer`),
    el("span", "", `${fibbage.voteCount || 0} stemmer`)
  );
  if (roomState === "REVEALING") {
    meta.appendChild(el("span", "", `${fibbage.revealStep || 0}/${fibbage.revealTotal || 0} poppet`));
  }
  stage.appendChild(meta);

  if (roomState === "OPEN") {
    stage.appendChild(el("p", "muted", "Venter på bløffer."));
    return;
  }

  if (fibbage.choices?.length && (roomState === "VOTING" || roomState === "REVEALING" || roomState === "REVEALED")) {
    const choices = el("div", "fibbage-choice-grid");
    for (const choice of fibbage.choices) {
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
  }

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

function createLeafletMap(element) {
  const map = L.map(element, {
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false,
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

function stateLabel(state) {
  const normalized = String(state || "CLOSED").toUpperCase();

  if (normalized === "OPEN") {
    return "Åpen";
  }
  if (normalized === "VOTING") {
    return "Avstemning";
  }
  if (normalized === "REVEALING") {
    return "Avslører";
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
