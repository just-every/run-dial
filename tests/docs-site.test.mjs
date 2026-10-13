import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { contract } from "./contract.mjs";

// DOCS-001. The /docs pages are built from the repository's Markdown listed in docs/site.json
// (src/core/features/public-site/docs/build). These checks need no build: they import the modules the Vite plugin runs.
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");
const docs = "src/core/features/public-site/docs";
const { readManifest } = await import("../src/core/features/public-site/docs/build/manifest.ts");
const { absolutePath, buildSite, pathKind, readRepository } = await import("../src/core/features/public-site/docs/build/site.ts");
const { renderPage } = await import("../src/core/features/public-site/docs/build/render.ts");
const { inlineCode } = await import("../src/core/features/public-site/docs/build/inline-code.ts");

const site = buildSite(root);
const repository = readRepository(root).url;

contract("DOCS-001", "docs/site.json is the one list: a home first, clean unique slugs, existing unique sources, reasons", async () => {
  const manifest = readManifest(root);
  assert.equal(manifest.pages[0].slug, "", "the docs home leads");
  assert.ok(manifest.pages.some((page) => page.slug === "install"));
  for (const entry of manifest.githubOnly) assert.ok(entry.reason.length > 10, `${entry.source} says why it stays on GitHub`);

  const fixture = await realpath(await mkdtemp(join(tmpdir(), "dial-docs-manifest-")));
  try {
    await mkdir(join(fixture, "docs"));
    for (const file of ["README.md", "A.md", "B.md"]) await writeFile(join(fixture, file), `# ${file}\n`);
    const page = (slug, source, label = "Label") => ({ slug, source, label });
    const valid = { sections: [{ title: "S", pages: [page("", "README.md"), page("a", "A.md")] }], githubOnly: [{ source: "B.md", reason: "Kept on GitHub" }] };
    const check = async (changed) => {
      await writeFile(join(fixture, "docs/site.json"), JSON.stringify({ ...valid, ...changed }));
      return assert.throws(() => readManifest(fixture));
    };
    await writeFile(join(fixture, "docs/site.json"), JSON.stringify(valid));
    assert.equal(readManifest(fixture).pages.length, 2);
    await check({ sections: [{ title: "S", pages: [page("a", "A.md"), page("", "README.md")] }] });
    await check({ sections: [{ title: "S", pages: [page("", "README.md"), page("index", "A.md")] }] });
    await check({ sections: [{ title: "S", pages: [page("", "README.md"), page("Install", "A.md")] }] });
    await check({ sections: [{ title: "S", pages: [page("", "README.md"), page("a", "MISSING.md")] }] });
    await check({ githubOnly: [{ source: "A.md", reason: "Twice" }] });
    await check({ githubOnly: [{ source: "B.md", reason: " " }] });
    await check({ githubOnly: [{ source: "GONE.md", reason: "Stale" }] });
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

contract("DOCS-001", "every Markdown file at the root or under docs/ is published or listed as GitHub-only", () => {
  const manifest = readManifest(root);
  const listed = new Set([...manifest.pages, ...manifest.githubOnly].map((entry) => entry.source));
  const inScope = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"], { cwd: root, encoding: "utf8" })
    .split("\n").filter((file) => /^([^/]+\.md|docs\/.+\.md)$/.test(file));
  const unlisted = inScope.filter((file) => !listed.has(file));
  assert.deepEqual(unlisted, [], `Add ${unlisted.join(", ")} to docs/site.json, as a published page or under githubOnly with a reason`);
  assert.equal(listed.size, manifest.pages.length + manifest.githubOnly.length, "no source is listed twice");
});

contract("DOCS-001", "every published page builds with no problems, one title, unique ids and only safe, resolvable links", () => {
  assert.deepEqual(site.problems, []);
  assert.equal(site.pages.length, readManifest(root).pages.length);
  const published = new Map(site.pages.map((page) => [page.href, new Set(page.ids)]));
  const kind = pathKind(root);
  for (const page of site.pages) {
    const markdown = readFileSync(join(root, page.source), "utf8");
    assert.equal(page.title, /^# (.+)$/m.exec(markdown)[1].replace(/`/g, ""), `${page.source} title`);
    assert.match(markdown.trimStart(), /^# /, `${page.source} starts with its H1`);
    assert.doesNotMatch(page.html, /<h1\b/, `${page.source} has exactly one H1, rendered by the page component`);
    assert.equal(new Set(page.ids).size, page.ids.length, `${page.source} heading ids are unique`);
    assert.doesNotMatch(page.html, /\s(style|on[a-z]+)=|<script/i, `${page.source} has no inline style, handler or script`);
    assert.doesNotMatch(page.html, new RegExp(absolutePath.source), `${page.source} names no machine path`);
    for (const [, href] of page.html.matchAll(/<a href="([^"]+)"/g)) {
      const decoded = href.replaceAll("&amp;", "&");
      if (decoded.startsWith("/docs")) {
        const [path, hash] = decoded.split("#");
        assert.ok(published.has(path), `${page.source}: ${href} is a published page`);
        if (hash) assert.ok(published.get(path).has(decodeURIComponent(hash)), `${page.source}: ${href} names a heading`);
      } else if (decoded.startsWith("#")) {
        assert.ok(page.ids.includes(decodeURIComponent(decoded.slice(1))), `${page.source}: ${href} names a heading on the page`);
      } else if (decoded.startsWith(`${repository}/`) && !markdown.includes(`](${decoded})`)) {
        // A relative link the build rewrote to GitHub.
        const match = new RegExp(`^${repository}/(blob|tree)/main/([^#]+)`).exec(decoded);
        assert.ok(match, `${page.source}: ${href} is a blob or tree link on main`);
        assert.equal(kind(match[2]), match[1] === "blob" ? "file" : "directory", `${page.source}: ${href} names an existing path`);
      } else assert.match(decoded, /^(https?:|mailto:)/, `${page.source}: ${href} is external`);
    }
  }
});

// A link context for in-memory fixtures: two published pages and a few repository paths.
const fixtureContext = (source = "docs/PAGE.md") => ({
  source,
  repository: { url: repository, branch: "main" },
  published: new Map([["docs/PAGE.md", "/docs/page"], ["docs/OTHER.md", "/docs/other"]]),
  kind: (path) => ({ "docs/PAGE.md": "file", "docs/OTHER.md": "file", "docs/INTERNAL.md": "file", "docs/licenses": "directory", LICENSE: "file", "docs/media/diagram.png": "file" })[path] ?? null,
});
const render = (body) => renderPage(`# Fixture page\n\n${body}\n`, fixtureContext());

// Each problem names what it is about: the offending link or image, in document order.
const reports = (problems, offending) => {
  assert.equal(problems.length, offending.length, `${problems.join("; ")} reports ${offending.length} problems`);
  offending.forEach((pattern, index) => assert.match(problems[index], pattern));
};

contract("DOCS-001", "raw HTML is reported and never rendered, links go to published pages or GitHub or are reported, images come only from docs/media", () => {
  const raw = render("Hello <script>alert(1)</script> <img src=x onerror=alert(1)>");
  assert.doesNotMatch(raw.html, /<script|<img/);
  reports(raw.problems, [/^raw HTML <script>/, /^raw HTML <\/script>/, /^raw HTML <img /]);
  reports(render("<div>\nblock html\n</div>").problems, [/^raw HTML <div>/]);
  reports(render("- an item with <b>bold</b> markup").problems, [/^raw HTML <b>/, /^raw HTML <\/b>/]);
  const links = render("[other](OTHER.md#part) [internal](INTERNAL.md) [licences](licenses) [site](https://example.com/a?b=c)");
  assert.deepEqual(links.problems, []);
  assert.deepEqual([...links.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]), [
    "/docs/other#part", `${repository}/blob/main/docs/INTERNAL.md`, `${repository}/tree/main/docs/licenses`, "https://example.com/a?b=c",
  ]);
  reports(render("[gone](MISSING.md) [up](../../outside.md) [js](javascript:alert(1)) [rooted](/docs/x)").problems, [
    /^MISSING\.md /, /^\.\.\/\.\.\/outside\.md /, /^javascript:alert\(1\) /, /^\/docs\/x /,
  ]);
  const good = render("![A diagram](media/diagram.png)");
  assert.deepEqual([good.problems, good.images], [[], ["docs/media/diagram.png"]]);
  reports(render("![Outside](../LICENSE) ![External](https://example.com/a.png) ![](media/diagram.png)").problems, [
    /^\.\.\/LICENSE /, /^https:\/\/example\.com\/a\.png /, /^media\/diagram\.png /,
  ]);
  reports(renderPage("# One\n\n# Two\n", fixtureContext()).problems, [/H1/]);
});

contract("DOCS-001", "broken links and anchors across pages fail the site build, naming the file and the link", async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), "dial-docs-site-")));
  try {
    await mkdir(join(fixture, "docs"));
    await writeFile(join(fixture, "package.json"), JSON.stringify({ repository: { url: `${repository}.git` } }));
    await writeFile(join(fixture, "docs/site.json"), JSON.stringify({ sections: [{ title: "S", pages: [{ slug: "", source: "README.md", label: "Home" }, { slug: "guide", source: "docs/GUIDE.md", label: "Guide" }] }], githubOnly: [{ source: "NOTES.md", reason: "Maintainer notes" }] }));
    await writeFile(join(fixture, "README.md"), "# Home\n\n[guide](docs/GUIDE.md#second) [bad](docs/GUIDE.md#third) [notes](NOTES.md#kept) [gone](NOTES.md#lost) [missing](docs/MISSING.md)\n");
    await writeFile(join(fixture, "docs/GUIDE.md"), "# Guide\n\n## Second\n");
    await writeFile(join(fixture, "NOTES.md"), "# Notes\n\n## Kept\n");
    const built = buildSite(fixture);
    assert.equal(built.repository.url, repository);
    reports(built.problems, [/^README\.md: docs\/MISSING\.md /, /^README\.md: #third .*docs\/GUIDE\.md/, /^README\.md: #lost .*NOTES\.md/]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

contract("DOCS-001", "inline code keeps a short host whole and lets a long host wrap, never leaving a scheme alone", () => {
  const pieces = (code) => [...renderToStaticMarkup(inlineCode(code)).matchAll(/<span>([^<]*)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(pieces("http://127.0.0.1:8787"), ["http://127.0.0.1:8787"]);
  const long = pieces("https://dial-production.<your-subdomain>.workers.dev/api/x");
  assert.ok(long.length > 2, "a long host breaks at its dots");
  assert.ok(long.every((piece) => !/^[a-z]+:\/\/$/i.test(piece)), "a scheme is never a piece of its own");
});

contract("DOCS-001", "the Markdown libraries stay development dependencies and out of the app, and the manifest declares the public paths", async () => {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src", "scripts", "tests", "vite.config.ts"], { cwd: root, encoding: "utf8" })
    .split("\n").filter((file) => /\.(m?[jt]sx?|cjs)$/.test(file) && !file.startsWith(`${docs}/build/`) && file !== "vite.config.ts" && file !== "tests/docs-site.test.mjs");
  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(source, /from\s+["'][^"']*docs\/build\b|import\(\s*["'][^"']*docs\/build\b/, `${file} must not import the docs build modules (they read the file system)`);
    assert.doesNotMatch(source, /["'](?:react-markdown|remark-gfm|highlight\.js)(?:\/|["'])/, `${file} must not import a Markdown library`);
  }
  const manifest = JSON.parse(await read("package.json"));
  for (const name of ["react-markdown", "remark-gfm", "highlight.js"]) {
    assert.ok(manifest.devDependencies[name], `${name} is a build-time dependency`);
    assert.equal(manifest.dependencies?.[name], undefined, `${name} is not a runtime dependency`);
  }
  const seed = JSON.parse(await read("seed.json"));
  assert.ok(seed.deploy.publicPaths.includes("/docs") && seed.deploy.publicPaths.includes("/docs/"));
  assert.ok(seed.capabilities.some((capability) => capability.clauses.includes("DOCS-001")));
});
