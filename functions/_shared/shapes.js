export function isGuessCorrect(point, shape, imageSize) {
  if (!isPoint(point) || !isShape(shape)) {
    return false;
  }

  if (shape.type === "circle") {
    const center = shape.center;
    const width = imageSize?.width || 1;
    const height = imageSize?.height || 1;
    const radiusPixels = shape.radius * Math.min(width, height);
    const dx = (point.x - center.x) * width;
    const dy = (point.y - center.y) * height;

    return Math.hypot(dx, dy) <= radiusPixels;
  }

  if (shape.type === "rect") {
    return (
      point.x >= shape.x &&
      point.x <= shape.x + shape.width &&
      point.y >= shape.y &&
      point.y <= shape.y + shape.height
    );
  }

  if (shape.type === "polygon") {
    return isPointInsidePolygon(point, shape.points);
  }

  return false;
}

export function isPointInsidePolygon(point, points) {
  if (!Array.isArray(points) || points.length < 3) {
    return false;
  }

  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;

    const crosses =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
}

export function isShape(shape) {
  if (!shape || typeof shape !== "object") {
    return false;
  }

  if (shape.type === "circle") {
    return (
      isPoint(shape.center) &&
      Number.isFinite(shape.radius) &&
      shape.radius > 0 &&
      shape.radius <= 2
    );
  }

  if (shape.type === "rect") {
    return (
      Number.isFinite(shape.x) &&
      Number.isFinite(shape.y) &&
      Number.isFinite(shape.width) &&
      Number.isFinite(shape.height) &&
      shape.width > 0 &&
      shape.height > 0
    );
  }

  if (shape.type === "polygon") {
    return Array.isArray(shape.points) && shape.points.length >= 3 && shape.points.every(isPoint);
  }

  return false;
}

export function isPoint(point) {
  return (
    point &&
    typeof point === "object" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}
