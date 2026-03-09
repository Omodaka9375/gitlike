#!/usr/bin/env node


// src/index.ts
import { Command } from "commander";

// src/auth.ts
import http from "node:http";

// src/config.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
var GLOBAL_DIR = path.join(os.homedir(), ".gitlike");
var GLOBAL_CONFIG = path.join(GLOBAL_DIR, "config.json");
var LOCAL_DIR = ".gitlike";
var LOCAL_CONFIG = "repo.json";
var DEFAULT_API = "https://gitlike.dev";
function readGlobalConfig() {
  try {
    const raw = fs.readFileSync(GLOBAL_CONFIG, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      apiUrl: parsed.apiUrl || DEFAULT_API,
      token: parsed.token || "",
      address: parsed.address || ""
    };
  } catch {
    return { apiUrl: DEFAULT_API, token: "", address: "" };
  }
}
function writeGlobalConfig(config) {
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  fs.writeFileSync(GLOBAL_CONFIG, JSON.stringify(config, null, 2) + "\n");
}
function clearGlobalConfig() {
  try {
    fs.unlinkSync(GLOBAL_CONFIG);
  } catch {
  }
}
function requireAuth() {
  const config = readGlobalConfig();
  if (!config.token) {
    console.error("Not authenticated. Run: gitlike auth login");
    process.exit(1);
  }
  return config;
}
function findRepoRoot() {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, LOCAL_DIR, LOCAL_CONFIG))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function readRepoState(root) {
  const repoRoot = root ?? findRepoRoot();
  if (!repoRoot) return null;
  try {
    const raw = fs.readFileSync(path.join(repoRoot, LOCAL_DIR, LOCAL_CONFIG), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeRepoState(state, root) {
  const repoRoot = root ?? process.cwd();
  const dir = path.join(repoRoot, LOCAL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, LOCAL_CONFIG), JSON.stringify(state, null, 2) + "\n");
}
function requireRepo() {
  const root = findRepoRoot();
  if (!root) {
    console.error("Not inside a GitLike repo. Run: gitlike clone <groupId>");
    process.exit(1);
  }
  const state = readRepoState(root);
  return { root, state };
}
function readLocalIndex(root) {
  const repoRoot = root ?? findRepoRoot();
  if (!repoRoot) return {};
  try {
    const raw = fs.readFileSync(path.join(repoRoot, LOCAL_DIR, "index.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function writeLocalIndex(index, root) {
  const repoRoot = root ?? process.cwd();
  const dir = path.join(repoRoot, LOCAL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
}

// src/auth.ts
async function browserLogin() {
  const config = readGlobalConfig();
  const base = config.apiUrl || "https://gitlike.dev";
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        });
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/callback") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (!data.token || !data.address) {
              res.writeHead(400, { "Access-Control-Allow-Origin": "*" });
              res.end("Missing token or address");
              return;
            }
            writeGlobalConfig({ ...config, token: data.token, address: data.address });
            res.writeHead(200, {
              "Content-Type": "text/html",
              "Access-Control-Allow-Origin": "*"
            });
            res.end("OK");
            console.log(`
\u2713 Authenticated as ${data.address}`);
            console.log("  You can close the browser tab.");
            server.close();
            resolve();
          } catch (err) {
            res.writeHead(400, { "Access-Control-Allow-Origin": "*" });
            res.end("Invalid request");
            server.close();
            reject(err);
          }
        });
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    const loopback = [127, 0, 0, 1].join(".");
    server.listen(0, loopback, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to start auth server"));
        return;
      }
      const port = addr.port;
      const authUrl = `${base}/cli-auth?port=${port}`;
      console.log(`Opening browser for authentication...`);
      console.log(`  If it doesn't open, visit: ${authUrl}
`);
      try {
        const open = (await import("open")).default;
        await open(authUrl);
      } catch {
      }
    });
    setTimeout(
      () => {
        server.close();
        reject(new Error("Auth timed out after 5 minutes."));
      },
      5 * 60 * 1e3
    );
  });
}
function tokenLogin(token, address) {
  const config = readGlobalConfig();
  writeGlobalConfig({ ...config, token, address });
  console.log(`\u2713 Authenticated as ${address}`);
}
function logout() {
  clearGlobalConfig();
  console.log("Logged out.");
}
function authStatus() {
  const config = readGlobalConfig();
  if (!config.token) {
    console.log("Not authenticated.");
    console.log("  Run: gitlike auth login");
    return;
  }
  console.log(`Authenticated as ${config.address}`);
  console.log(`  API: ${config.apiUrl}`);
}

