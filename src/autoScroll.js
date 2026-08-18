export function edgeVelocity(position, start, end, edge = 48, maxSpeed = 28) {
  if (position < start + edge) return -Math.ceil(maxSpeed * Math.min(1, (start + edge - position) / edge));
  if (position > end - edge) return Math.ceil(maxSpeed * Math.min(1, (position - (end - edge)) / edge));
  return 0;
}

export function scrollVelocity(clientX, clientY, bounds, options = {}) {
  return {
    x: edgeVelocity(clientX, bounds.left, bounds.right, options.edge, options.maxSpeed),
    y: edgeVelocity(clientY, bounds.top, bounds.bottom, options.edge, options.maxSpeed)
  };
}
