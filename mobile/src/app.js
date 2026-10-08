let savedScreenAnchor=null,pageLeaving=false,lastAutoSync=0;
import {
  paragraphs,
  count,
  decode,
  defaults,
  fonts,
  settings,
  hash,
  sumDays,
  digest,
} from "./model.js";
import { get, put, remove, load, save, assetKey } from "./storage.js";
import { rpc, client, synchronize, download, resolve } from "./sync.js";
import cleaning from "../../QuietReader/src/cleaning.cjs";
import searchEngine from "../../QuietReader/src/search-engine.js";
const $ = (id) => document.getElementById(id),
  app = $("app"),
  panel = $("panel");
// One writer per origin prevents Safari tabs and the installed PWA from
// replacing each other's in-memory snapshots or mixing account transitions.
if (navigator.locks) {
  const acquired = await new Promise((resolve) =>
    navigator.locks.request(
      "quiet-reader-writer",
      { ifAvailable: true },
      (lock) => {
        resolve(!!lock);
        return lock ? new Promise(() => {}) : undefined;
      },
    ),
  );
  if (!acquired) {
    app.innerHTML =
      '<main class="page"><h1>静读已在另一窗口打开</h1><p>请关闭另一个 Safari 标签或主屏幕窗口，然后重新打开，以保护未同步进度。</p><button onclick="location.reload()">重新打开</button></main>';
    await new Promise(() => {});
  }
}
let session = await get("meta", "session"),
  account = session?.id || "guest",
  state = await load(account),
  book = null,
  content = [],
  prefix = [],
  menu = false,
  lastActivity = Date.now(),
  lastTick = performance.now(),
  active = document.visibilityState === "visible",
  busy = false,
  queue = Promise.resolve(),
  searchHit = null,
  screen = "library";
const escape = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const payload = (key, fallback = {}) => state.entries[key]?.payload ?? fallback;
const keyFor = (id, part) => `book/${id}/${part}`;
const mobileThemeKey = "theme/" + (await hash("iPhone 默认排版"));
const mobileSettings = (fallback) =>
  payload(mobileThemeKey, { settings: fallback }).settings;
