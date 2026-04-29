/**
 * Tiny line-diff: LCS-backtraced diff returning an array of
 * { type: 'context' | 'add' | 'remove', text } in original-line order.
 *
 * O(m*n) memory & time. Fine for typical markdown sections; would be a
 * problem for files with tens of thousands of lines, but our section
 * granularity keeps things small.
 */
export function lineDiff(beforeText, afterText) {
  const before = String(beforeText ?? '').split(/\r\n|\n/);
  const after = String(afterText ?? '').split(/\r\n|\n/);
  const m = before.length;
  const n = after.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (before[i] === after[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (before[i] === after[j]) {
      result.push({ type: 'context', text: before[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'remove', text: before[i] });
      i += 1;
    } else {
      result.push({ type: 'add', text: after[j] });
      j += 1;
    }
  }
  while (i < m) {
    result.push({ type: 'remove', text: before[i] });
    i += 1;
  }
  while (j < n) {
    result.push({ type: 'add', text: after[j] });
    j += 1;
  }
  return result;
}

/**
 * Split a markdown blob into ordered sections by `## ` headings.
 * Returns [{ title, content }, ...]. Pre-section content gets the
 * synthetic title "__intro__" if non-empty.
 */
export function parseSections(content) {
  const lines = String(content ?? '').split(/\r\n|\n/);
  const sections = [];
  let currentTitle = '__intro__';
  let currentLines = [];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      sections.push({ title: currentTitle, content: currentLines.join('\n') });
      currentTitle = (m[1] || '').trim() || '__untitled__';
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  sections.push({ title: currentTitle, content: currentLines.join('\n') });
  if (sections.length > 0 && sections[0].title === '__intro__' && !sections[0].content.trim()) {
    sections.shift();
  }
  return sections;
}

/** Stable lookup helper: index sections by title. Last-write-wins on dup titles. */
export function indexSectionsByTitle(sections) {
  const map = new Map();
  for (const s of sections) map.set(s.title, s.content);
  return map;
}
