// Prefer unused supplied media, then rotate the library when it is exhausted.
export function selectConfiguredMedia(urls: string[], cursor = 0, recent = new Set<string>()) {
  const list = [...new Set(urls.map(url => url.trim()).filter(Boolean))];
  if (!list.length) return null;
  const start = Number.isFinite(cursor) ? ((Math.trunc(cursor) % list.length) + list.length) % list.length : 0;
  let index = start;
  for (let offset = 0; offset < list.length; offset += 1) {
    const candidate = (start + offset) % list.length;
    if (!recent.has(list[candidate])) { index = candidate; break; }
  }
  return { url: list[index], nextCursor: (index + 1) % list.length };
}
