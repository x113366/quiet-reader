import readingMerge from "../../QuietReader/src/reading-merge.cjs";
import config from "../../QuietReader/src/cloud-config.json" with { type: "json" };
import { digest, hash } from "./model.js";
import { get, put, assetKey } from "./storage.js";
export async function rpc(name, args) {
  let response;
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: config.key, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw Error("云端暂不可达，本机修改已保留");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Error(result?.message || "云端请求失败");
  return result;
}
export function client(session, request = rpc) {
  return (name, args = {}) =>
    request(name, { p_token: session.token, ...args });
}
const PART = 393216;
function base64(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i += 8192)
    str += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(str);
}
export async function upload(account, key, entry, version, call) {
  if (key.startsWith("asset/")) {
    const data = await get("assets", assetKey(account, key));
    if (!data || (await hash(data)) !== entry.payload.hash)
      throw Error("待上传原文缺失，不能标记为已备份");
    for (let i = 0; i < entry.payload.parts; i++)
      await call("reader_chunk_put", {
        p_hash: entry.payload.hash,
        p_part: i,
        p_data: base64(new Uint8Array(data).subarray(i * PART, (i + 1) * PART)),
      });
  }
  const checksum = await digest(entry.payload);
  return {
    ...(await call("reader_put", {
      p_key: key,
      p_version: version,
      p_payload: entry.payload,
      p_hash: checksum,
    })),
    hash: checksum,
  };
}
export async function download(account, key, payload, call) {
  if (
    !payload ||
    !Number.isInteger(payload.size) ||
    payload.size < 0 ||
    payload.size > 64 * 1024 * 1024 ||
    payload.parts !== Math.ceil(payload.size / PART) ||
    !/^[a-f0-9]{64}$/.test(payload.hash)
  )
    throw Error("无效文件清单");
  const bytes = new Uint8Array(payload.size);
  let offset = 0;
  for (let i = 0; i < payload.parts; i++) {
    const raw = await call("reader_chunk_get", {
      p_hash: payload.hash,
      p_part: i,
    });
    if (typeof raw !== "string") throw Error("云端分片缺失");
    const data = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    bytes.set(data, offset);
    offset += data.length;
  }
  if (offset !== bytes.length || (await hash(bytes)) !== payload.hash)
    throw Error("正文校验失败");
  await put("assets", assetKey(account, key), bytes.buffer);
  return bytes.buffer;
}
// Caller serializes local mutations and account switches with this operation.
// Every entry is retained verbatim, including desktop-only and future fields.
export async function synchronize(account, state, call, checkpoint, activeReadingKey = null) {
  const remote = new Map();
  let after = "";
  while (true) {
    const rows = await call("reader_list", { p_after: after });
    if (!Array.isArray(rows)) throw Error("无效同步响应");
    for (const r of rows) remote.set(r.key, r);
    if (rows.length < 500) break;
    after = rows.at(-1).key;
  }
  for (const key of [
    ...new Set([...Object.keys(state.entries), ...remote.keys()]),
  ].sort()) {
    const local = state.entries[key],
      row = remote.get(key);
    const localHash = local ? await digest(local.payload) : null;
    if (row && localHash === row.hash) {
      Object.assign(local, { version: row.version, baseHash: row.hash, basePayload: structuredClone(local.payload) });
      delete state.conflicts[key];
    } else {
      const changed = local && localHash !== local.baseHash;
      const remoteChanged = row && (!local || row.version !== local.version);
      if (changed && remoteChanged) {
        const other = await call("reader_get", { p_key: key });
        const merged = key.endsWith('/reading') && other ? readingMerge.mergeReading(local.basePayload, local.payload, other.payload) : null;
        if (merged && key === activeReadingKey && (!readingMerge.equal(readingMerge.position(merged), readingMerge.position(local.payload)) || !readingMerge.equal(merged.settings,local.payload.settings))) continue;
        if (merged) {
          const result = await upload(account, key, {payload:merged}, other.version, call);
          if (result.ok) {
            state.entries[key] = {payload:merged,version:result.version,baseHash:result.hash,basePayload:structuredClone(merged)};
            delete state.conflicts[key];
            await checkpoint();
            continue;
          }
        }
        state.conflicts[key] = { remote: other, localHash };
      } else if (changed) {
        const result = await upload(
          account,
          key,
          local,
          row?.version || 0,
          call,
        );
        if (result.ok) {
          Object.assign(local, {
            version: result.version,
            baseHash: result.hash,
            basePayload: structuredClone(local.payload),
          });
          delete state.conflicts[key];
        } else
          state.conflicts[key] = {
            remote: await call("reader_get", { p_key: key }),
            localHash,
          };
      } else if (row && (remoteChanged || !local)) {
        if (key === activeReadingKey) continue;
        const other = await call("reader_get", { p_key: key });
        if (!other) throw Error("云端已变化，请重试");
        state.entries[key] = {
          payload: other.payload,
          version: other.version,
          baseHash: other.hash,
          basePayload: structuredClone(other.payload),
        };
        delete state.conflicts[key];
      }
    }
    await checkpoint();
  }
  state.lastSync = Date.now();
  await checkpoint();
  return Object.keys(state.conflicts).length;
}
export async function resolve(account, state, key, choice, call, checkpoint) {
  const conflict = state.conflicts[key],
    entry = state.entries[key],
    remote = await call("reader_get", { p_key: key });
  if (
    !conflict ||
    !remote ||
    remote.version !== conflict.remote.version ||
    (await digest(entry.payload)) !== conflict.localHash
  )
    throw Error("版本已变化，请重新同步后选择");
  state.history.push({
    key,
    local: structuredClone(entry.payload),
    remote,
    choice,
    at: Date.now(),
  });
  await checkpoint();
  if (choice === "remote")
    state.entries[key] = {
      payload: remote.payload,
      version: remote.version,
      baseHash: remote.hash,
      basePayload: structuredClone(remote.payload),
    };
  else {
    const result = await upload(account, key, entry, remote.version, call);
    if (!result.ok) throw Error("云端版本已变化");
    Object.assign(entry, { version: result.version, baseHash: result.hash, basePayload: structuredClone(entry.payload) });
  }
  delete state.conflicts[key];
  await checkpoint();
}