// src/clone.ts
import fs3 from "node:fs";
import path3 from "node:path";

// src/api.ts
function getBase() {
  return readGlobalConfig().apiUrl || "https://gitlike.dev";
}
function getToken() {
  return readGlobalConfig().token || "";
}
async function apiFetch(path8, init = {}, auth2 = false) {
  const url = `${getBase()}/api${path8}`;
  const headers = {
    "Content-Type": "application/json",
    ...init.headers
  };
  const token = getToken();
  if (auth2 || token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let msg = `API error: ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {
    }
    throw new Error(msg);
  }
  return res;
}
async function fetchJSON(cid) {
  const base = getBase();
  const token = getToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}/api/ipfs/${cid}`, { headers });
  if (!res.ok) throw new Error(`Gateway fetch failed for ${cid}: ${res.status}`);
  return res.json();
}
async function fetchBytes(cid) {
  const base = getBase();
  const token = getToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}/api/ipfs/${cid}`, { headers });
  if (!res.ok) throw new Error(`Gateway fetch failed for ${cid}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
async function fetchManifest(groupId) {
  try {
    const res = await apiFetch(`/repos/${groupId}/manifest`, {}, true);
    const data = await res.json();
    return data.manifest;
  } catch {
    return null;
  }
}
async function getPresignedUrl(repoId) {
  const res = await apiFetch(`/repos/${repoId}/presign`, { method: "POST" }, true);
  const data = await res.json();
  return data.url;
}
async function uploadFile(repoId, fileName, content) {
  const presignedUrl = await getPresignedUrl(repoId);
  const blob = new Blob([content]);
  const formData = new FormData();
  formData.append("file", blob, fileName);
  const res = await fetch(presignedUrl, { method: "POST", body: formData });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  const d = data;
  return { cid: d.data.cid, size: d.data.size ?? content.length };
}
async function commitFiles(repoId, branch2, message, files) {
  const res = await apiFetch(
    `/repos/${repoId}/commit`,
    { method: "POST", body: JSON.stringify({ branch: branch2, message, files }) },
    true
  );
  return res.json();
}
async function createBranch(repoId, name, from) {
  await apiFetch(
    `/repos/${repoId}/branch`,
    { method: "POST", body: JSON.stringify({ name, from }) },
    true
  );
}
async function createRepo(name, description, visibility, license) {
  const res = await apiFetch(
    "/repos",
    { method: "POST", body: JSON.stringify({ name, description, visibility, license }) },
    true
  );
  return res.json();
}

// src/tree-io.ts
import fs2 from "node:fs";
import path2 from "node:path";
var CONCURRENCY = 6;
function createLimiter(max) {
  let active = 0;
  const queue = [];
  return (fn) => new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        active--;
        if (queue.length > 0) queue.shift()();
      }
    };
    if (active < max) {
      run();
    } else {
      queue.push(run);
    }
  });
}
async function downloadTree(tree, dir, onFile) {
  const limit = createLimiter(CONCURRENCY);
  const tasks = [];
  const walk = (t, d) => {
    for (const entry of t.entries) {
      const target = path2.join(d, entry.name);
      if (entry.kind === "tree") {
        tasks.push(
          (async () => {
            fs2.mkdirSync(target, { recursive: true });
            const sub = await fetchJSON(entry.cid);
            walk(sub, target);
          })()
        );
      } else {
        tasks.push(
          limit(async () => {
            const data = await fetchBytes(entry.cid);
            fs2.mkdirSync(path2.dirname(target), { recursive: true });
            fs2.writeFileSync(target, data);
            onFile(target);
          })
        );
      }
    }
  };
  walk(tree, dir);
  await Promise.all(tasks);
}
async function buildTreeIndex(treeCid) {
  const index = /* @__PURE__ */ new Map();
  const walk = async (tree2, prefix) => {
    for (const entry of tree2.entries) {
      const p = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "tree") {
        const sub = await fetchJSON(entry.cid);
        await walk(sub, p);
      } else {
        index.set(p, entry.cid);
      }
    }
  };
  const tree = await fetchJSON(treeCid);
  await walk(tree, "");
  return index;
}

