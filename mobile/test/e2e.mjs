import { chromium, webkit, devices, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
await mkdir("test-results", { recursive: true });
for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  if(process.env.TEST_BROWSER&&process.env.TEST_BROWSER!==name)continue;
  const browser = await engine.launch(),
    context = await browser.newContext({
      ...devices["iPhone 13"],
      serviceWorkers: name === "webkit" ? "block" : "allow",
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.stack||e.message));
  const users = {
      alice: {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        token: "a".repeat(64),
      },
      bob: {
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        token: "b".repeat(64),
      },
    },
    remote = new Map();
  await context.route("**/rest/v1/rpc/**", async (route) => {
    const cors={"access-control-allow-origin":"*","access-control-allow-headers":"apikey,content-type","access-control-allow-methods":"POST,OPTIONS"};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    const name = route.request().url().split("/").at(-1),
      a = route.request().postDataJSON();
    let result = null;
    if (name === "reader_login") {
      if (!users[a.p_username])
        return route.fulfill({
          status: 400,
          json: { message: "用户名或密码错误" },
        });
      result = { ...users[a.p_username], username: a.p_username };
    } else {
      const rows = remote.get(a.p_token) || new Map();
      remote.set(a.p_token, rows);
      if (name === "reader_list")
        result = [...rows].map(([key, r]) => ({ key, ...r }));
      if (name === "reader_get") result = rows.get(a.p_key);
      if (name === "reader_put") {
        const r = rows.get(a.p_key);
        if ((r?.version || 0) !== a.p_version) result = { ok: false };
        else {
          rows.set(a.p_key, {
            payload: a.p_payload,
            hash: a.p_hash,
            version: a.p_version + 1,
          });
          result = { ok: true, version: a.p_version + 1 };
        }
      }
    }
    await route.fulfill({ json: result, headers: cors });
  });
  await page.goto("http://127.0.0.1:4173");
  await expect(page.getByRole("heading", { name: "我的书架" })).toBeVisible();
  if (name === "chromium") {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
  async function login(user) {
    await page.locator("#account-tab").click();
    await page.locator("#username").fill(user);
    await page.locator("#password").fill("test-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.locator("#account-tab")).toHaveText(user);
    await expect(page.locator("#toast")).not.toContainText(/同步/);
  }
  await login("alice");
  const text =
    "第一章 静谧的开始\n" +
    Array.from(
      { length: 100 },
      (_, i) =>
        `第 ${i} 段。窗外树影落在纸页上，这是可以长按选择并复制的中文正文。`,
    ).join("\n") +
    "\n请收藏本站\n第二章 山间来信\n故事还在继续。";
  await page.locator("#import").click();
  await expect(page.locator("#clean-enable")).not.toBeChecked();
  await page
    .locator("#file")
    .setInputFiles({
      name: "山间来信.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
  await page.locator("#preview").click();
  await expect(page.locator("#preview-result")).toContainText("将删除 0 行");
  await page.locator("#import-save").click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.locator(".cover").click();
  await expect(page.locator("#reader-top")).toBeHidden();
  await expect(page.locator("#text")).toContainText("请收藏本站");
  await expect(page.locator("#hud-clock")).toHaveText(/\d{2}:\d{2}/);
  await expect(page.locator("#hud-progress")).toHaveText(/%/);
  await expect(page.locator("#hud-eta")).toContainText("读完");
  await page.evaluate(() => {
    const p = document.querySelector("#text p:nth-child(2)"),
      r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  expect(await page.evaluate(() => getSelection().toString())).toContain(
    "可以长按",
  );
  await page.touchscreen.tap(195, 420);
  await expect(page.locator("#reader-top")).toBeHidden();
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.touchscreen.tap(195, 420);
  await expect(page.locator("#reader-top")).toBeVisible();
  await page.locator("#find").click();
  await page.locator("#query").fill("窗外树影");
  await page.locator("#search-go").click();
  await expect(page.locator("#results button")).toHaveCount(100);
  await page.locator("#results button").first().click();
  await expect(page.locator("mark")).toHaveCount(1);
  await page.locator("#find").click();
  await expect(page.locator("mark")).toHaveCount(0);
  await page.locator("#review").click();
  await page.locator("#rating").selectOption("4");
  await page.locator("#tags").fill("随笔，安静");
  await page.locator("#review-text").fill("适合午后阅读。");
  await page.locator("#review-save").click();
  await page.locator("#position").fill("5000");
  await page.locator("#position").dispatchEvent("change");
  await page.waitForTimeout(500);
  await page.locator("#back").click();
  await expect(page.locator(".book-numbers b")).not.toHaveText("0.0%");
  await page.screenshot({ path: `test-results/${name}-dark.png` });
  await page.locator("#style").click();
  await expect(page.locator("body")).toHaveAttribute("data-ui", "light");
  await page.screenshot({ path: `test-results/${name}-light.png` });
  await page.locator("#stats-tab").click();
  await expect(page.getByRole("heading", {name:"每日时长",exact:true})).toBeVisible();
  await expect(page.getByRole("heading", {name:"阅读日历",exact:true})).toBeVisible();
  await expect(page.getByRole("heading", {name:"书籍时长排名",exact:true})).toBeVisible();
  await page.setViewportSize({width:320,height:740});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/${name}-footprints.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.locator("#library-tab").click();
  if (name === "chromium") await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.locator(".cover").click();
  await expect(page.locator("#text")).toContainText("窗外树影");
  await page.screenshot({ path: `test-results/${name}-reading.png` });
  if (name === "chromium") await context.setOffline(false);
  await page.touchscreen.tap(195, 420);
  await page.locator("#back").click();
  await page.locator("#account-tab").click();
  await page.locator("#logout").click();
  await expect(page.locator(".book-card")).toHaveCount(0);
  await login("bob");
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page.locator("#account-tab").click();
  await page.locator("#logout").click();
  await login("alice");
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.setViewportSize({ width: 844, height: 390 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    `${name}: login, import, selection, menu, search cleanup, review, progress, themes, offline reload, sync and account isolation passed`,
  );
  await browser.close();
}
// WebKit routes do not intercept fetches owned by a service worker. Exercise
// offline installation separately, without mocking any network/account traffic.
{
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.join("dist", req.url === "/" ? "index.html" : req.url);
      const mime = {
        ".js": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
        ".webmanifest": "application/manifest+json",
        ".png": "image/png",
      };
      res.setHeader("Content-Type", mime[path.extname(file)] || "text/plain");
      res.end(await readFile(file));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(4174, "127.0.0.1", r));
  const browser = await webkit.launch(),
    context = await browser.newContext({
      ...devices["iPhone 13"],
      serviceWorkers: "allow",
    }),
    page = await context.newPage();
  await page.goto("http://127.0.0.1:4174");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator("#import").click();
  await page
    .locator("#file")
    .setInputFiles({
      name: "离线验证.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "第一章\n离线重开正文\n请收藏本站\n这是原文备份验证。",
      ),
    });
  await page.locator("#clean-enable").check();
  await page.locator("[name=preset][value=promotion]").check();
  await page.locator("#preview").click();
  await expect(page.locator("#preview-result")).toContainText("将删除 1 行");
  await page.locator("#import-save").click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await new Promise((r) => server.close(r));
  await page.reload();
  await page.locator(".cover").click();
  await expect(page.locator("#text")).toContainText("离线重开正文");
  await expect(page.locator("#text")).not.toContainText("请收藏本站");
  const originals = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("quiet-reader-mobile-v1");
        r.onsuccess = () => {
          const tx = r.result.transaction("assets"),
            s = tx.objectStore("assets"),
            k = s.getAllKeys();
          k.onsuccess = () => {
            const key = k.result.find((k) => k.endsWith(".original.txt"));
            const q = s.get(key);
            q.onsuccess = () => resolve(new TextDecoder().decode(q.result));
          };
        };
        r.onerror = reject;
      }),
  );
  expect(originals).toContain("请收藏本站");
  console.log(
    "webkit: real service worker offline reload and opt-in cleaning/original retention passed",
  );
  await browser.close();
}
