import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as tar from "tar";
import { ProxyAgent } from "undici";
import type { ResolvedTarget, ScannedFile, TextFile } from "./types.js";
import { isPathExcluded } from "./policy.js";
import { isProbablyText, pathExists, toPosixPath } from "./utils.js";

const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "__pycache__"
]);

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const GITHUB_FETCH_TIMEOUT_MS = 30000;
const GITHUB_FILE_FETCH_TIMEOUT_MS = 15000;
const GITHUB_DOWNLOAD_CONCURRENCY = 8;
const GITHUB_SPARSE_MAX_FILES = 3000;
const GITHUB_SPARSE_MAX_BYTES = 20 * 1024 * 1024;
const GITHUB_SPARSE_MAX_SINGLE_FILE_BYTES = 1024 * 1024;
let proxyDispatcherPromise: Promise<ProxyAgent | undefined> | undefined;

export async function resolveTarget(target: string, keepTemp = false): Promise<ResolvedTarget> {
  const githubRepo = parseGitHubUrl(target);
  if (githubRepo) {
    const tempRoot = path.join(os.tmpdir(), `skill-preflight-${randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });

    const failures: string[] = [];

    try {
      await downloadGitHubSkillFiles(githubRepo, tempRoot);
    } catch (sparseError) {
      failures.push(`GitHub API sparse download failed: ${formatToolError(sparseError)}`);

      await removeTempPath(tempRoot);
      await mkdir(tempRoot, { recursive: true });

      try {
        await downloadGitHubTarball(githubRepo, tempRoot);
      } catch (tarballError) {
        failures.push(`Tarball download failed: ${formatToolError(tarballError)}`);

        await removeTempPath(tempRoot);

        try {
          await cloneGitRepository(
            `https://github.com/${githubRepo.owner}/${githubRepo.repo}.git`,
            githubRepo.ref,
            tempRoot
          );
        } catch (gitError) {
          failures.push(`git clone fallback failed: ${formatToolError(gitError)}`);
          await removeTempPath(tempRoot).catch(() => undefined);
          throw new Error(
            [
              `Could not load GitHub repository: ${target}`,
              ...failures,
              "Check the repository URL, GitHub access, network proxy settings, or try scanning a local checkout."
            ].join("\n")
          );
        }
      }
    }

    const localPath = githubRepo.subpath ? resolveInside(tempRoot, githubRepo.subpath) : tempRoot;
    if (!(await pathExists(localPath))) {
      await removeTempPath(tempRoot).catch(() => undefined);
      const refLabel = githubRepo.ref ? ` at ref ${githubRepo.ref}` : "";
      throw new Error(`GitHub path not found${refLabel}: ${githubRepo.subpath}`);
    }

    return {
      displayTarget: target,
      localPath,
      cleanup: keepTemp
        ? undefined
        : async () => {
            await removeTempPath(tempRoot).catch(() => undefined);
          }
    };
  }

  const localPath = path.resolve(target);
  if (!(await pathExists(localPath))) {
    throw new Error(`Target does not exist: ${target}`);
  }

  return {
    displayTarget: target,
    localPath
  };
}

export async function cloneGitRepository(
  repositoryUrl: string,
  ref: string | undefined,
  destination: string
): Promise<void> {
  const options = {
    timeout: 120000,
    windowsHide: true
  };

  if (ref && /^[0-9a-f]{40}$/i.test(ref)) {
    await execFileAsync("git", ["init", "--quiet", destination], options);
    await execFileAsync("git", ["-C", destination, "remote", "add", "origin", repositoryUrl], options);
    await execFileAsync("git", ["-C", destination, "fetch", "--depth", "1", "--no-tags", "origin", ref], options);
    await execFileAsync("git", ["-C", destination, "checkout", "--quiet", "--detach", "FETCH_HEAD"], options);
    return;
  }

  const cloneArgs = ["clone", "--depth", "1"];
  if (ref) {
    cloneArgs.push("--branch", ref, "--single-branch");
  }
  cloneArgs.push(repositoryUrl, destination);
  await execFileAsync("git", cloneArgs, options);
}

