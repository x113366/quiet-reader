import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { createRequire } from "node:module";
import { digest, hash, paragraphs } from "../src/model.js";
import { synchronize, resolve, download } from "../src/sync.js";
import { empty, put, get, save, load, assetKey } from "../src/storage.js";
const require = createRequire(import.meta.url),
  desktop = require("../../QuietReader/src/cloud-sync.cjs"),
  core = {
    paragraphs: Function(
      readFileSync(
        new URL("../../QuietReader/src/core.cjs", import.meta.url),
        "utf8",
      ).match(/function paragraphs[\s\S]*?(?=function identity)/)[0] +
        ";return paragraphs",
    )(),
  };
function server() {
  const rows = new Map(),
    chunks = new Map();
  return {
    rows,
    call: async (name, a = {}) => {
      const r = rows.get(a.p_key);
      if (name === "reader_list")
        return [...rows]
          .filter(([key]) => key > (a.p_after || ""))
          .sort()
          .slice(0, 500)
          .map(([key, r]) => ({ key, ...r }));
      if (name === "reader_get") return structuredClone(r);
      if (name === "reader_put") {
        if ((r?.version || 0) !== a.p_version) return { ok: false };
        const next = {
          payload: structuredClone(a.p_payload),
          hash: a.p_hash,
          version: a.p_version + 1,
        };
        rows.set(a.p_key, next);
        return { ok: true, version: next.version };
      }
      if (name === "reader_chunk_put") {
        chunks.set(a.p_hash + "/" + a.p_part, a.p_data);
        return null;
      }
      if (name === "reader_chunk_get")
        return chunks.get(a.p_hash + "/" + a.p_part);
      throw Error(name);
    },
  };
}
test("desktop digest and paragraph compatibility", async () => {
  const value = {
    unknown: { z: 2, a: 1 },
    progress: { anchor: { paragraph: 5, offset: 9 } },
    array: [2, 1],
  };
  assert.equal(await digest(value), desktop.digest(value));
  const text = "\u3000第一章\r\n\r\n　正文 😀\n\n另一个段落";
  assert.deepEqual(paragraphs(text), core.paragraphs(text));
});
test("latest read time wins including backward reading, device snapshots retained", async () => {
  const s = server(),
    a = empty(),
    b = empty(),
    key = "book/" + "a".repeat(64) + "/reading";
  a.entries[key] = {
    payload: {
      progress: { anchor: { paragraph: 1, offset: 0 }, updatedAt:100,deviceId:a.device },
      desktopFuture: { keep: true },
    },
  };
  await synchronize("a", a, s.call, async () => {});
  await synchronize("b", b, s.call, async () => {});
  a.entries[key].payload.progress={anchor:{paragraph:8,offset:0},updatedAt:200,deviceId:a.device};
  b.entries[key].payload.progress={anchor:{paragraph:3,offset:0},updatedAt:300,deviceId:b.device};
  await synchronize("a", a, s.call, async () => {});
  await synchronize("b", b, s.call, async () => {});
  assert.equal(Object.keys(b.conflicts).length,0);
  assert.equal(s.rows.get(key).payload.progress.anchor.paragraph,3);
  const records=s.rows.get(key).payload.devices;
  assert.equal(records[a.device].progress.anchor.paragraph,8);
  assert.equal(records[b.device].progress.anchor.paragraph,3);
  await synchronize('a',a,s.call,async()=>{});
  assert.equal(a.entries[key].payload.progress.anchor.paragraph,3);
  assert.equal(a.entries[key].payload.desktopFuture.keep,true);
  s.rows.set("prefs/studio", {
    version: 1,
    hash: await digest({ future: 42 }),
    payload: { future: 42 },
  });
  await synchronize("b", b, s.call, async () => {});
  assert.deepEqual(b.entries["prefs/studio"].payload, { future: 42 });
});
test("offline edits checkpoint on reconnect; account and byte isolation; chunk integrity", async () => {
  const s = server(),
    state = empty(),
    key = "asset/books/" + "b".repeat(64) + ".txt",
    bytes = new TextEncoder().encode("书籍正文".repeat(50000));
  state.entries[key] = {
    payload: {
      hash: await hash(bytes),
      size: bytes.length,
      parts: Math.ceil(bytes.length / 393216),
    },
  };
  await put("assets", assetKey("alice", key), bytes.buffer);
  await save("alice", state);
  assert.equal((await load("bob")).entries[key], undefined);
  assert.equal(await get("assets", assetKey("bob", key)), undefined);
  await assert.rejects(
    synchronize(
      "alice",
      state,
      async () => {
        throw Error("offline");
      },
      async () => {},
    ),
  );
  assert.equal(state.entries[key].baseHash, undefined);
  await synchronize("alice", state, s.call, async () => {});
  const restored = await download(
    "alice-restore",
    key,
    state.entries[key].payload,
    s.call,
  );
  assert.equal(await hash(restored), await hash(bytes));
  await assert.rejects(
    download(
      "broken",
      key,
      { ...state.entries[key].payload, hash: "c".repeat(64) },
      s.call,
    ),
  );
});

test('desktop and web exchange progress, merge layout edits, defer active remote jumps and resolve by time', async () => {
  const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
  const {Store}=require('../../QuietReader/src/store.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reader-progress-'));
  try{
    const store=new Store(root);await store.init();
    const id='a'.repeat(64),key=`book/${id}/reading`,remote=server(),web=empty();
    await store.write({id,title:'同步',encoding:'utf-8',settings:require('../../QuietReader/src/core.cjs').defaults,window:{width:960,height:780},progress:{anchor:{paragraph:1,offset:0},updatedAt:100,deviceId:"desktop"},counts:{read:10,total:100}});
    const desktopSync=new desktop.CloudSync(store,{token:'test'},'desktop',remote.call);
    await desktopSync.run();await synchronize('test',web,remote.call,async()=>{});
    web.entries[key].payload.progress={anchor:{paragraph:5,offset:4},updatedAt:200,deviceId:web.device,epoch:2,snapshots:{}};
    web.entries[key].payload.counts.read=55;
    await synchronize('test',web,remote.call,async()=>{});
    await store.updateBook(id,b=>{b.window.width=1000;});
    assert.equal((await desktopSync.run(key)).conflicts.length,0);
    assert.equal((await store.read(id)).progress.anchor.paragraph,1);
    assert.equal((await desktopSync.run()).conflicts.length,0);
    assert.equal((await store.read(id)).progress.anchor.paragraph,5);
    assert.equal((await store.read(id)).counts.read,55);
    await synchronize('test',web,remote.call,async()=>{});
    await store.updateBook(id,b=>{b.progress={anchor:{paragraph:8,offset:2},updatedAt:300,deviceId:"desktop"};b.counts.read=80;});
    await desktopSync.run();
    web.entries[key].payload.settings.fontSize=24;
    assert.equal(await synchronize('test',web,remote.call,async()=>{}),0);
    assert.equal(web.entries[key].payload.progress.anchor.paragraph,8);
    assert.equal(web.entries[key].payload.settings.fontSize,24);
    await desktopSync.run();
    await store.updateBook(id,b=>{b.progress={anchor:{paragraph:3,offset:0},updatedAt:500,deviceId:"desktop"};});
    web.entries[key].payload.progress={anchor:{paragraph:9,offset:0},updatedAt:400,deviceId:web.device};
    await desktopSync.run();
    assert.equal(await synchronize('test',web,remote.call,async()=>{}),0);
    assert.equal(web.entries[key].payload.progress.anchor.paragraph,3);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
