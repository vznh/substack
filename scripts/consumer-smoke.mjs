import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "substack-consumer-"));
let tarball;

try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--silent"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: join(temp, "npm-cache") },
  }))[0].filename;
  tarball = join(root, packed);

  const packageDir = join(temp, "node_modules", "@vznh", "substack");
  await mkdir(packageDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", packageDir, "--strip-components=1"]);

  // Keep the consumer isolated while avoiding a registry dependency in CI.
  // These are copied from the repository install, never imported from source.
  for (const dependency of [
    "zod",
    "fetch-cookie",
    "tough-cookie",
    "set-cookie-parser",
    "tldts",
    "tldts-core",
    "typescript",
    "@types/node",
    "undici-types",
  ]) {
    await cp(join(root, "node_modules", dependency), join(temp, "node_modules", dependency), { recursive: true });
  }

  await writeFile(join(temp, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(temp, "consumer.mjs"), `
    import assert from "node:assert/strict";
    import { Post, Newsletter, substack } from "@vznh/substack";
    if (typeof Post !== "function" || typeof Newsletter !== "function") throw new Error("public classes missing");
    if (substack.Post !== Post || substack.Newsletter !== Newsletter) throw new Error("static facade mismatch");
    const newsletter = substack.newsletter("example.substack.com");
    if (newsletter.get_base_url() !== "https://example.substack.com") throw new Error("URL normalization failed");
    globalThis.fetch = async () => Response.json({
      id: 1, slug: "hello", title: "Hello", canonical_url: "https://example.substack.com/p/hello",
      publication_id: 2, body_html: "<p>hello</p>", audience: "everyone"
    });
    const post = substack.post("https://example.substack.com/p/hello");
    assert.equal(await post.get_content(), "<p>hello</p>");
    console.log("packed consumer import and mocked content call passed");
  `);
  await writeFile(join(temp, "consumer.ts"), `
    import { Post, substack } from "@vznh/substack";
    const post: Post = substack.post("https://example.substack.com/p/hello");
    const title: Promise<string> = post.get_title();
    void title;
  `);
  await writeFile(join(temp, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      lib: ["ES2022"], target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
      types: ["node"], strict: true, skipLibCheck: true, noEmit: true,
    },
    include: ["consumer.ts"],
  }, null, 2));
  execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: temp, stdio: "inherit" });
  execFileSync(process.execPath, [join(temp, "consumer.mjs")], { cwd: temp, stdio: "inherit" });
} finally {
  if (tarball) await rm(tarball, { force: true });
  await rm(temp, { recursive: true, force: true });
}