function set(key, value) {
  state.entries[key] = { ...state.entries[key], payload: value };
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").classList.remove("show"), 5500);
}
function task(fn) {
  const next = queue.then(fn);
  queue = next.catch((e) =>
    toast(
      e.name === "QuotaExceededError"
        ? "空间不足：修改尚未保存，请导出书籍并清理已备份缓存"
        : e.message,
    ),
  );
  return next;
}
const persist = () => save(account, state);
function button(text, action, cls = "") {
  const b = document.createElement("button");
  b.textContent = text;
  b.className = cls;
  b.onclick = () => task(action);
  return b;
}
function applyTheme() {
  const style = payload("prefs/uiStyle", "dark");
  document.body.dataset.ui = style === "light" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]').content =
    style === "light" ? "#fbf8f1" : "#212121";
}
function dialog(title, html, init) {
  pauseTime();
  $("panel-title").textContent = title;
  $("panel-body").innerHTML = html;
  panel.showModal();
  init?.();
}
function closePanel() {
  panel.close();
  clearHighlight();
  lastTick = performance.now();
  lastActivity = Date.now();
}
$("panel-close").onclick = closePanel;
panel.addEventListener("cancel", () => {
  clearHighlight();
  lastTick = performance.now();
});
function clearHighlight() {
  searchHit = null;
  document
    .querySelectorAll("mark")
    .forEach((mark) =>
      mark.replaceWith(document.createTextNode(mark.textContent)),
    );
  document.querySelectorAll("#text p").forEach((p) => p.normalize());
}
function top(title, subtitle) {
  app.innerHTML = `<header class="page-header"><div class="brand"><span class="seal">静</span><span>QUIET READER</span></div><button id="style" aria-label="切换深浅风格">${document.body.dataset.ui === "dark" ? "浅色" : "深色"} ◐</button></header><main class="page"><div class="eyebrow">YOUR PERSONAL READING ROOM</div><h1>${title}</h1><p class="subtitle">${subtitle}</p><div id="page-content"></div></main><nav class="tabs" aria-label="主导航"><button id="library-tab">书架</button><button id="stats-tab">阅读足迹</button><button id="account-tab">${escape(session?.username || "账号与同步")}</button></nav>`;
  $("style").onclick = () =>
    task(async () => {
      set(
        "prefs/uiStyle",
        document.body.dataset.ui === "dark" ? "light" : "dark",
      );
      await persist();
      applyTheme();
      await (screen === "stats" ? showStats() : library());
    });
  $("library-tab").onclick = () => task(library);
  $("stats-tab").onclick = () => task(showStats);
  $("account-tab").onclick = () => task(accountPanel);
}
async function library(syncOnEntry=true) {
  pauseTime();
  book = null;
  screen = "library";
  applyTheme();
  top("我的书架", "把日常留在书外。");
  const host = $("page-content");
  host.innerHTML =
    '<div class="shelf-actions"><button class="primary" id="import">＋ 导入 TXT</button><button id="cache">离线缓存</button><button id="sync">同步</button></div><p class="hint" id="sync-state"></p><div class="shelf" id="shelf"></div>';
  $("import").onclick = () => task(importPanel);
  $("cache").onclick = () => task(cachePanel);
  $("sync").onclick = () => task(syncNow);
  $("sync-state").textContent = session ? "" : "本机书架 · 登录后使用独立的账号书库";
  const rows = Object.entries(state.entries).filter(([key]) =>
    /^book\/[a-f0-9]{64}\/base$/.test(key),
  );
  if (!rows.length) {
    $("shelf").innerHTML =
      '<div class="empty"><div class="book-outline">静</div><h2>一本书，一段自己的时间</h2><p>从「文件」导入 TXT，或登录统一账号<br>取回你的云端书架。</p></div>';
  }
  for (const [key, entry] of rows) {
    const b = entry.payload,
      id = key.split("/")[1],
      reading = payload(keyFor(id, "reading")),
      counts = reading.counts || {},
      pct = counts.total
        ? Math.min(100, (100 * (counts.read || 0)) / counts.total)
        : 0;
    const manifest = payload(`asset/books/${id}.txt`, null),
      cached = await get("assets", assetKey(account, `asset/books/${id}.txt`));
    const offline =
      !!cached && !!manifest && (await hash(cached)) === manifest.hash;
    const card = document.createElement("article");
    card.className = "book-card";
    card.innerHTML = `<button class="cover" aria-label="打开 ${escape(b.title)}" style="--cover-hue:${(parseInt(id.slice(0, 4), 16) % 70) + 100}"><span class="cover-imprint">QUIET LIBRARY</span><strong>${escape(b.title)}</strong><span class="cover-footer">静 读<span>${String(rows.indexOf(rows.find((r) => r[0] === key)) + 1).padStart(2, "0")}</span></span></button><h2>${escape(b.title)}</h2><div class="book-status">${offline ? "● 已下载 · 离线可读" : "○ 云端 · 点击下载"}</div><progress max="100" value="${pct}" aria-label="阅读进度"></progress><div class="book-numbers"><b>${pct.toFixed(1)}%</b><span>${(counts.read || 0).toLocaleString()} / ${(counts.total || 0).toLocaleString()} 字</span></div>`;
    card.querySelector("button").onclick = () => task(() => openBook(id));
    $("shelf").append(card);
  }
  if(syncOnEntry&&session&&navigator.onLine&&!busy)await syncNow();
}
async function bytesFor(key) {
  const entry = state.entries[key];
  if (!entry) throw Error("正文尚未同步，请先同步书架");
  let bytes = await get("assets", assetKey(account, key));
  if (bytes && (await hash(bytes)) === entry.payload.hash) return bytes;
  if (!session || !navigator.onLine)
    throw Error("此书尚未下载或缓存已被系统清理，请联网下载");
  toast("正在下载并校验正文…");
  return download(account, key, entry.payload, client(session));
}
async function openBook(id) {
  if(session&&!book&&navigator.onLine&&Date.now()-lastAutoSync>5000){try{await syncNow();}catch{}}
  const base = payload(keyFor(id, "base"));
  const bytes = await bytesFor(`asset/books/${id}.txt`);
  content = paragraphs(decode(bytes, base.encoding).text);
  if (!content.length) throw Error("这本书没有可阅读的正文");
  book = { id, ...base };
  screen = "reading";
  prefix = [0];
  for (const p of content) prefix.push(prefix.at(-1) + count(p.text));
  menu = false;
  app.innerHTML =
    '<section id="reader"><article id="text" aria-label="书籍正文" tabindex="0"></article></section><div id="reader-top" class="reader-controls" hidden><button id="back">‹ 书库</button><span id="book-title"></span><button id="find">查找</button></div><div id="reader-bottom" class="reader-controls" hidden><div class="progress-label"><span id="read-label"></span><button id="chapters">目录</button></div><input id="position" aria-label="阅读进度" type="range" min="0" max="10000"><div class="reader-actions"><button id="review">书评</button><button id="appearance">排版</button><button id="export">导出 / 分享</button></div></div>';
  $("book-title").textContent = base.title;
  const fragment = document.createDocumentFragment();
  content.forEach((p, i) => {
    const el = document.createElement("p");
    el.dataset.paragraph = i;
    el.textContent = p.text;
    fragment.append(el);
  });
  $("text").append(fragment);
  readerStyle();
  $("back").onclick = () =>
    task(async () => {
      await saveProgress();
      await library();
    });
  $("find").onclick = searchPanel;
  $("review").onclick = reviewPanel;
  $("appearance").onclick = appearancePanel;
  $("export").onclick = () => task(exportPanel);
  $("chapters").onclick = chaptersPanel;
  $("position").oninput = (e) => {
    jumpCount((Number(e.target.value) / 10000) * prefix.at(-1));
    activity();
  };
  $("position").onchange = () => task(saveProgress);
  const reader = $("reader");
  let pointer;
  reader.addEventListener(
    "pointerdown",
    (e) => {
      pointer = {
        x: e.clientX,
        y: e.clientY,
        at: performance.now(),
        scroll: reader.scrollTop,
        selected: !!getSelection()?.toString(),
      };
      activity();
    },
    { passive: true },
  );
  reader.addEventListener(
    "pointerup",
    (e) => {
      if (!pointer) return;
      const rect = reader.getBoundingClientRect();
      if (
        !pointer.selected &&
        performance.now() - pointer.at < 280 &&
        Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) < 8 &&
        Math.abs(reader.scrollTop - pointer.scroll) < 3 &&
        e.clientX > rect.width * 0.12 &&
        e.clientX < rect.width * 0.88 &&
        e.clientY > rect.height * 0.18 &&
        e.clientY < rect.height * 0.82 &&
        !getSelection()?.toString()
      ) {
        menu = !menu;
        for (const el of document.querySelectorAll(".reader-controls"))
          el.hidden = !menu;
      }
      pointer = null;
    },
    { passive: true },
  );
  reader.addEventListener(
    "scroll",
    () => {
      activity();
      updateProgressLabel();
      clearTimeout(reader.timer);
      reader.timer = setTimeout(() => task(saveProgress), 400);
    },
    { passive: true },
  );
  const restoredAnchor = payload(keyFor(id, "reading")).progress?.anchor;
  requestAnimationFrame(() => {
    jumpAnchor(restoredAnchor || { paragraph: 0, offset: 0 });
    savedScreenAnchor=JSON.stringify(anchor());
    updateProgressLabel();
  });
  lastTick = performance.now();
  activity();
}
function readerStyle() {
  const s = settings(
    payload(keyFor(book.id, "reading")).settings ||
      mobileSettings(
        document.body.dataset.ui === "light"
          ? { ...defaults, color: "#243c35", background: "#fbf8f1" }
          : defaults,
      ),
  );
  const el = $("reader");
  el.style.setProperty("--reading-font", fonts[s.mobileFont].stack);
  el.style.setProperty("--reading-bg", s.background);
  el.style.setProperty("--reading-color", s.color);
  el.style.setProperty("--reading-size", s.fontSize + "px");
  el.style.setProperty("--reading-leading", s.lineHeight);
  el.style.setProperty("--reading-padding", s.padding + "px");
}
function anchor() {
  const reader = $("reader");
  if (!reader) return { paragraph: 0, offset: 0 };
  const top = reader.getBoundingClientRect().top + 20;
  const nodes = $("text").children;
  let lo = 0,
    hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].getBoundingClientRect().bottom < top) lo = mid + 1;
    else hi = mid;
  }
  const rect = nodes[lo].getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (top - rect.top) / rect.height));
  return { paragraph: lo, offset: Math.floor(content[lo].text.length * ratio) };
}
function readCount() {
  const a = anchor(),
    r = $("reader");
  if (r.scrollTop > 0 && r.scrollTop + r.clientHeight >= r.scrollHeight - 3)
    return prefix.at(-1);
  return (
    (prefix[a.paragraph] || 0) +
    count(content[a.paragraph].text.slice(0, a.offset))
  );
}
function updateProgressLabel() {
  if (!book) return;
  const read = readCount(),
    total = prefix.at(-1);
  $("position").value = total ? (read / total) * 10000 : 0;
  $("read-label").textContent =
    `${(total ? (read / total) * 100 : 0).toFixed(1)}% · ${read.toLocaleString()} / ${total.toLocaleString()} 字`;
}
async function saveProgress() {
  if (!book) return;
  const currentAnchor=anchor();
  if(JSON.stringify(currentAnchor)===savedScreenAnchor)return;
  savedScreenAnchor=JSON.stringify(currentAnchor);
  const key = keyFor(book.id, "reading"),
    old = payload(key);
  set(key, {
    ...old,
    progress: {
      ...old.progress,
      anchor: currentAnchor,
      updatedAt:Date.now(),deviceId:state.device,
      epoch: (old.progress?.epoch || 0) + 1,
      snapshots: {},
    },
    counts: { ...old.counts, read: readCount(), total: prefix.at(-1) },
  });
  await persist();
}
function jumpAnchor(a) {
  const p =
    $("text").children[
      Math.max(0, Math.min(content.length - 1, a.paragraph || 0))
    ];
  $("reader").scrollTop =
    p.offsetTop -
    parseFloat(getComputedStyle($("text")).paddingTop) +
    ((a.offset || 0) / Math.max(1, p.textContent.length)) * p.offsetHeight;
}
function jumpCount(target) {
  let i = prefix.findIndex((v) => v > target) - 1;
  if (i < 0) i = content.length - 1;
  jumpAnchor({
    paragraph: i,
    offset: Math.floor(
      ((target - prefix[i]) / Math.max(1, prefix[i + 1] - prefix[i])) *
        content[i].text.length,
    ),
  });
}
function searchPanel() {
  dialog(
    "全文查找",
    '<label>搜索正文<input id="query" type="search" placeholder="输入想找的文字"></label><label>匹配方式<select id="search-mode"><option value="exact">精确</option><option value="fuzzy">模糊</option></select></label><button id="search-go" class="primary">查找</button><p class="hint">最多显示 200 条结果；关闭查找会清除高亮。</p><div id="results"></div>',
    () => {
      $("search-go").onclick = () => {
        const results = searchEngine.search(
          content,
          $("query").value,
          $("search-mode").value,
        );
        $("results").replaceChildren();
        if (!results.length) $("results").textContent = "没有找到匹配内容";
        for (const hit of results)
          $("results").append(
            button(
              hit.excerpt,
              () => {
                clearHighlight();
                searchHit = hit;
                const p = $("text").children[hit.paragraph],
                  text = content[hit.paragraph].text;
                p.replaceChildren(
                  document.createTextNode(text.slice(0, hit.start)),
                );
                const mark = document.createElement("mark");
                mark.textContent = text.slice(hit.start, hit.end);
                p.append(mark, document.createTextNode(text.slice(hit.end)));
                panel.close();
                jumpAnchor({ paragraph: hit.paragraph, offset: hit.start });
                menu = true;
                document
                  .querySelectorAll(".reader-controls")
                  .forEach((el) => (el.hidden = false));
                $("find").textContent = "结束查找";
                $("find").onclick = () => {
                  clearHighlight();
                  $("find").textContent = "查找";
                  $("find").onclick = searchPanel;
                };
                activity();
              },
              "result",
            ),
          );
      };
    },
  );
}
function chaptersPanel() {
  const rows = content
    .map((p, i) => ({ text: p.text, i }))
    .filter(
      (p) =>
        p.text.length <= 100 &&
        /^(第[零〇一二三四五六七八九十百千万两\d]+[章回节卷部篇]|序章|序言|楔子|引子|前言|尾声|后记|终章|番外|chapter\s+\d+)/i.test(
          p.text,
        ),
    );
  dialog("目录", '<div id="chapters-list"></div>', () => {
    for (const row of rows.length ? rows : [{ text: "正文", i: 0 }])
      $("chapters-list").append(
        button(
          row.text,
          () => {
            closePanel();
            jumpAnchor({ paragraph: row.i, offset: 0 });
          },
          "result",
        ),
      );
  });
}
function reviewPanel() {
  const r = payload(keyFor(book.id, "review"), {
    rating: 0,
    tags: [],
    text: "",
  });
  dialog(
    "留下书评",
    `<label>评分<select id="rating">${Array.from({ length: 6 }, (_, i) => `<option value="${i}" ${r.rating === i ? "selected" : ""}>${i ? "★".repeat(i) : "未评分"}</option>`).join("")}</select></label><label>标签（逗号分隔）<input id="tags" value="${escape(r.tags?.join("，"))}" maxlength="620"></label><label>文字评价<textarea id="review-text" maxlength="10000">${escape(r.text)}</textarea></label><button id="review-save" class="primary">保存书评</button>`,
    () => {
      $("review-save").onclick = () =>
        task(async () => {
          const tags = $("tags")
            .value.split(/[,，]/)
            .map((v) => v.trim())
            .filter(Boolean);
          if (tags.length > 20 || tags.some((t) => t.length > 30))
            throw Error("最多 20 个标签，每个 30 字");
          set(keyFor(book.id, "review"), {
            ...r,
            rating: Number($("rating").value),
            tags: [...new Set(tags)],
            text: $("review-text").value,
            updated: Date.now(),
          });
          await persist();
          closePanel();
          toast("书评已保存");
        });
    },
  );
}
function appearancePanel() {
  const s = settings(
    payload(keyFor(book.id, "reading")).settings || mobileSettings(defaults),
  );
  dialog(
    "阅读排版",
    `<label>字体<select id="font">${Object.entries(fonts)
      .map(
        ([id, font]) =>
          `<option value="${id}" ${s.mobileFont === id ? "selected" : ""}>${font.name}</option>`,
      )
      .join(
        "",
      )}</select></label><p id="font-preview" class="font-preview">风过书页，字里有光。Quiet Reader 012345</p><p class="hint">使用设备自带字体，离线可用；未安装的字体会自动使用后备字体。</p><div class="two"><label>背景<input id="bg" type="color" value="${s.background}"></label><label>文字<input id="fg" type="color" value="${s.color}"></label></div><label>字号<input id="size" type="range" min="14" max="40" value="${s.fontSize}"></label><label>行距<input id="leading" type="range" min="1.2" max="2.8" step="0.1" value="${s.lineHeight}"></label><label>左右留白<input id="padding" type="range" min="16" max="64" value="${s.padding}"></label><label>主题名称<input id="theme-name" maxlength="40" placeholder="我的纸张"></label><button id="appearance-save" class="primary">保存排版与主题</button><div id="themes"></div>`,
    () => {
      const previewFont = () => {
        $("font-preview").style.fontFamily = fonts[$("font").value].stack;
      };
      $("font").onchange = previewFont;
      previewFont();
      $("appearance-save").onclick = () =>
        task(async () => {
          const a = anchor(),
            s = settings({
              ...payload(keyFor(book.id, "reading")).settings,
              mobileFont: $("font").value,
              background: $("bg").value,
              color: $("fg").value,
              fontSize: Number($("size").value),
              lineHeight: Number($("leading").value),
              padding: Number($("padding").value),
            }),
            name = $("theme-name").value.trim() || "iPhone 自定义";
          const key = keyFor(book.id, "reading");
          set(key, {
            ...payload(key),
            settings: { ...payload(key).settings, ...s },
          });
          set(mobileThemeKey, {
            ...payload(mobileThemeKey),
            name: "iPhone 默认排版",
            settings: s,
          });
          set("theme/" + (await hash(name)), {
            ...payload("theme/" + (await hash(name))),
            name,
            settings: s,
          });
          await persist();
          readerStyle();
          jumpAnchor(a);
          closePanel();
        });
      for (const [key, entry] of Object.entries(state.entries))
        if (key.startsWith("theme/"))
          $("themes").append(
            button(
              entry.payload.name,
              async () => {
                const a = anchor(),
                  k = keyFor(book.id, "reading");
                set(k, {
                  ...payload(k),
                  settings: {
                    ...payload(k).settings,
                    ...settings(entry.payload.settings),
                  },
                });
                await persist();
                readerStyle();
                jumpAnchor(a);
                closePanel();
              },
              "result",
            ),
          );
    },
  );
}
function importPanel() {
  const old = payload("prefs/cleaning", {});
  let file, original, decoded, preview;
  dialog(
    "导入 TXT",
    `<label class="file-picker">从 iPhone「文件」选择<input id="file" type="file" accept=".txt,text/plain"></label><label>文本编码<select id="encoding"><option value="auto">自动识别 UTF-8 / GB18030</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option></select></label><label class="check"><input id="clean-enable" type="checkbox">本次手动启用广告清洗</label><div class="hint">默认保留全部正文。启用后会额外保存清洗前原文，可随时导出。</div><label>删除方式<select id="clean-mode"><option value="exact">精确匹配整行删除</option><option value="fuzzy">模糊匹配整行删除</option></select></label>${cleaning.presets.map((p) => `<label class="check"><input type="checkbox" name="preset" value="${p.id}" ${(old.presets || []).includes(p.id) ? "checked" : ""}>${p.name}</label>`).join("")}<label>自定义规则（每行一条）<textarea id="rules">${escape(old.rules || "")}</textarea></label><button id="preview">预览处理结果</button><div id="preview-result" class="preview"></div><button id="import-save" class="primary" disabled>保存到书架</button>`,
    () => {
      const options = () => ({
        enabled: $("clean-enable").checked,
        mode: $("clean-mode").value,
        presets: [...document.querySelectorAll("[name=preset]:checked")].map(
          (e) => e.value,
        ),
        rules: $("rules").value,
      });
      $("file").onchange = () => {
        file = $("file").files[0];
        preview = null;
        $("import-save").disabled = true;
      };
      for (const id of ["encoding", "clean-enable", "clean-mode", "rules"])
        $(id).oninput = () => {
          $("import-save").disabled = true;
          preview = null;
        };
      document.querySelectorAll("[name=preset]").forEach(
        (e) =>
          (e.onchange = () => {
            $("import-save").disabled = true;
            preview = null;
          }),
      );
      $("preview").onclick = () =>
        task(async () => {
          if (!file) throw Error("请先选择 TXT");
          if (file.size > 64 * 1024 * 1024) throw Error("单本上限为 64 MB");
          original = await file.arrayBuffer();
          decoded = decode(original, $("encoding").value);
          preview = cleaning.clean(decoded.text, options());
          $("preview-result").textContent =
            `${file.name}\n${decoded.encoding} · ${count(preview.text).toLocaleString()} 字\n将删除 ${preview.removed} 行${preview.removed > 100 ? "（预览前 100 行）" : ""}\n` +
            preview.matches
              .map((m) => `第 ${m.line} 行：${m.text}`)
              .join("\n") +
            (preview.removed ? "" : "\n" + preview.text.slice(0, 400));
          $("import-save").disabled = false;
        });
      $("import-save").onclick = () =>
        task(async () => {
          if (!preview) throw Error("请先预览");
          const id = await hash(original);
          if (state.entries[keyFor(id, "base")])
            throw Error("此原文件已在书架，已保留现有进度");
          const opt = options(),
            bytes = opt.enabled
              ? new TextEncoder().encode(preview.text).buffer
              : original;
          const addAsset = async (key, data) => {
            await put("assets", assetKey(account, key), data);
            set(key, {
              hash: await hash(data),
              size: data.byteLength,
              parts: Math.ceil(data.byteLength / 393216),
            });
          };
          await addAsset(`asset/books/${id}.txt`, bytes);
          await addAsset(`asset/books/${id}.original.txt`, original);
          set(keyFor(id, "base"), {
            id,
            title: file.name.replace(/\.txt$/i, ""),
            encoding: opt.enabled ? "utf-8" : decoded.encoding,
            size: bytes.byteLength,
            cleaning: {
              ...opt,
              removed: preview.removed,
              originalEncoding: decoded.encoding,
            },
          });
          const s = mobileSettings(
            document.body.dataset.ui === "light"
              ? { ...defaults, background: "#fbf8f1", color: "#243c35" }
              : defaults,
          );
          set(keyFor(id, "reading"), {
            settings: s,
            progress: null,
            counts: {
              total: paragraphs(preview.text).reduce(
                (n, p) => n + count(p.text),
                0,
              ),
              read: 0,
            },
          });
          set("prefs/cleaning", { ...old, ...opt, enabled: false });
          await persist();
          navigator.storage?.persist?.().catch(() => {});
          closePanel();
          await library();
          toast("已保存正文及原文备份");
            });
    },
  );
}
function shareFile(bytes, name) {
  const file = new File([bytes], name, { type: "text/plain" });
  if (navigator.canShare?.({ files: [file] }))
    return navigator.share({ files: [file], title: name }).catch((e) => {
      if (e.name !== "AbortError") toast(e.message);
    });
  const url = URL.createObjectURL(file),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function exportPanel() {
  try {
    const current = await bytesFor(`asset/books/${book.id}.txt`);
    let original;
    try {
      original = await bytesFor(`asset/books/${book.id}.original.txt`);
    } catch {}
    dialog(
      "导出与分享",
      '<p class="hint">可保存到「文件」，或通过系统分享发送。原文保持导入时的字节与编码。</p><button id="share-current" class="primary">分享 / 导出当前 TXT</button><button id="share-original">分享 / 导出清洗前原文</button>',
      () => {
        $("share-current").onclick = () =>
          shareFile(current, book.title + ".txt");
        $("share-original").disabled = !original;
        $("share-original").onclick = () =>
          shareFile(original, book.title + ".original.txt");
      },
    );
  } catch (e) {
    toast(e.message);
  }
}
async function cachePanel() {
  const estimate = (await navigator.storage?.estimate?.()) || {};
  dialog(
    "离线缓存",
    `<p class="hint">已用约 ${((estimate.usage || 0) / 1048576).toFixed(1)} MB。iOS 可能清理网站数据，云端备份与原文导出可用于恢复。仅已同步且无冲突的正文允许移除。</p><div id="cache-list"></div><button id="persist">请求保留本机存储</button>`,
    () => {
      $("persist").onclick = async () =>
        toast(
          (await navigator.storage?.persist?.())
            ? "已获得持久存储许可"
            : "浏览器未授予持久存储，请保持云端备份",
        );
    },
  );
  for (const [key, entry] of Object.entries(state.entries)) {
    if (!/^asset\/books\/[a-f0-9]{64}\.(txt|original.txt)$/.test(key)) continue;
    const cached = await get("assets", assetKey(account, key)),
      id = key.split("/")[2].slice(0, 64),
      title = payload(keyFor(id, "base")).title || id;
    const row = document.createElement("div");
    row.className = "cache-row";
    const label = document.createElement("span");
    label.textContent =
      title + (key.endsWith(".original.txt") ? " · 原文" : " · 正文");
    row.append(
      label,
      button(cached ? "移除下载" : "下载", async () => {
        if (cached) {
          if (
            !session ||
            !entry.baseHash ||
            (await digest(entry.payload)) !== entry.baseHash ||
            state.conflicts[key]
          )
            throw Error("此文件尚未安全备份，请先同步并处理冲突");
          await remove("assets", assetKey(account, key));
        } else await bytesFor(key);
        closePanel();
        await library();
        await cachePanel();
      }),
    );
    $("cache-list").append(row);
  }
}
async function accountPanel() {
  if (session) {
    dialog(
      "账号与同步",
      `<p>当前账号：<strong>${escape(session.username)}</strong></p><p class="hint">与 quiz-app、桌面静读共用账号。离线修改保存在此账号书库；退出后不显示其内容。</p><button id="sync-account" class="primary">立即同步</button><button id="conflicts">查看同步冲突（${Object.keys(state.conflicts).length}）</button><button id="history">导出冲突记录</button><button id="logout">退出登录</button>`,
      () => {
        $("sync-account").onclick = () =>
          task(async () => {
            closePanel();
            await syncNow();
          });
        $("conflicts").onclick = () =>
          task(() => {
            closePanel();
            conflictsPanel();
          });
        $("history").onclick = () =>
          shareFile(
            JSON.stringify(state.history, null, 2),
            "quiet-reader-conflicts.json",
          );
        $("logout").onclick = () =>
          task(async () => {
            const old = session;
            await remove("meta", "session");
            session = null;
            account = "guest";
            state = await load(account);
            closePanel();
            await library();
            rpc("reader_logout", { p_token: old.token }).catch(() =>
              toast("已退出本机，离线会话将在云端到期"),
            );
          });
      },
    );
    return;
  }
  dialog(
    "登录统一账号",
    '<form id="login-form"><p class="hint">使用现有 quiz-app 用户名与密码。登录后进入独立账号书库，本机未登录书籍不会自动混入。</p><label>用户名<input id="username" autocomplete="username" maxlength="32" required></label><label>密码<input id="password" type="password" autocomplete="current-password" maxlength="200" required></label><button class="primary" type="submit">登录</button><p id="login-error" role="alert"></p></form>',
    () => {
      $("login-form").onsubmit = (e) => {
        e.preventDefault();
        const username = $("username").value,
          password = $("password").value;
        task(async () => {
          const btn = $("login-form").querySelector("button");
          btn.disabled = true;
          try {
            const next = await rpc("reader_login", {
              p_username: username,
              p_password: password,
            });
            if (
              !next ||
              !/^[a-f0-9-]{36}$/.test(next.id) ||
              !/^[a-f0-9]{64}$/.test(next.token)
            )
              throw Error("无效会话响应");
            const nextState = await load(next.id);
            await put("meta", "session", next);
            session = next;
            account = next.id;
            state = nextState;
            closePanel();
            await library();
          } catch (err) {
            if ($("login-error")) $("login-error").textContent = err.message;
            else toast(err.message);
          } finally {
            btn.disabled = false;
          }
        });
      };
    },
  );
}
async function syncNow() {
  if (!session) {
    await accountPanel();
    return;
  }
  if (busy) return;
  if (book) {
    await saveProgress();
  }
  busy = true;lastAutoSync=Date.now();

  try {
    const conflicts = await synchronize(
      account,
      state,
      client(session),
      persist,
      book ? keyFor(book.id, "reading") : null,
    );
    if (!book&&screen==="library") await library(false);

  } catch(error) {
    state.syncError=error.message;
  } finally {
    busy = false;
  }
}
function conflictsPanel() {
  dialog(
    "同步冲突",
    '<p class="hint">两端都修改过这些内容。请比较后选择；选择前会保存双方版本的冲突记录，旧进度不会静默覆盖新进度。</p><div id="conflict-list"></div>',
    () => {
      for (const [key, c] of Object.entries(state.conflicts)) {
        const row = document.createElement("section"),
          heading = document.createElement("h3");
        heading.textContent = key;
        row.append(heading);
        const details = document.createElement("pre");
        details.textContent =
          "本机\n" +
          JSON.stringify(payload(key), null, 2) +
          "\n云端\n" +
          JSON.stringify(c.remote?.payload, null, 2);
        row.append(details);
        for (const [choice, title] of [
          ["local", "保留本机"],
          ["remote", "使用云端"],
        ])
          row.append(
            button(title, async () => {
              await resolve(
                account,
                state,
                key,
                choice,
                client(session),
                persist,
              );
              closePanel();
              await library();
              conflictsPanel();
            }),
          );
        $("conflict-list").append(row);
      }
      if (!Object.keys(state.conflicts).length)
        $("conflict-list").textContent = "没有待处理的冲突";
    },
  );
}
function activity() {
  lastActivity = Date.now();
}
function tick() {
  const now = performance.now(),
    elapsed = Math.max(0, Math.min(5000, now - lastTick));
  lastTick = now;
  if (
    !book ||
    !active ||
    document.visibilityState !== "visible" ||
    panel.open ||
    Date.now() - lastActivity > 90000
  )
    return;
  const id = book.id,
    owner = account,
    day = new Date().toLocaleDateString("sv-SE");
  task(async () => {
    if (owner !== account) return;
    const key = "time/" + state.device,
      days = structuredClone(payload(key));
    days[day] ??= {};
    days[day][id] = (days[day][id] || 0) + Math.round(elapsed);
    set(key, days);
    await persist();
  });
}
function pauseTime() {
  tick();
  lastTick = performance.now();
}
async function showStats() {
  pauseTime();
  book = null;
  screen = "stats";
  top("阅读足迹", "一页一页，时间有了形状。");
  const days = sumDays(state.entries),
    total = Object.values(days).reduce(
      (sum, books) => sum + Object.values(books).reduce((a, b) => a + b, 0),
      0,
    );
  const dates = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      return d.toLocaleDateString("sv-SE");
    }),
    values = dates.map(
      (day) =>
        Object.values(days[day] || {}).reduce((a, b) => a + b, 0) / 60000,
    ),
    max = Math.max(1, ...values);
  $("page-content").innerHTML =
    `<div class="stat-total"><b>${(total / 3600000).toFixed(1)}</b><span>小时 · 累计有效阅读</span></div><h2>近十四天</h2><div class="chart" role="img" aria-label="近十四天阅读分钟数：${dates.map((d, i) => `${d} ${values[i].toFixed(1)} 分钟`).join("，")}">${values.map((v, i) => `<div class="bar-col"><span>${v ? Math.round(v) : ""}</span><div class="bar" style="height:${Math.max(2, (v / max) * 140)}px"></div><small>${dates[i].slice(8)}</small></div>`).join("")}</div><p class="hint">单位：分钟。仅记录前台阅读；打开面板、锁屏或切到后台即暂停。90 秒无操作后暂停，滚动或触摸继续。</p><div id="book-stats"></div>`;
  const totals = {};
  for (const books of Object.values(days))
    for (const [id, ms] of Object.entries(books))
      totals[id] = (totals[id] || 0) + ms;
  for (const [id, ms] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
    const row = document.createElement("div");
    row.className = "cache-row";
    row.textContent = `${payload(keyFor(id, "base")).title || "书籍"} · ${(ms / 60000).toFixed(0)} 分钟`;
    $("book-stats").append(row);
  }
}
setInterval(tick, 5000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseTime();
    active = false;
    task(saveProgress);
    setTimeout(()=>{if(!pageLeaving&&session&&navigator.onLine&&Date.now()-lastAutoSync>30000)task(syncNow);},100);
  } else {
    active = true;
    lastTick = performance.now();
    activity();
    if (session&&Date.now()-lastAutoSync>30000) task(syncNow);
  }
});
window.addEventListener("pagehide", () => {
  pageLeaving=true;
  pauseTime();
  active = false;
  task(saveProgress);
});
window.addEventListener("pageshow", () => {
  pageLeaving=false;
  active = !document.hidden;
  lastTick = performance.now();
});
window.addEventListener("online", () => {
  if (session) task(syncNow);
});
setInterval(() => {
  if (session && !panel.open && navigator.onLine) task(syncNow);
}, 300000);
window.addEventListener("keydown", (e) => {
  activity();
  if (e.key === "Escape") {
    clearHighlight();
    if (book) {
      menu = !menu;
      document
        .querySelectorAll(".reader-controls")
        .forEach((el) => (el.hidden = !menu));
    }
  }
});
await library();
if ("serviceWorker" in navigator) {
  let reloadOnChange = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      const ready = () => {
        if (reg.waiting) {
          $("update").hidden = false;
          $("update").onclick = () =>
            task(async () => {
              await saveProgress();
              pauseTime();
              reloadOnChange = true;
              reg.waiting.postMessage("SKIP_WAITING");
            });
        }
      };
      ready();
      reg.addEventListener("updatefound", () =>
        reg.installing?.addEventListener("statechange", ready),
      );
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloadOnChange) location.reload();
      });
      window.addEventListener("online", () => reg.update());
    })
    .catch(() => toast("离线资源安装失败，请联网重开后重试"));
}
