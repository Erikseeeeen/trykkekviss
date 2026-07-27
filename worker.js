import { onRequest as apiRequest } from "./functions/api/[[path]].js";

const BASE_PATH = "/kviss";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === BASE_PATH) {
      return Response.redirect(`${url.origin}${BASE_PATH}/`, 308);
    }

    if (!url.pathname.startsWith(`${BASE_PATH}/`)) {
      return fetch(request);
    }

    const strippedPath = url.pathname.slice(BASE_PATH.length) || "/";

    if (strippedPath === "/api" || strippedPath.startsWith("/api/")) {
      return handleApiRequest(request, env, strippedPath);
    }

    if (strippedPath === "/admin/") {
      return Response.redirect(`${url.origin}${BASE_PATH}/admin`, 308);
    }

    if (strippedPath === "/spectate/") {
      return Response.redirect(`${url.origin}${BASE_PATH}/spectate`, 308);
    }

    return env.ASSETS.fetch(rewriteAssetRequest(request, strippedPath));
  }
};

function handleApiRequest(request, env, strippedPath) {
  const url = new URL(request.url);
  url.pathname = strippedPath;
  const path = strippedPath.replace(/^\/api\/?/, "");

  return apiRequest({
    request: new Request(url, request),
    env,
    params: { path }
  });
}

function rewriteAssetRequest(request, strippedPath) {
  const url = new URL(request.url);
  let assetPath = strippedPath;

  if (assetPath === "/" || assetPath === "") {
    assetPath = "/index.html";
  } else if (assetPath === "/admin" || assetPath === "/admin/") {
    assetPath = "/admin.html";
  } else if (assetPath === "/spectate" || assetPath === "/spectate/") {
    assetPath = "/spectate.html";
  }

  url.pathname = assetPath;
  return new Request(url, request);
}
