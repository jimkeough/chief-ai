import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeVercelBase,
  normalizePaths,
  formatRouteChecks,
} from "../lib/vercel-checks.ts";

// --- normalizeVercelBase ----------------------------------------------------
test("normalizeVercelBase accepts an https *.vercel.app origin", () => {
  const r = normalizeVercelBase("https://my-app-git-branch-team.vercel.app/tasks?x=1");
  assert.deepEqual(r, { origin: "https://my-app-git-branch-team.vercel.app" });
});

test("normalizeVercelBase rejects non-https", () => {
  const r = normalizeVercelBase("http://my-app.vercel.app");
  assert.ok("error" in r && /https/.test(r.error));
});

test("normalizeVercelBase rejects non-vercel hosts (SSRF guard)", () => {
  for (const bad of [
    "https://localhost:3000",
    "https://169.254.169.254/latest/meta-data",
    "https://evil.com",
    "https://vercel.app.evil.com",
  ]) {
    const r = normalizeVercelBase(bad);
    assert.ok("error" in r, `expected error for ${bad}`);
  }
});

test("normalizeVercelBase rejects bare vercel.app", () => {
  const r = normalizeVercelBase("https://vercel.app");
  assert.ok("error" in r);
});

test("normalizeVercelBase rejects garbage", () => {
  const r = normalizeVercelBase("not a url");
  assert.ok("error" in r);
});

// --- normalizePaths ---------------------------------------------------------
test("normalizePaths defaults to root", () => {
  assert.deepEqual(normalizePaths(undefined), ["/"]);
  assert.deepEqual(normalizePaths([]), ["/"]);
  assert.deepEqual(normalizePaths("nope"), ["/"]);
});

test("normalizePaths adds leading slash, trims, drops blanks, de-dups", () => {
  assert.deepEqual(normalizePaths(["tasks", "/tasks", "  /notes  ", ""]), [
    "/tasks",
    "/notes",
  ]);
});

test("normalizePaths caps at 10", () => {
  const many = Array.from({ length: 25 }, (_, i) => `/p${i}`);
  assert.equal(normalizePaths(many).length, 10);
});

// --- formatRouteChecks ------------------------------------------------------
test("formatRouteChecks renders ok, redirect, and error rows", () => {
  const out = formatRouteChecks("https://x.vercel.app", [
    {
      path: "/",
      url: "https://x.vercel.app/",
      status: 200,
      ok: true,
      redirected: false,
      ttfbMs: 120,
      totalMs: 140,
      bytes: 2048,
      truncated: false,
      error: null,
    },
    {
      path: "/tasks",
      url: "https://x.vercel.app/tasks",
      status: 307,
      ok: false,
      redirected: true,
      ttfbMs: 90,
      totalMs: 95,
      bytes: 0,
      truncated: false,
      error: null,
    },
    {
      path: "/boom",
      url: "https://x.vercel.app/boom",
      status: null,
      ok: false,
      redirected: false,
      ttfbMs: null,
      totalMs: null,
      bytes: null,
      truncated: false,
      error: "timed out after 12000 ms",
    },
  ]);
  assert.match(out, /Route checks on https:\/\/x\.vercel\.app/);
  assert.match(out, /✓ \/ — 200 · TTFB 120ms · total 140ms · 2KB/);
  assert.match(out, /✗ \/tasks — 307 \(redirected\)/);
  assert.match(out, /✗ \/boom — timed out after 12000 ms/);
});
