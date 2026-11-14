import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { zipSync, unzipSync } = require("../vendor/Vencord/node_modules/fflate");
const root = new URL("../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("plugin/discordTickets/catalog.json", root), "utf8"));
if (catalog.templates?.length !== 0) throw Error("Privacy gate: public source must not contain personal templates.");
const files = {};
async function add(path) {
    const url = new URL(path, root);
    const entries = await readdir(url, { withFileTypes: true }).catch(() => null);
    if (!entries) { files[path] = new Uint8Array(await readFile(url)); return; }
    for (const entry of entries) await add(`${path}/${entry.name}`);
}
// Public corresponding source contains only the released implementation and its
// build inputs. Research, private development tools and account data stay out.
for (const path of ["plugin", "installer", "release.json", "BUILDING.md", "Build.ps1", "Build-Installer.ps1", "LICENSE", ".gitignore", "scripts/check-bootstrap.mjs", "scripts/package.mjs", "scripts/build-installer.mjs"]) await add(path);
files["README.md"] = new Uint8Array(await readFile(new URL("PUBLIC-README.md", root)).catch(() => readFile(new URL("README.md", root))));
files[".gitignore"] = new TextEncoder().encode("vendor/\ndist/\nnode_modules/\n");
const archive = zipSync(files, { level: 9 });
if (Object.keys(files).some(name => /cybershoke/i.test(name))) throw Error("Public filenames must use neutral names.");
const extracted = unzipSync(archive);
for (const [name, value] of Object.entries(files)) {
    if (!Buffer.from(value).equals(Buffer.from(extracted[name]))) throw Error("Archive verification failed: " + name);
}
await mkdir(new URL("dist/", root), { recursive: true });
const name = "Discord-Tickets-source.zip";
await writeFile(new URL(`dist/${name}`, root), archive);
await writeFile(new URL(`dist/${name}.sha256`, root), createHash("sha256").update(archive).digest("hex") + "  " + name + "\n");
console.log(`Verified archive: ${Object.keys(files).length} files, ${archive.length} bytes; no vendor, research, account data or message history.`);
