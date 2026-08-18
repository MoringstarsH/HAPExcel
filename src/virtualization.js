export function virtualWindow({ rowCount, scrollTop, viewportHeight, rowHeight, threshold = 300, buffer = 30 }) {
  if (rowCount <= threshold) return { start: 0, end: rowCount, top: 0, bottom: 0 };
  const safeHeight = Math.max(1, rowHeight || 38);
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / safeHeight) - buffer);
  const visibleCount = Math.ceil(Math.max(1, viewportHeight) / safeHeight) + buffer * 2;
  const end = Math.min(rowCount, start + visibleCount);
  return { start, end, top: start * safeHeight, bottom: (rowCount - end) * safeHeight };
}
