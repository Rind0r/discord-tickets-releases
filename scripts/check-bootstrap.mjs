import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

const dependencyRoot = process.argv[2] ?? fileURLToPath(new URL("../vendor/Vencord/", import.meta.url));
const { build } = await import(pathToFileURL(join(dependencyRoot, "node_modules/esbuild/lib/main.js")).href);

const result = await build({
    entryPoints: [fileURLToPath(new URL("../plugin/discordTickets/index.tsx", import.meta.url))],
    platform: "node", format: "cjs", bundle: true, write: false, jsx: "transform", jsxFactory: "React.createElement", jsxFragment: "React.Fragment",
    plugins: [{ name: "discord-before-webpack", setup(build) {
        build.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: "style" }));
        build.onLoad({ filter: /.*/, namespace: "style" }, () => ({ contents: "", loader: "js" }));
        build.onResolve({ filter: /^@/ }, args => ({ path: args.path, namespace: "external" }));
        build.onLoad({ filter: /.*/, namespace: "external" }, args => {
            const path = args.path;
            if (path === "@webpack/common") return { contents: `
                export let React, ReactDOM, Parser, ChannelStore, Constants, DraftStore, DraftType, GuildStore, MessageStore,
                    PermissionsBits, PermissionStore, RestAPI, SelectedChannelStore, ExpressionPickerStore,
                    Modal, SearchableSelect, UserStore, useEffect, useLayoutEffect, useRef, useState, useStateFromStores;
                export const openModal = () => { throw Error("Modal requested before client initialization"); };
                export const closeModal = () => {};
            ` };
            if (path === "@webpack") return { contents: `export const findByCodeLazy = () => () => {}; export const findByPropsLazy = () => ({});` };
            if (path === "@api/DataStore") return { contents: `export const update = async () => {}; export const get = async () => undefined;` };
            if (path === "@api/ChatButtons") return { contents: `export const ChatBarButton = () => {};` };
            if (path === "@components/Button") return { contents: `export const Button = () => {};` };
            if (path === "@components/FormSwitch") return { contents: `export const FormSwitch = () => {};` };
            if (path === "@components/ErrorBoundary") return { contents: `export default {wrap: component => component};` };
            if (path === "@utils/types") return { contents: `export default plugin => plugin;` };
            throw Error(`Unmocked bootstrap dependency: ${path}`);
        });
    } }]
});
const context = vm.createContext({ module: { exports: {} }, exports: {}, TextEncoder, setTimeout, clearTimeout });
new vm.Script(result.outputFiles[0].text, { filename: "cybershoke-bootstrap.cjs" }).runInContext(context);
assert.equal(context.module.exports.default.name, "CYBERSHOKE Discord Tickets");
assert.equal(typeof context.module.exports.default.start, "function");
console.log("Bootstrap passed: the entire plugin imports before Discord React is available.");
