export function $(selector) {
  return document.querySelector(selector);
}

export async function api(path, options = {}) {
  const response = await fetch(resolveApiPath(path), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Forespørselen feilet med status ${response.status}`);
  }

  return payload;
}

function resolveApiPath(path) {
  if (!path.startsWith("/api/") && path !== "/api") {
    return path;
  }

  return `${basePath()}${path}`;
}

function basePath() {
  const firstSegment = window.location.pathname.split("/").filter(Boolean)[0];
  return firstSegment === "kviss" ? "/kviss" : "";
}

export function stateClass(state) {
  const normalized = String(state || "CLOSED").toLowerCase();
  return normalized === "open" || normalized === "voting" || normalized === "revealing" || normalized === "revealed"
    ? normalized
    : "";
}
