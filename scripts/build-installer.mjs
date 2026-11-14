import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { zipSync, unzipSync } = require("../vendor/Vencord/node_modules/fflate");
const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await readFile(new URL("../release.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../plugin/discordTickets/catalog.json", import.meta.url), "utf8"));
if (catalog.templates?.length !== 0) throw Error("Privacy gate: personal templates must never be bundled in the public installer.");
if (!/^\d+\.\d+\.\d+$/.test(config.version) || !/^[\w.-]+\/[\w.-]+$/.test(config.repository)) throw Error("Invalid release configuration");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const files = {};
async function add(source, destination = source, bom = false) {
    let bytes = await readFile(new URL("../" + source, import.meta.url));
    if (bom) bytes = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(bytes.toString("utf8").replace(/^\uFEFF/, ""), "utf8")]);
    files[destination] = new Uint8Array(bytes);
}
for (const name of ["patcher.js", "preload.js", "renderer.js", "renderer.css", "patcher.js.LEGAL.txt", "renderer.js.LEGAL.txt"])
    await add("vendor/Vencord/dist/" + name, "dist/" + name);
const renderer = Buffer.from(files["dist/renderer.js"]).toString();
if (renderer.includes('"Tracer"')) throw Error("Public installers require a production Vencord build without --dev.");
if (!renderer.includes("CSDT_PUBLIC_EMPTY_CATALOG_V1")) throw Error("Privacy gate: compiled renderer predates the empty-catalog policy. Rebuild Vencord first.");
const compiledCatalog = JSON.parse(await readFile(new URL("../vendor/Vencord/src/userplugins/discordTickets/catalog.json", import.meta.url), "utf8"));
if (compiledCatalog.templates?.length !== 0) throw Error("Privacy gate: copied Vencord sources contain personal templates.");
if (!renderer.includes("CYBERSHOKE Discord Tickets") || !renderer.includes("Updater Disabled: true")) throw Error("Build with --disable-updater first: this prevents replacing our custom build with upstream.");
await add("vendor/Vencord/dist/Installer/VencordInstallerCli.exe", "tools/VencordInstallerCli.exe");
if (hash(files["tools/VencordInstallerCli.exe"]) !== config.installerSha256) throw Error("Official Installer SHA256 does not match release.json");
for (const name of ["Install.ps1", "Engine.ps1"]) await add("installer/" + name, name, true);
for (const name of ["LICENSE", "BUILDING.md"]) await add(name);
files["README.md"] = new Uint8Array(await readFile(new URL("../PUBLIC-README.md", import.meta.url)).catch(() => readFile(new URL("../README.md", import.meta.url))));
await add("dist/Discord-Tickets-source.zip", "source/Discord-Tickets-source.zip");
for (const project of ["Vencord", "Installer"]) {
    const ref = project === "Vencord" ? config.vencordCommit : config.installerTag;
    const revision = execFileSync("git", ["rev-parse", ref + "^{commit}"], { cwd: root + "vendor/" + project, encoding: "utf8" }).trim();
    files["source/" + project + "-upstream.zip"] = new Uint8Array(execFileSync("git", ["archive", "--format=zip", ref], { cwd: root + "vendor/" + project, maxBuffer: 32 * 1024 * 1024 }));
    files["source/" + project + "-revision.txt"] = new TextEncoder().encode(revision + "\nhttps://github.com/" + (project === "Vencord" ? "Vendicated/Vencord" : "Vencord/Installer") + "/tree/" + revision + "\n");
}
files["package.json"] = new TextEncoder().encode("{}\n");
const checksums = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]));
const releaseId = config.version + "-" + hash(JSON.stringify(checksums)).slice(0, 12);
files["bundle.json"] = new TextEncoder().encode(JSON.stringify({ format: 1, version: config.version, releaseId, repository: config.repository, files: checksums }, null, 2));
const archive = zipSync(files, { level: 9 });
const extracted = unzipSync(archive);
for (const [name, bytes] of Object.entries(files)) if (!Buffer.from(bytes).equals(Buffer.from(extracted[name]))) throw Error("Payload round-trip failed: " + name);
const payloadDir = new URL("../dist/installer-build/", import.meta.url);
await mkdir(payloadDir, { recursive: true });
await writeFile(new URL("payload.zip", payloadDir), archive);
const code = (await readFile(new URL("../installer/Launcher.cs", import.meta.url), "utf8"))
    .replaceAll("@VERSION@", config.version).replaceAll("@REPOSITORY@", config.repository).replaceAll("@PAYLOAD_HASH@", hash(archive));
await writeFile(new URL("Launcher.cs", payloadDir), code);
const output = fileURLToPath(new URL("../dist/Discord-Tickets-Setup.exe", import.meta.url));
const compiler = process.env.CSDT_CSC || (process.env.WINDIR + "\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe");
execFileSync(compiler, ["/nologo", "/target:exe", "/platform:anycpu", "/optimize+", "/utf8output", "/out:" + output,
    "/r:System.IO.Compression.dll", "/r:System.IO.Compression.FileSystem.dll", "/r:System.Windows.Forms.dll", "/r:System.Web.Extensions.dll",
    "/resource:" + fileURLToPath(new URL("payload.zip", payloadDir)) + ",payload.zip", fileURLToPath(new URL("Launcher.cs", payloadDir)), fileURLToPath(new URL("../installer/DiscordStart.cs", import.meta.url))], { stdio: "inherit" });
const sha256 = hash(await readFile(output));
await writeFile(new URL("../dist/latest.json", import.meta.url), JSON.stringify({ format: 1, version: config.version, url: "https://github.com/" + config.repository + "/releases/download/v" + config.version + "/Discord-Tickets-Setup.exe", sha256 }, null, 2) + "\n");
await writeFile(output + ".sha256", sha256 + "  Discord-Tickets-Setup.exe\n");
execFileSync(output, ["--verify"], { stdio: "inherit" });
execFileSync(output, ["--self-test"], { stdio: "inherit" });
console.log("Verified single-file installer: " + releaseId + ", " + (await readFile(output)).length + " bytes. Discord was not modified.");