// src/clone.ts
async function cloneRepo(groupId, targetDir) {
  console.log(`Fetching manifest for ${groupId}...`);
  const manifest = await fetchManifest(groupId);
  if (!manifest) {
    console.error("Repository not found.");
    process.exit(1);
  }
  const dir = targetDir || manifest.name || groupId;
  const root = path3.resolve(dir);
  if (fs3.existsSync(root) && fs3.readdirSync(root).length > 0) {
    console.error(`Directory "${dir}" already exists and is not empty.`);
    process.exit(1);
  }
  const branch2 = manifest.defaultBranch || "main";
  const headCid = manifest.branches[branch2];
  if (!headCid) {
    console.error(`Branch "${branch2}" not found.`);
    process.exit(1);
  }
  console.log(`Cloning ${manifest.name} (${branch2}) into ${dir}/`);
  const commit = await fetchJSON(headCid);
  const tree = await fetchJSON(commit.tree);
  fs3.mkdirSync(root, { recursive: true });
  let count = 0;
  await downloadTree(tree, root, () => {
    count++;
    if (count % 10 === 0) process.stdout.write(`\r  Downloaded ${count} files...`);
  });
  writeRepoState({ groupId, name: manifest.name, branch: branch2, head: headCid }, root);
  const index = await buildTreeIndex(commit.tree);
  writeLocalIndex(Object.fromEntries(index), root);
  console.log(`\r\u2713 Cloned ${count} files into ${dir}/`);
}

// src/init.ts
import fs4 from "node:fs";
async function initRepo(name, opts = {}) {
  requireAuth();
  if (findRepoRoot()) {
    console.error("Already inside a GitLike repo. Aborting.");
    process.exit(1);
  }
  console.log(`Creating repo "${name}"...`);
  const { groupId, commitCid } = await createRepo(
    name,
    opts.description,
    opts.visibility,
    opts.license
  );
  writeRepoState({
    groupId,
    name,
    branch: "main",
    head: commitCid
  });
  writeLocalIndex({});
  if (!fs4.existsSync(".gitlikeignore")) {
    fs4.writeFileSync(
      ".gitlikeignore",
      ["node_modules/", ".git/", "dist/", ".env", ".env.*", ""].join("\n")
    );
  }
  console.log(`\u2713 Repo created: ${name} (${groupId.slice(0, 12)}\u2026)`);
  console.log(`  Branch: main`);
  console.log(`  HEAD:   ${commitCid.slice(0, 12)}\u2026`);
}

// src/pull.ts
import fs5 from "node:fs";
import path4 from "node:path";
var PROTECTED_DIRS = /* @__PURE__ */ new Set([".gitlike", ".git", "node_modules"]);
async function pullRepo() {
  const { root, state } = requireRepo();
  console.log(`Pulling ${state.name} (${state.branch})...`);
  const manifest = await fetchManifest(state.groupId);
  if (!manifest) {
    console.error("Repository not found on remote.");
    process.exit(1);
  }
  const remoteCid = manifest.branches[state.branch];
  if (!remoteCid) {
    console.error(`Branch "${state.branch}" not found on remote.`);
    process.exit(1);
  }
  if (remoteCid === state.head) {
    console.log("Already up to date.");
    return;
  }
  const commit = await fetchJSON(remoteCid);
  const tree = await fetchJSON(commit.tree);
  const remoteIndex = await buildTreeIndex(commit.tree);
  const remotePaths = new Set(remoteIndex.keys());
  let downloaded = 0;
  await downloadTree(tree, root, () => {
    downloaded++;
  });
  const deleted = cleanStaleFiles(root, remotePaths);
  writeRepoState({ ...state, head: remoteCid }, root);
  writeLocalIndex(Object.fromEntries(remoteIndex), root);
  const parts = [`\u2713 Updated ${downloaded} files`];
  if (deleted > 0) parts.push(`removed ${deleted} stale files`);
  parts.push(`HEAD is now ${remoteCid.slice(0, 12)}\u2026`);
  console.log(parts.join(", ") + ".");
}
function cleanStaleFiles(root, remotePaths) {
  let deleted = 0;
  const walk = (dir) => {
    for (const entry of fs5.readdirSync(dir, { withFileTypes: true })) {
      if (PROTECTED_DIRS.has(entry.name)) continue;
      const full = path4.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        try {
          const remaining = fs5.readdirSync(full);
          if (remaining.length === 0) fs5.rmdirSync(full);
        } catch {
        }
      } else {
        const rel = path4.relative(root, full).replace(/\\/g, "/");
        if (!remotePaths.has(rel)) {
          fs5.unlinkSync(full);
          deleted++;
        }
      }
    }
  };
  walk(root);
  return deleted;
}