export function isGitHubUrl(value: string): boolean {
  return Boolean(parseGitHubUrl(value));
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
}

export function parseGitHubUrl(value: string): GitHubRepoRef | undefined {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    return undefined;
  }

  const rawSegments = url.pathname.split("/").filter(Boolean);
  const segments = rawSegments.map(decodeGitHubSegment);
  if (segments.some((segment) => segment === undefined)) {
    return undefined;
  }

  const [owner, rawRepo, mode, ...remaining] = segments as string[];
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo) {
    return undefined;
  }

  if (!mode) {
    return { owner, repo };
  }

  if (mode === "tree" && remaining.length >= 1) {
    const [ref, ...pathSegments] = remaining;
    const subpath = pathSegments.join("/") || undefined;
    return { owner, repo, ref, subpath };
  }

  if (mode === "blob" && remaining.length >= 2) {
    const [ref, ...pathSegments] = remaining;
    const filePath = pathSegments.join("/");
    if (basenamePosix(filePath).toLowerCase() !== "skill.md") {
      return undefined;
    }

    return {
      owner,
      repo,
      ref,
      subpath: dirnamePosix(filePath) || undefined
    };
  }

  return undefined;
}

export async function discoverSkillRoots(rootPath: string, exclude: string[] = []): Promise<string[]> {
  const roots: string[] = [];
  await walk(rootPath, async (filePath) => {
    if (path.basename(filePath).toLowerCase() === "skill.md") {
      roots.push(path.dirname(filePath));
    }
  }, { basePath: rootPath, exclude, followDirectorySymlinks: true });

  return [...new Set(roots)].sort();
}

export interface ReadSkillFilesOptions {
  basePath?: string;
  exclude?: string[];
}

export async function readSkillFiles(rootPath: string, options: ReadSkillFilesOptions = {}): Promise<{
  files: ScannedFile[];
  textFiles: TextFile[];
}> {
  const files: ScannedFile[] = [];
  const textFiles: TextFile[] = [];

  await walk(rootPath, async (absolutePath) => {
    const relativePath = toPosixPath(path.relative(rootPath, absolutePath));
    let metadata;

    try {
      metadata = await stat(absolutePath);
    } catch (error) {
      files.push({
        path: relativePath,
        absolutePath,
        bytes: 0,
        isText: false,
        readError: filesystemErrorCode(error)
      });
      return;
    }

    if (metadata.size > MAX_TEXT_FILE_BYTES) {
      files.push({
        path: relativePath,
        absolutePath,
        bytes: metadata.size,
        isText: false
      });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch (error) {
      files.push({
        path: relativePath,
        absolutePath,
        bytes: metadata.size,
        isText: false,
        readError: filesystemErrorCode(error)
      });
      return;
    }
    const isText = isProbablyText(buffer);

    files.push({
      path: relativePath,
      absolutePath,
      bytes: metadata.size,
      isText
    });

    if (isText) {
      const content = buffer.toString("utf8");
      textFiles.push({
        path: relativePath,
        absolutePath,
        bytes: buffer.length,
        content,
        lines: content.split(/\r?\n/)
      });
    }
  }, {
    basePath: options.basePath ?? rootPath,
    exclude: options.exclude ?? []
  });

  return { files, textFiles };
}

interface WalkOptions {
  basePath: string;
  exclude: string[];
  followDirectorySymlinks?: boolean;
}

async function walk(
  rootPath: string,
  onFile: (filePath: string) => Promise<void>,
  options: WalkOptions = { basePath: rootPath, exclude: [] },
  visitedDirectories = new Set<string>()
): Promise<void> {
  const directoryIdentity = await realpath(rootPath).catch(() => path.resolve(rootPath));
  if (visitedDirectories.has(directoryIdentity)) {
    return;
  }
  visitedDirectories.add(directoryIdentity);

  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    const relativePath = toPosixPath(path.relative(options.basePath, absolutePath));

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && !isPathExcluded(relativePath, options.exclude, true)) {
        await walk(absolutePath, onFile, options, visitedDirectories);
      }
      continue;
    }

    if (entry.isFile() && !isPathExcluded(relativePath, options.exclude)) {
      await onFile(absolutePath);
      continue;
    }

    if (entry.isSymbolicLink() && options.followDirectorySymlinks) {
      const linkedMetadata = await stat(absolutePath).catch(() => undefined);
      if (!linkedMetadata) {
        continue;
      }

      if (
        linkedMetadata.isDirectory() &&
        !IGNORED_DIRS.has(entry.name) &&
        !isPathExcluded(relativePath, options.exclude, true)
      ) {
        const linkedSkillFile = await stat(path.join(absolutePath, "SKILL.md")).catch(() => undefined);
        if (!linkedSkillFile?.isFile()) {
          continue;
        }

        await walk(
          absolutePath,
          onFile,
          { ...options, followDirectorySymlinks: false },
          visitedDirectories
        );
      } else if (linkedMetadata.isFile() && !isPathExcluded(relativePath, options.exclude)) {
        await onFile(absolutePath);
      }
    }
  }
}

