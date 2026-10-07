// Paragraph and chapter semantics intentionally match QuietReader/src/core.cjs.
export function paragraphs(text) {
  const result = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) {
      if (result.length) result.at(-1).gap++;
      continue;
    }
    result.push({
      text: raw.replace(/^[\t \u3000]+/, "").replace(/\t/g, "    "),
      gap: 0,
    });
  }
  return result.map((p) => ({ ...p, gap: Math.max(1, p.gap) }));
}
export const count = (text) => Array.from(text.replace(/\s/gu, "")).length;
export function decode(bytes, encoding = "auto") {
  if (encoding === "auto") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      encoding = "utf-8";
    } catch {
      encoding = "gb18030";
    }
  }
  const text = new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw Error("请选择 TXT 文本文件");
  return { text, encoding };
}
export const fonts = {
  songti: {
    name: "宋体 · 书页",
    stack: '"Songti SC", "STSong", "PingFang SC", serif',
  },
  pingfang: {
    name: "苹方 · 清晰",
    stack: '"PingFang SC", "Hiragino Sans GB", sans-serif',
  },
  kaiti: {
    name: "楷体 · 雅致",
    stack: '"Kaiti SC", "STKaiti", "KaiTi", serif',
  },
  mono: { name: "等宽 · 简洁", stack: '"SFMono-Regular", Menlo, monospace' },
};
export const defaults = {
  mobileFont: "songti",
  fontSize: 22,
  lineHeight: 1.9,
  padding: 24,
  color: "#aaaaaa",
  background: "#212121",
};
export const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .filter((k) => v[k] !== undefined)
            .map((k) => [k, stable(v[k])]),
        )
      : v;
export async function hash(value) {
  const b = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export const digest = (v) => hash(JSON.stringify(stable(v)));
export function sumDays(entries) {
  const days = {};
  for (const [key, value] of Object.entries(entries))
    if (key.startsWith("time/"))
      for (const [day, books] of Object.entries(value.payload || {}))
        for (const [id, ms] of Object.entries(books)) {
          if (!Number.isFinite(ms) || ms < 0) continue;
          days[day] ??= {};
          days[day][id] = (days[day][id] || 0) + ms;
        }
  return days;
}
export function settings(value = {}) {
  const v = { ...defaults, ...value };
  for (const [key, min, max] of [
    ["fontSize", 14, 40],
    ["lineHeight", 1.2, 2.8],
    ["padding", 16, 64],
  ])
    v[key] = Math.max(min, Math.min(max, Number(v[key]) || defaults[key]));
  for (const key of ["color", "background"])
    if (!/^#[0-9a-f]{6}$/i.test(v[key])) v[key] = defaults[key];
  if (!Object.hasOwn(fonts, v.mobileFont)) v.mobileFont = defaults.mobileFont;
  return v;
}
