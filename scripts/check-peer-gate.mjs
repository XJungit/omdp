#!/usr/bin/env node
/**
 * check-peer-gate.mjs — 校验本仓库插件的 DSH 版本门禁声明（AGENTS.md 规范 3）
 *
 * 用途：改完 peerDependencies 后跑一遍，确认「三元组区间」的放行/拦截边界
 * 与预期完全一致。**尤其防止两类高频错误**：
 *
 *   1. 上界漏写 `-0`（写成 `<0.2.1`），导致下一个三元组的 rc 被漏放行；
 *   2. 收窄/放宽支持面后忘了同步期望值，把「有意变更」误判成回归。
 *
 * 用法：
 *   node scripts/check-peer-gate.mjs            # 检查本仓库三个插件
 *   node scripts/check-peer-gate.mjs --verbose  # 打印每个运行时版本的判定
 *
 * 判定模式：
 *   - 若当前环境能解析 `@deepseek-ai/dsh-app-boot`，直接用**真门禁函数**
 *     `evaluatePluginCompatibility()`（首选，能覆盖"只检查 dsh 前缀"等额外语义）；
 *   - 否则回退到等价的 semver 谓词（`includePrerelease: true`，只比 dsh 前缀的 peer），
 *     并明确提示当前是回退模式。
 *
 * 退出码：0 = 全部符合预期；1 = 存在不符（同时说明是「回归」还是「期望值待更新」）。
 */

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, delimiter } from "node:path";
import { homedir } from "node:os";

const verbose = process.argv.includes("--verbose");
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, "..");

// ── 期望矩阵 ────────────────────────────────────────────────────────────────
// 当前策略：三个插件只承诺 0.2.0 线（>=0.2.0-rc.1 <0.2.1-0）。
// 收窄或放宽支持面时，**必须同步修改这里**，否则本脚本会报出「回归」。
const EXPECTED = {
  // 同三元组：实测 rc.1 ⇒ rc.2 / 后续 rc / 正式版全部放行
  pass: [
    "0.2.0-rc.1", // 实测版本（下界）
    "0.2.0-rc.2", // 实测版本
    "0.2.0-rc.3", // 未实测但同三元组 ⇒ 自动放行（这正是三元组区间的价值）
    "0.2.0-rc.9",
    "0.2.0", // 正式版
  ],
  // 跨三元组 / 已收窄的旧线：必须拦截
  block: [
    "0.2.1-rc.1", // 下一个 patch 的预发布 —— `-0` 上界存在的唯一理由
    "0.3.0-rc.1",
    "0.1.7-rc.1", // 2026-09-30 起不再声明 0.1.7 线（需要请装旧版）
    "0.1.7-rc.2",
    "0.1.7-alpha.1",
    "0.1.8-rc.1",
    "0.1.6-alpha.1",
  ],
};

const PLUGINS = [
  ["dsh-connector", "@omdp/dsh-connector"],
  ["dsh-archived-sessions", "@omdp/dsh-archived-sessions"],
  ["dsh-key-fallback", "@omdp/dsh-key-fallback"],
];

// ── 选取判定模式 ────────────────────────────────────────────────────────────
// 解析顺序：① 本脚本所在目录（scripts/node_modules）② 仓库根 ③ 环境里已有的
// 副本（含 DSH 运行时随 pnpm 附带的那份，`~/.dsh/dsh-runtimes/**/pnpm/dist/node_modules`）。
// 目的是**不引入新依赖**也能跑起来。
const requireFrom = [
  createRequire(import.meta.url),
  createRequire(join(repoRoot, "package.json")),
];

function tryResolveFrom(id, roots) {
  for (const req of roots) {
    try {
      return req.resolve(id);
    } catch {
      /* 换下一个 root */
    }
  }
  return null;
}

/** 在候选目录里找一个可 require 的包（返回入口文件绝对路径） */
function scanCandidates(pkgName, dirs) {
  for (const d of dirs) {
    const pj = join(d, pkgName, "package.json");
    if (existsSync(pj)) {
      try {
        const p = JSON.parse(readFileSync(pj, "utf8"));
        const entry = p.exports?.["."] ?? p.main ?? "index.js";
        const entryPath =
          typeof entry === "string" ? entry : (entry?.require ?? entry?.import ?? "index.js");
        const abs = join(d, pkgName, entryPath);
        if (existsSync(abs)) return abs;
      } catch {
        /* 损坏的副本，跳过 */
      }
    }
  }
  return null;
}

// ① / ② 常规 node 解析
let bootPath = tryResolveFrom("@deepseek-ai/dsh-app-boot", requireFrom);
let semverPath = tryResolveFrom("semver", requireFrom);

// ③ 兜底：DSH 运行时 / 常见全局位置
if (!bootPath || !semverPath) {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const scanDirs = [];
  const runtimeRoot = join(dshHome, "dsh-runtimes");
  if (existsSync(runtimeRoot)) {
    // 深度有限：dsh-runtimes/<runtime>/dependencies/pnpm/dist/node_modules
    for (const rt of [
      join(runtimeRoot, "dsh-primary-runtime", "dependencies", "pnpm", "dist", "node_modules"),
    ]) {
      if (existsSync(rt)) scanDirs.push(rt);
    }
  }
  for (const d of (process.env.NODE_PATH ?? "").split(delimiter).filter(Boolean)) scanDirs.push(d);

  if (!semverPath) semverPath = scanCandidates("semver", scanDirs);
  if (!bootPath) bootPath = scanCandidates("@deepseek-ai/dsh-app-boot", scanDirs);
}