export function commonInstalledSkillDirs(home = os.homedir(), cwd = process.cwd()): string[] {
  const clientDirectories = [".agents", ".codex", ".claude", ".cursor", ".gemini"];
  const candidates = [home, cwd].flatMap((basePath) =>
    clientDirectories.map((clientDirectory) => path.join(basePath, clientDirectory, "skills"))
  );

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

interface GitHubTreeEntry {
  path: string;
  type: string;
  size?: number;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[];
  truncated?: boolean;
}

async function downloadGitHubSkillFiles(repoRef: GitHubRepoRef, destination: string): Promise<void> {
  const ref = repoRef.ref ?? "HEAD";
  const treeUrl = `https://api.github.com/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(
    repoRef.repo
  )}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const treeResponse = await fetchJson<GitHubTreeResponse>(treeUrl, GITHUB_FETCH_TIMEOUT_MS);
  const entries = treeResponse.tree;

  if (!Array.isArray(entries)) {
    throw new Error("GitHub API response did not include a repository tree.");
  }

  const scopedEntries = repoRef.subpath
    ? entries.filter((entry) => isWithinRepoPath(entry.path, repoRef.subpath as string))
    : entries;

  if (repoRef.subpath && scopedEntries.length === 0) {
    throw new Error(`GitHub path not found at ref ${ref}: ${repoRef.subpath}`);
  }

  if (repoRef.subpath) {
    await mkdir(resolveInside(destination, repoRef.subpath), { recursive: true });
  }

  const blobEntries = scopedEntries.filter((entry) => entry.type === "blob" && entry.path);
  const skillRoots = new Set(
    blobEntries
      .filter((entry) => basenamePosix(entry.path).toLowerCase() === "skill.md")
      .map((entry) => dirnamePosix(entry.path))
  );

  if (treeResponse.truncated && skillRoots.size === 0) {
    throw new Error("GitHub API tree response was truncated before any SKILL.md files were found.");
  }

  if (skillRoots.size === 0) {
    return;
  }

  const candidates = blobEntries
    .map((entry) => ({
      entry,
      skillRoot: findContainingSkillRoot(entry.path, skillRoots)
    }))
    .filter((candidate): candidate is { entry: GitHubTreeEntry; skillRoot: string } => Boolean(candidate.skillRoot))
    .filter(({ entry }) => !hasIgnoredPathSegment(entry.path))
    .sort((left, right) => downloadPriority(left.entry, left.skillRoot) - downloadPriority(right.entry, right.skillRoot));

  const selected: GitHubTreeEntry[] = [];
  let selectedBytes = 0;

  for (const { entry } of candidates) {
    const isSkillFile = basenamePosix(entry.path).toLowerCase() === "skill.md";
    const size = entry.size ?? 0;

    if (
      !isSkillFile &&
      (selected.length >= GITHUB_SPARSE_MAX_FILES ||
        selectedBytes + size > GITHUB_SPARSE_MAX_BYTES ||
        size > GITHUB_SPARSE_MAX_SINGLE_FILE_BYTES)
    ) {
      continue;
    }

    selected.push(entry);
    selectedBytes += size;
  }

  const downloadedSkillFiles = new Set<string>();
  const skillFileFailures: string[] = [];

  await runWithConcurrency(selected, GITHUB_DOWNLOAD_CONCURRENCY, async (entry) => {
    const fileUrl = `https://raw.githubusercontent.com/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(
      repoRef.repo
    )}/${encodeURIComponent(ref)}/${encodePosixPath(entry.path)}`;
    const isSkillFile = basenamePosix(entry.path).toLowerCase() === "skill.md";

    try {
      const content = await fetchBuffer(fileUrl, GITHUB_FILE_FETCH_TIMEOUT_MS);
      const outputPath = resolveInside(destination, entry.path);

      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content);

      if (isSkillFile) {
        downloadedSkillFiles.add(entry.path);
      }
    } catch (error) {
      if (isSkillFile) {
        skillFileFailures.push(`${entry.path}: ${formatToolError(error)}`);
      }
    }
  });

  if (downloadedSkillFiles.size === 0) {
    throw new Error(
      [
        "GitHub API found SKILL.md files, but none could be downloaded from raw.githubusercontent.com.",
        ...skillFileFailures.slice(0, 5)
      ].join("\n")
    );
  }
}

async function downloadGitHubTarball(repoRef: GitHubRepoRef, destination: string): Promise<void> {
  const ref = repoRef.ref ?? "HEAD";
  const tarballUrl = `https://codeload.github.com/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(
    repoRef.repo
  )}/tar.gz/${encodeURIComponent(ref)}`;
  const archivePath = path.join(os.tmpdir(), `skill-preflight-${randomUUID()}.tar.gz`);

  try {
    const archive = await fetchBuffer(tarballUrl, GITHUB_FETCH_TIMEOUT_MS);
    await writeFile(archivePath, archive);
    await tar.x({
      file: archivePath,
      cwd: destination,
      strip: 1
    });
  } finally {
    await removeTempPath(archivePath).catch(() => undefined);
  }
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  return fetchWithTimeout(url, timeoutMs, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "skill-preflight"
    }
  }, async (response) => (await response.json()) as T);
}

async function fetchBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  return fetchWithTimeout(
    url,
    timeoutMs,
    {
      headers: {
        "User-Agent": "skill-preflight"
      },
      redirect: "follow"
    },
    async (response) => Buffer.from(await response.arrayBuffer())
  );
}

async function fetchWithTimeout<T>(
  url: string,
  timeoutMs: number,
  init: RequestInit,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = await getProxyDispatcher();

  try {
    const requestInit: RequestInit & { dispatcher?: ProxyAgent } = {
      ...init,
      signal: controller.signal
    };

    if (dispatcher) {
      requestInit.dispatcher = dispatcher;
    }

    const response = await fetch(url, requestInit);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await consume(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s fetching ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      await worker(items[index]);
    }
  });

  await Promise.all(workers);
}

function findContainingSkillRoot(filePath: string, skillRoots: Set<string>): string | undefined {
  let current = dirnamePosix(filePath);

  while (true) {
    if (skillRoots.has(current)) {
      return current || ".";
    }

    if (!current) {
      return undefined;
    }

    current = dirnamePosix(current);
  }
}

function downloadPriority(entry: GitHubTreeEntry, skillRoot: string): number {
  const relativePath = relativePosix(skillRoot === "." ? "" : skillRoot, entry.path);
  const basename = basenamePosix(relativePath).toLowerCase();

  if (basename === "skill.md") return 0;
  if (/^readme(\.[a-z0-9]+)?$/i.test(basename) || /^licen[cs]e(\.[a-z0-9]+)?$/i.test(basename)) return 1;
  if (
    /^(package\.json|requirements\.txt|pyproject\.toml|cargo\.toml|go\.mod|gemfile|pipfile)$/i.test(basename)
  ) {
    return 2;
  }
  if (/^(references?|docs?|knowledge|examples?)\//i.test(relativePath)) return 3;
  if (entry.size !== undefined && entry.size > GITHUB_SPARSE_MAX_SINGLE_FILE_BYTES) return 10;
  return 4;
}

function basenamePosix(value: string): string {
  return value.split("/").filter(Boolean).pop() ?? "";
}

function dirnamePosix(value: string): string {
  const parts = value.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function relativePosix(root: string, filePath: string): string {
  return root ? filePath.slice(root.length + 1) : filePath;
}

function hasIgnoredPathSegment(value: string): boolean {
  return value.split("/").some((segment) => IGNORED_DIRS.has(segment));
}

function encodePosixPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function isWithinRepoPath(candidate: string, requestedPath: string): boolean {
  return candidate === requestedPath || candidate.startsWith(`${requestedPath}/`);
}

function decodeGitHubSegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    ) {
      return undefined;
    }

    return decoded;
  } catch {
    return undefined;
  }
}

function resolveInside(rootPath: string, relativePath: string): string {
  const normalized = path.normalize(relativePath.replaceAll("/", path.sep));

  if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Unsafe path from GitHub archive: ${relativePath}`);
  }

  const resolved = path.resolve(rootPath, normalized);
  const root = path.resolve(rootPath);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe path from GitHub archive: ${relativePath}`);
  }

  return resolved;
}

async function removeTempPath(targetPath: string): Promise<void> {
  await rm(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200
  });
}

function filesystemErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "UNKNOWN";
}

function getProxyDispatcher(): Promise<ProxyAgent | undefined> {
  proxyDispatcherPromise ??= resolveProxyUrl()
    .then((proxyUrl) => {
      if (!proxyUrl) {
        return undefined;
      }

      return new ProxyAgent(proxyUrl);
    })
    .catch(() => undefined);

  return proxyDispatcherPromise;
}

async function resolveProxyUrl(): Promise<string | undefined> {
  const envProxy =
    process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;

  if (envProxy) {
    return normalizeProxyUrl(envProxy);
  }

  if (process.platform !== "win32") {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
      {
        timeout: 5000,
        windowsHide: true
      }
    );
    const proxyEnabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(stdout);
    const proxyServer = stdout.match(/ProxyServer\s+REG_SZ\s+(.+)/i)?.[1]?.trim();

    if (!proxyEnabled || !proxyServer) {
      return undefined;
    }

    return parseWindowsProxyServer(proxyServer);
  } catch {
    return undefined;
  }
}

function parseWindowsProxyServer(value: string): string | undefined {
  const entries = value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return undefined;
  }

  const keyed = entries.map((entry) => {
    const separator = entry.indexOf("=");
    return separator >= 0
      ? {
          key: entry.slice(0, separator).toLowerCase(),
          value: entry.slice(separator + 1)
        }
      : {
          key: "",
          value: entry
        };
  });
  const candidate =
    keyed.find((entry) => entry.key === "https")?.value ??
    keyed.find((entry) => entry.key === "http")?.value ??
    keyed.find((entry) => entry.key === "socks")?.value ??
    keyed[0]?.value;

  return candidate ? normalizeProxyUrl(candidate) : undefined;
}

function normalizeProxyUrl(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

function formatToolError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.message];
  const maybeError = error as Error & { stderr?: string; stdout?: string };
  if (maybeError.stderr?.trim()) {
    parts.push(maybeError.stderr.trim());
  }
  if (maybeError.stdout?.trim()) {
    parts.push(maybeError.stdout.trim());
  }

  return parts.join(" | ");
}