// src/push.ts
import fs7 from "node:fs";
import crypto from "node:crypto";
import path6 from "node:path";

// src/file-filter.ts
import fs6 from "node:fs";
import path5 from "node:path";
var ALWAYS_IGNORED = /* @__PURE__ */ new Set([".ds_store", "thumbs.db", "desktop.ini"]);
var SKIP_DIRS = /* @__PURE__ */ new Set([".gitlike", ".git", "node_modules"]);
function shouldIgnore(filePath, patterns = []) {
  const segments = filePath.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].startsWith(".")) return true;
  }
  const filename = segments[segments.length - 1].toLowerCase();
  if (ALWAYS_IGNORED.has(filename)) return true;
  if (patterns.length > 0 && matchesPatterns(filePath, patterns)) return true;
  return false;
}
function parseIgnoreFile(content) {
  return content.split("\n").map((line) => line.trimEnd()).filter((line) => line && !line.startsWith("#"));
}
function loadIgnorePatterns(root) {
  const gitlikeignore = path5.join(root, ".gitlikeignore");
  const gitignore = path5.join(root, ".gitignore");
  try {
    if (fs6.existsSync(gitlikeignore)) {
      return parseIgnoreFile(fs6.readFileSync(gitlikeignore, "utf-8"));
    }
    if (fs6.existsSync(gitignore)) {
      return parseIgnoreFile(fs6.readFileSync(gitignore, "utf-8"));
    }
  } catch {
  }
  return [];
}
function collectFiles(root, patterns = []) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs6.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path5.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = path5.relative(root, full).replace(/\\/g, "/");
        if (!shouldIgnore(rel, patterns)) {
          files.push(rel);
        }
      }
    }
  };
  walk(root);
  return files;
}
function matchesPatterns(filePath, patterns) {
  let ignored = false;
  for (const raw of patterns) {
    const negate = raw.startsWith("!");
    const pattern = negate ? raw.slice(1) : raw;
    if (patternMatches(filePath, pattern)) {
      ignored = !negate;
    }
  }
  return ignored;
}
function patternMatches(filePath, pattern) {
  const dirOnly = pattern.endsWith("/");
  const clean = dirOnly ? pattern.slice(0, -1) : pattern;
  const anchored = clean.includes("/");
  if (anchored) {
    const p = clean.startsWith("/") ? clean.slice(1) : clean;
    if (dirOnly) {
      return filePath.startsWith(p + "/") || filePath === p;
    }
    return globMatch(filePath, p);
  }
  const segments = filePath.split("/");
  if (dirOnly) {
    return segments.slice(0, -1).some((s) => globMatch(s, clean));
  }
  return globMatch(segments[segments.length - 1], clean) || globMatch(filePath, "**/" + clean);
}
function globMatch(text, pattern) {
  return globToRegex(pattern).test(text);
}
function globToRegex(pattern) {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (pattern[i] === "/") i++;
    } else if (ch === "*") {
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (ch === "[") {
      const end = pattern.indexOf("]", i);
      if (end !== -1) {
        re += pattern.slice(i, end + 1);
        i = end + 1;
      } else {
        re += "\\[";
        i++;
      }
    } else if (".+^${}()|\\".includes(ch)) {
      re += "\\" + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

// src/push.ts
async function pushRepo(message, filePaths) {
  requireAuth();
  const { root, state } = requireRepo();
  console.log(`Pushing to ${state.name} (${state.branch})...`);
  const patterns = loadIgnorePatterns(root);
  const localIndex = readLocalIndex(root);
  const allLocal = filePaths?.length ? filePaths.map((p) => p.replace(/\\/g, "/")) : collectFiles(root, patterns);
  const changed = [];
  const hashes = /* @__PURE__ */ new Map();
  for (const relPath of allLocal) {
    const fullPath = path6.join(root, relPath);
    if (!fs7.existsSync(fullPath) || fs7.statSync(fullPath).isDirectory()) continue;
    const content = fs7.readFileSync(fullPath);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    hashes.set(relPath, hash);
    const storedCid = localIndex[relPath];
    if (storedCid && storedCid.startsWith("sha256:") && storedCid === `sha256:${hash}`) {
      continue;
    }
    changed.push(relPath);
  }
  if (changed.length === 0) {
    console.log("No changes to push.");
    return;
  }
  console.log(`  ${changed.length} changed file(s) to upload (${allLocal.length} total)`);
  const staged = [];
  let uploaded = 0;
  for (const relPath of changed) {
    const fullPath = path6.join(root, relPath);
    const content = new Uint8Array(fs7.readFileSync(fullPath));
    const fileName = path6.basename(relPath);
    process.stdout.write(`\r  Uploading ${++uploaded}/${changed.length}: ${relPath}`);
    const { cid, size } = await uploadFile(state.groupId, fileName, content);
    staged.push({ path: relPath, cid, size });
  }
  process.stdout.write("\r  Committing...                                    \n");
  const result = await commitFiles(state.groupId, state.branch, message, staged);
  writeRepoState({ ...state, head: result.commitCid }, root);
  const newIndex = {};
  for (const [p, hash] of hashes) {
    newIndex[p] = `sha256:${hash}`;
  }
  writeLocalIndex(newIndex, root);
  console.log(`\u2713 Committed ${staged.length} files. ${result.commitCid.slice(0, 12)}\u2026`);
}

// src/commands.ts
import fs8 from "node:fs";
import crypto2 from "node:crypto";
import path7 from "node:path";
async function showLog(count = 20) {
  const { state } = requireRepo();
  const manifest = await fetchManifest(state.groupId);
  if (!manifest) {
    console.error("Repository not found.");
    process.exit(1);
  }
  const headCid = manifest.branches[state.branch];
  if (!headCid) {
    console.error(`Branch "${state.branch}" not found.`);
    process.exit(1);
  }
  console.log(`Log for ${state.name} (${state.branch}):
`);
  let cid = headCid;
  let shown = 0;
  while (cid && shown < count) {
    const commit = await fetchJSON(cid);
    const short = cid.slice(0, 12);
    const date = new Date(commit.timestamp).toLocaleString();
    const author = commit.author.slice(0, 6) + "\u2026" + commit.author.slice(-4);
    console.log(`\x1B[33m${short}\x1B[0m ${commit.message}`);
    console.log(`  ${author}  ${date}
`);
    cid = commit.parents.length > 0 ? commit.parents[0] : null;
    shown++;
  }
}
async function showStatus() {
  const { root, state } = requireRepo();
  console.log(`Repository: ${state.name}`);
  console.log(`Group ID:   ${state.groupId}`);
  console.log(`Branch:     ${state.branch}`);
  console.log(`HEAD:       ${state.head.slice(0, 16)}\u2026`);
  console.log(`Root:       ${root}`);
  const manifest = await fetchManifest(state.groupId);
  if (manifest) {
    const remoteCid = manifest.branches[state.branch];
    if (remoteCid && remoteCid !== state.head) {
      console.log(`
\u26A0  Remote HEAD has advanced. Run: gitlike pull`);
    } else if (remoteCid === state.head) {
      console.log(`
\u2713 Up to date with remote.`);
    }
  }
}
async function listBranches() {
  const { state } = requireRepo();
  const manifest = await fetchManifest(state.groupId);
  if (!manifest) {
    console.error("Repository not found.");
    process.exit(1);
  }
  for (const name of Object.keys(manifest.branches)) {
    const marker = name === state.branch ? "* " : "  ";
    const cid = manifest.branches[name].slice(0, 12);
    console.log(`${marker}${name}  (${cid}\u2026)`);
  }
}
async function createNewBranch(name) {
  requireAuth();
  const { state } = requireRepo();
  console.log(`Creating branch "${name}" from "${state.branch}"...`);
  await createBranch(state.groupId, name, state.branch);
  console.log(`\u2713 Branch "${name}" created.`);
}
async function switchBranch(name) {
  const { root, state } = requireRepo();
  const manifest = await fetchManifest(state.groupId);
  if (!manifest) {
    console.error("Repository not found.");
    process.exit(1);
  }
  const headCid = manifest.branches[name];
  if (!headCid) {
    console.error(`Branch "${name}" not found.`);
    process.exit(1);
  }
  console.log(`Switching to ${name}...`);
  const commit = await fetchJSON(headCid);
  const tree = await fetchJSON(commit.tree);
  let count = 0;
  await downloadTree(tree, root, () => {
    count++;
  });
  writeRepoState({ ...state, branch: name, head: headCid }, root);
  const index = await buildTreeIndex(commit.tree);
  writeLocalIndex(Object.fromEntries(index), root);
  console.log(`\u2713 Switched to ${name}. ${count} files updated.`);
}
function showDiff() {
  const { root } = requireRepo();
  const localIndex = readLocalIndex(root);
  const patterns = loadIgnorePatterns(root);
  const localFiles = collectFiles(root, patterns);
  const added = [];
  const modified = [];
  const deleted = [];
  const seen = /* @__PURE__ */ new Set();
  for (const relPath of localFiles) {
    seen.add(relPath);
    const stored = localIndex[relPath];
    if (!stored) {
      added.push(relPath);
      continue;
    }
    const fullPath = path7.join(root, relPath);
    const content = fs8.readFileSync(fullPath);
    const hash = crypto2.createHash("sha256").update(content).digest("hex");
    if (stored !== `sha256:${hash}`) {
      modified.push(relPath);
    }
  }
  for (const p of Object.keys(localIndex)) {
    if (!seen.has(p)) deleted.push(p);
  }
  if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
    console.log("No changes.");
    return;
  }
  for (const p of added) console.log(`\x1B[32m  A  ${p}\x1B[0m`);
  for (const p of modified) console.log(`\x1B[33m  M  ${p}\x1B[0m`);
  for (const p of deleted) console.log(`\x1B[31m  D  ${p}\x1B[0m`);
  console.log(`
${added.length} added, ${modified.length} modified, ${deleted.length} deleted`);
}

// src/index.ts
var VERSION = "0.1.0";
var program = new Command();
program.name("gitlike").description("GitLike \u2014 decentralized version control on IPFS").version(VERSION);
var auth = program.command("auth").description("Manage authentication");
auth.command("login").description("Authenticate via browser (SIWE)").option("--token <token>", "Use a token directly instead of browser flow").option("--address <address>", "Wallet address (required with --token)").action(async (opts) => {
  if (opts.token) {
    if (!opts.address) {
      console.error("--address is required when using --token");
      process.exit(1);
    }
    tokenLogin(opts.token, opts.address);
  } else {
    await browserLogin();
  }
});
auth.command("logout").description("Clear stored credentials").action(() => logout());
auth.command("status").description("Show current auth status").action(() => authStatus());
program.command("init <name>").description("Create a new repo and initialise the current directory").option("-d, --description <desc>", "Repo description").option("--private", "Create a private repo").option("--license <id>", "License identifier (e.g. MIT, Apache-2.0)").action(
  async (name, opts) => {
    await initRepo(name, {
      description: opts.description,
      visibility: opts.private ? "private" : "public",
      license: opts.license
    });
  }
);
program.command("clone <groupId>").description("Clone a repo by group ID").argument("[directory]", "Target directory").action(async (groupId, directory) => {
  await cloneRepo(groupId, directory);
});
program.command("pull").description("Pull latest changes from remote").action(async () => {
  await pullRepo();
});
program.command("push").description("Push local changes to remote").requiredOption("-m, --message <msg>", "Commit message").option("--files <paths...>", "Specific files to push (default: all)").action(async (opts) => {
  await pushRepo(opts.message, opts.files);
});
program.command("log").description("Show commit history").option("-n, --count <n>", "Number of commits to show", "20").action(async (opts) => {
  await showLog(parseInt(opts.count, 10));
});
program.command("status").description("Show repo status").action(async () => {
  await showStatus();
});
program.command("diff").description("Show changed files compared to last push/pull").action(() => {
  showDiff();
});
var branch = program.command("branch").description("Manage branches");
branch.command("list").description("List remote branches").action(async () => {
  await listBranches();
});
branch.command("create <name>").description("Create a new branch from current branch").action(async (name) => {
  await createNewBranch(name);
});
program.command("switch <branch>").description("Switch to a different branch").action(async (branchName) => {
  await switchBranch(branchName);
});
program.parse();
//# sourceMappingURL=gitlike.mjs.map