let gateFn = null;
let semverMod = null;

if (bootPath) {
  try {
    const mod = await import(pathToFileURL(bootPath).href);
    if (typeof mod.evaluatePluginCompatibility === "function") gateFn = mod.evaluatePluginCompatibility;
  } catch {
    /* 入口不是 ESM 或依赖缺失 —— 走回退模式 */
  }
}
let semverFrom = null;
if (semverPath) {
  try {
    const mod = await import(pathToFileURL(semverPath).href);
    semverMod = mod.default ?? mod;
    semverFrom = semverPath;
  } catch {
    semverMod = null;
  }
}

const isDshPeer = (name) => name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-");

/** 回退实现：与 dsh-app-boot 中 evaluatePluginCompatibility 的谓词保持一致。
 *  签名刻意与真函数对齐 `(manifest, exemptions, runtimeVersion)`，避免调用点分叉。 */
function fallbackGate(manifest, _exemptions, runtime) {
  const peers = manifest.peerDependencies;
  if (!peers) return undefined; // 零 peer ⇒ 永不检查
  const bad = {};
  for (const [name, range] of Object.entries(peers)) {
    if (!isDshPeer(name)) continue; // cordis / schemastery 不进门禁
    if (range.trim() === "" || !semverMod.satisfies(runtime, range, { includePrerelease: true }))
      bad[name] = range;
  }
  return Object.keys(bad).length ? bad : undefined;
}

const gate = gateFn ?? fallbackGate;

console.log(`\n判定模式：${gateFn ? "真门禁函数（@deepseek-ai/dsh-app-boot）" : "semver 回退谓词"}`);
if (!gateFn && !semverMod) {
  console.error("✗ 既没有 @deepseek-ai/dsh-app-boot 也没有 semver，无法校验。");
  console.error("  先安装其中之一（如 `npm i -D semver`）再跑本脚本。");
  process.exit(1);
}
if (!gateFn) {
  console.log(`  semver 来源：${semverFrom ?? "(未知)"}`);
  console.log("  ⚠️ 回退模式等价于真门禁的判定谓词，但请在关键发版前用真函数复核一次。");
}

// ── 逐插件校验 ──────────────────────────────────────────────────────────────
let mismatches = 0;
const details = [];

for (const [dir, pkgName] of PLUGINS) {
  const manifestPath = join(repoRoot, dir, "package.json");
  if (!existsSync(manifestPath)) {
    console.log(`\n⚠️ 跳过 ${pkgName}：找不到 ${manifestPath}`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dshPeer = manifest.peerDependencies?.["@deepseek-ai/dsh"] ?? "(未声明)";

  console.log(`\n### ${pkgName}@${manifest.version}`);
  console.log(`    @deepseek-ai/dsh = ${dshPeer}`);

  if (!verbose) {
    // 简表：只报不符项
    const bad = [];
    for (const [runtime, want] of [
      ...EXPECTED.pass.map((r) => [r, true]),
      ...EXPECTED.block.map((r) => [r, false]),
    ]) {
      const pass = gate(manifest, {}, runtime) === undefined;
      if (pass !== want) {
        mismatches++;
        bad.push(`      · ${runtime} 期望 ${want ? "放行" : "拦截"}，实际 ${pass ? "放行" : "拦截"}`);
      }
    }
    console.log(bad.length === 0 ? `    ✅ ${EXPECTED.pass.length + EXPECTED.block.length} 项判定全部符合预期` : bad.join("\n"));
    continue;
  }

  for (const [runtime, want] of [
    ...EXPECTED.pass.map((r) => [r, true]),
    ...EXPECTED.block.map((r) => [r, false]),
  ]) {
    const pass = gate(manifest, {}, runtime) === undefined;
    const ok = pass === want;
    if (!ok) mismatches++;
    console.log(`    ${ok ? "OK  " : "FAIL"} ${pass ? "PASS " : "BLOCK"} @ ${runtime}`);
  }
}

// ── 结论 ───────────────────────────────────────────────────────────────────
console.log("");
if (mismatches === 0) {
  console.log("✅ 全部符合预期。");
  process.exit(0);
}

console.log(`❌ ${mismatches} 项与预期不符。`);
console.log("");
console.log("两种可能，请自行判定属于哪一种：");
console.log("  A. **回归**：声明写错了（最常见：上界漏写 `-0`）。");
console.log("     自检：`semver.satisfies(\"0.2.1-rc.1\", \"<0.2.1\", { includePrerelease: true })` 是 true，");
console.log("     所以 `<0.2.1` 会把下一个三元组的 rc 漏放行 —— 应写 `<0.2.1-0`。");
console.log("  B. **有意的支持面变更**：那就同步更新本脚本顶部的 EXPECTED 矩阵。");
process.exit(1);
