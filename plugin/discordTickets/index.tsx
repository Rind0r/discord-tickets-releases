/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Luf
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconComponent } from "@utils/types";
import { React } from "@webpack/common";

import { autocompleteChanged, channelChanged, clearAuthorCache, getSnapshot, startRuntime, stopRuntime, subscribe } from "./runtime";
import { closePluginModals, closePreviews, ComposerPanel, openLibrary, openManager } from "./ui";

const TicketIcon: IconComponent = ({ width = 20, height = 20, className }) => <svg width={width} height={height} className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M8 8h8M8 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
const TicketButton: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    const state = React.useSyncExternalStore(subscribe, getSnapshot);
    if (!state.active || !isMainChat || !channel.guild_id) return null;
    return <ChatBarButton tooltip="CYBERSHOKE Discord Tickets" onClick={openManager}><TicketIcon /></ChatBarButton>;
};
const SettingsEntry = ErrorBoundary.wrap(() => {
    const state = React.useSyncExternalStore(subscribe, getSnapshot);
    return <div className="csdt-actions">{state.active ? <><Button onClick={openManager}>Настройки</Button><Button variant="secondary" onClick={() => openLibrary()}>Все шаблоны</Button></> : <p>Включите плагин в Vencord и перезапустите Discord.</p>}</div>;
}, { noop: false });

export default definePlugin({
    name: "CYBERSHOKE Discord Tickets",
    description: "Шаблоны CYBERSHOKE.",
    // No invented Discord author ID. The visible credit is in the description and dialogs.
    authors: [],
    chatBarButton: { icon: TicketIcon, render: TicketButton },
    settingsAboutComponent: SettingsEntry,
    patches: [{
        find: ".CREATE_FORUM_POST||",
        replacement: [{
            // In the main text-area render, insert a sibling before the native focus ring.
            // Both refs come from React; no CSS selectors or editor DOM mutation.
            match: /(?<=children:\[)(?=\i,\(0,\i\.jsx\)\(\i\.\i,\{ringTarget:(\i),ringClassName:\i\.\i,children:\(0,\i\.jsx\)\(\i\.\i,\{ref:(\i),id:\i,focused:)/,
            replace: "$self.renderComposer({...arguments[0],containerRef:$1,editorRef:$2}),"
        }, {
            match: /(?<=onSendSticker:\i,)onVisibilityChange:(\i),editorScrollerRef:/,
            replace: "onVisibilityChange:(visible)=>{$1(visible);$self.autocompleteChanged(arguments[0].channel.id,visible)},editorScrollerRef:"
        }]
    }],
    renderComposer: ComposerPanel,
    autocompleteChanged(channelId: string, visible: boolean) {
        try { autocompleteChanged(channelId, visible); } catch {
            // A patch callback must never break Discord's native autocomplete.
        }
    },
    start() { void startRuntime(); },
    stop() { stopRuntime(); closePluginModals(); },
    flux: {
        CHANNEL_SELECT() { channelChanged(); closePreviews(); },
        LOGOUT() { channelChanged(); clearAuthorCache(); closePluginModals(); }
    }
});
