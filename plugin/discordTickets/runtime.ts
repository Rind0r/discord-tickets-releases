/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Luf
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { ChannelStore, Constants, DraftStore, DraftType, GuildStore, MessageStore, PermissionsBits, PermissionStore, RestAPI, SelectedChannelStore } from "@webpack/common";

import { authorFromStart, AuthorResult, categoryOf, createAuthorResolver, Data, initialData, inScope, StarterMessage, substitute, Template, ticketSource, validateData } from "./core";

const KEY = "CYBERSHOKE.DiscordTickets.data.v1";
const DraftManager = findByPropsLazy("clearDraft", "saveDraft");
const rawToRich = findByCodeLazy('.split("\\n").map(', 'type:"line",children:[{text:');
const SlateEditor = findByPropsLazy("start", "end", "toSlateRange");
const Transforms = findByPropsLazy("insertNodes", "textToText");

// Only the small adapter to the researched Discord editor is untyped.
export interface Composer {
    channel: { id: string; guild_id?: string; };
    type: { analyticsName: string; drafts: { type: number; }; };
    textValue: string;
    focused: boolean;
    disabled?: boolean;
    editorRef: { current: any };
    containerRef: { current: HTMLElement | null };
}
interface Snapshot { active: boolean; data?: Data; error?: string; generation: number; revision: number; }
let snapshot: Snapshot = { active: false, generation: 0, revision: 0 };
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getSnapshot = () => snapshot;
function publish(value: Partial<Snapshot>) { snapshot = { ...snapshot, ...value, revision: snapshot.revision + 1 }; listeners.forEach(fn => fn()); }
export let composer: Composer | undefined;
export let suppressedChannel: string | undefined;
export let suppressedText: string | undefined;
// Remember the user's explicit choice to stop searching this draft. No draft text
// is persisted; the short-lived append anchor exists only while searching.
const insertedDrafts = new Set<string>();
let appendSearch: { channelId: string; editor: unknown; prefix: string; } | undefined;
export let composing = false;
let autocompleteChannel: string | undefined;
const cleanupTasks = new Set<() => void>();
export const onCleanup = (fn: () => void) => { cleanupTasks.add(fn); return () => { cleanupTasks.delete(fn); }; };
let queue: Promise<unknown> = Promise.resolve();
let insertPending = false;
let insertionToken = 0;
let lifecycle = 0;

export async function startRuntime() {
    const run = ++lifecycle;
    publish({ active: true, data: undefined, error: undefined, generation: snapshot.generation + 1 });
    try {
        // Atomic first initialization: an intentionally empty set is still initialized.
        await DataStore.update(KEY, value => value === undefined ? initialData() : value);
        const data = validateData(await DataStore.get(KEY));
        if (snapshot.active && run === lifecycle) publish({ data });
    } catch {
        if (snapshot.active && run === lifecycle) publish({ error: "Не удалось прочитать локальные данные. Исходная запись сохранена; вставка и изменения заблокированы. Проверьте хранилище Vencord и версию плагина." });
    }
}
export function stopRuntime() {
    lifecycle++; insertionToken++; insertPending = false;
    composer = undefined;
    suppressedText = suppressedChannel = undefined;
    insertedDrafts.clear(); appendSearch = undefined;
    composing = false;
    autocompleteChannel = undefined;
    resolver.clear();
    publish({ active: false, generation: snapshot.generation + 1 });
    cleanupTasks.forEach(fn => fn()); cleanupTasks.clear();
}
export function channelChanged() {
    composer = undefined;
    composing = false;
    autocompleteChannel = undefined;
    suppressedText = suppressedChannel = undefined;
    appendSearch = undefined;
    publish({ generation: snapshot.generation + 1 });
    cleanupTasks.forEach(fn => fn()); cleanupTasks.clear();
}
export function registerComposer(value: Composer) {
    composer = value;
    if (!insertPending && !value.textValue) {
        insertedDrafts.delete(value.channel.id);
        if (appendSearch?.channelId === value.channel.id) appendSearch = undefined;
        if (suppressedChannel === value.channel.id) suppressedText = suppressedChannel = undefined;
    } else if (!insertPending && appendSearch?.channelId === value.channel.id && !value.textValue.startsWith(appendSearch.prefix)) {
        // Editing the protected part cancels the search, never removes user text.
        appendSearch = undefined;
    }
}
export function templateSearch(target: Composer) {
    if (appendSearch?.channelId === target.channel.id && appendSearch.editor === target.editorRef.current && target.textValue.startsWith(appendSearch.prefix)) {
        return { mode: "append" as const, query: target.textValue.slice(appendSearch.prefix.length), prefix: appendSearch.prefix };
    }
    return { mode: insertedDrafts.has(target.channel.id) && Boolean(target.textValue) ? "paused" as const : "initial" as const, query: insertedDrafts.has(target.channel.id) ? "" : target.textValue, prefix: undefined };
}
export function beginAdditionalTemplate(target = composer) {
    const reason = insertionReason(target);
    if (reason || !target) throw new Error(reason);
    if (insertPending) throw new Error("Дождитесь завершения текущей вставки.");
    const editor = target.editorRef.current;
    const slate = editor.getSlateEditor();
    Transforms.select(slate, SlateEditor.end(slate, []));
    editor.focus();
    insertedDrafts.add(target.channel.id);
    appendSearch = { channelId: target.channel.id, editor, prefix: editor.props.textValue };
    publish({});
}
export function cancelAdditionalTemplate() { appendSearch = undefined; publish({}); }
export function appendTemplateText(prefix: string, text: string): string {
    return prefix ? prefix + (prefix.endsWith("\n\n") ? "" : prefix.endsWith("\n") ? "\n" : "\n\n") + text : text;
}
export function setComposing(value: boolean) { composing = value; publish({}); }
export function saveData(change: (old: Data) => Data): Promise<void> {
    const run = lifecycle;
    const operation = queue.then(async () => {
        if (!snapshot.active || !snapshot.data || run !== lifecycle) throw new Error("Плагин остановлен. Повторите действие после включения.");
        let saved: Data | undefined;
        try {
            await DataStore.update(KEY, old => { saved = validateData(change(validateData(old))); return saved; });
        } catch (error) {
            if (error instanceof Error && /Название|Текст|шаблон|формат|ID|массив/.test(error.message)) throw error;
            throw new Error("Не удалось сохранить данные локально. Изменения не применены.");
        }
        if (snapshot.active && run === lifecycle) {
            if (!saved?.enabled) { composing = false; appendSearch = undefined; }
            publish({ data: saved });
        }
    });
    queue = operation.catch(() => {});
    return operation;
}

function getInsertionReason(target = composer): string | undefined {
    if (!snapshot.active) return "Плагин выключен средствами Vencord.";
    if (snapshot.error) return snapshot.error;
    if (!snapshot.data) return "Локальные данные ещё загружаются.";
    if (!snapshot.data.enabled) return "Функции выключены внутренним переключателем. Управление шаблонами доступно.";
    if (!target || target.type.analyticsName !== "normal" || !target.channel.guild_id) return "Основное поле нового сообщения серверного чата недоступно.";
    if (SelectedChannelStore.getChannelId() !== target.channel.id) return "Активный канал изменился. Откройте окно заново.";
    const channel = ChannelStore.getChannel(target.channel.id);
    if (!inScope(channel, snapshot.data.scope, id => ChannelStore.getChannel(id))) return "Этот чат вне выбранной области действия. Измените сервер или категории ниже.";
    if (snapshot.data.scope.mode !== "all" && !GuildStore.getGuild(snapshot.data.scope.guildId)) return "Выбранный сервер недоступен.";
    if (snapshot.data.scope.mode === "categories") {
        const categoryId = categoryOf(channel, id => ChannelStore.getChannel(id));
        const category = categoryId ? ChannelStore.getChannel(categoryId) : undefined;
        if (category?.type !== 4 || category.guild_id !== snapshot.data.scope.guildId || !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, category)) return "Выбранная категория недоступна. Настройки сохранены; область действия не расширена.";
    }
    const editor = target.editorRef.current;
    if (!channel || target.disabled || editor?.props?.disabled || editor?.state?.submitting || !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)
        || !PermissionStore.can(channel.isThread() ? PermissionsBits.SEND_MESSAGES_IN_THREADS : PermissionsBits.SEND_MESSAGES, channel)) return "Нет права отправлять сообщения или поле ввода недоступно.";
    if (editor?.props?.type?.analyticsName !== "normal" || editor?.props?.channel?.id !== channel.id || !editor?.getSlateEditor?.() || typeof editor?.props?.onChange !== "function") return "Совместимый редактор Discord не найден. Проверьте обновления плагина.";
    if (composing || editor.getSlateEditor()?.composition) return "Завершите составление символа через IME перед вставкой.";
}
export function insertionReason(target = composer): string | undefined {
    try { return getInsertionReason(target); }
    catch { return "Не удалось проверить редактор или права доступа. Возможно, интерфейс Discord изменился. Вставка недоступна."; }
}
export function maxLength(): number | undefined {
    const value = composer?.editorRef.current?.props?.maxCharacterCount;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
export function nativePopup(target: Composer): boolean {
    const editor = target.editorRef.current;
    return autocompleteChannel === target.channel.id || editor?.state?.popup?.id != null || Boolean(editor?.getSlateEditor?.()?.composition);
}
export function autocompleteChanged(channelId: string, visible: boolean) {
    if (!snapshot.active) return;
    const next = visible ? channelId : autocompleteChannel === channelId ? undefined : autocompleteChannel;
    if (next !== autocompleteChannel) { autocompleteChannel = next; publish({}); }
}

const resolver = createAuthorResolver(async channelId => {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel || !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)) return { reason: "Нет доступа к истории начала обращения." };
    const messages = MessageStore.getMessages(channelId);
    if (messages?.ready && messages.hasMoreBefore === false && messages._array.length) return authorFromStart(messages._array as unknown as StarterMessage[], channelId, true);
    if (!PermissionStore.can(PermissionsBits.READ_MESSAGE_HISTORY, channel)) return { reason: "Нет доступа к истории начала обращения." };
    // after=0 requests the earliest page, not arbitrary recent bot messages. No pagination.
    let timeout: ReturnType<typeof setTimeout>;
    const response = await Promise.race([
        RestAPI.get({ url: Constants.Endpoints.MESSAGES(channelId), query: { after: "0", limit: 50 }, retries: 0 }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("History timeout")), 12_000); })
    ]).finally(() => clearTimeout(timeout));
    if (!Array.isArray(response.body)) return { reason: "Discord вернул неизвестный формат истории." };
    return authorFromStart(response.body, channelId, true);
});
export function resolveAuthor(channelId: string): Promise<AuthorResult> {
    const source = ticketSource(ChannelStore.getChannel(channelId), id => ChannelStore.getChannel(id));
    if (!source) return Promise.resolve({ reason: "Определение автора поддерживается только для обращений в исходной категории CYBERSHOKE. Система обращений этого чата неизвестна." });
    return resolver.resolve(source);
}
export function clearAuthorCache() { resolver.clear(); }

export async function insertTemplate(template: Template, target = composer): Promise<void> {
    if (insertPending) throw new Error("Дождитесь завершения текущей вставки.");
    const reason = insertionReason(target);
    if (reason || !target) throw new Error(reason);
    const stored = snapshot.data?.templates.find(t => t.id === template.id);
    if (!stored) throw new Error("Шаблон уже удалён. Выберите другой шаблон.");
    template = stored;
    const editor = target.editorRef.current;
    const originalText = editor.props.textValue;
    const search = templateSearch({ ...target, textValue: originalText });
    const prefix = search.mode === "append" ? search.prefix : search.mode === "paused" ? originalText : undefined;
    const { generation } = snapshot;
    const { revision } = snapshot;
    const token = ++insertionToken;
    insertPending = true;
    try {
        const author = template.text.includes("{автор}") ? await resolveAuthor(target.channel.id) : { reason: "Переменная не используется." };
        if (generation !== snapshot.generation || !snapshot.active || revision !== snapshot.revision || composer?.editorRef.current !== editor
            || editor.props.textValue !== originalText || SelectedChannelStore.getChannelId() !== target.channel.id) throw new Error("Канал, настройки или черновик изменились во время подготовки. Текст не заменён; повторите вставку.");
        const currentReason = insertionReason(target);
        if (currentReason) throw new Error(currentReason);
        const resolved = substitute(template.text, author);
        const text = prefix === undefined ? resolved : appendTemplateText(prefix, resolved);
        let rich: unknown;
        try { rich = rawToRich(text); }
        catch { throw new Error("Не найден совместимый преобразователь текста Discord. Вставка отменена, черновик сохранён."); }
        if (!Array.isArray(rich) || !rich.length || typeof Transforms.select !== "function" || typeof DraftManager.saveDraft !== "function") throw new Error("Формат редактора изменился. Вставка отменена.");
        suppressedChannel = target.channel.id; suppressedText = text;
        insertedDrafts.add(target.channel.id); appendSearch = undefined;
        // The exact native onChange contract used by Discord's CLEAR_TEXT handler.
        // Reply and uploads live in separate stores and are intentionally untouched.
        editor.props.onChange(null, text, rich);
        DraftManager.saveDraft(target.channel.id, text, DraftType.ChannelMessage);
        publish({});
        await new Promise<void>((resolve, reject) => requestAnimationFrame(() => {
            try {
                if (snapshot.active && generation === snapshot.generation && composer?.editorRef.current === editor && SelectedChannelStore.getChannelId() === target.channel.id
                    && editor.props.textValue === text) {
                    const slate = editor.getSlateEditor();
                    Transforms.select(slate, SlateEditor.end(slate, []));
                    editor.focus();
                }
                resolve();
            } catch { reject(new Error("Текст вставлен, но вернуть фокус не удалось. Нажмите на поле ввода.")); }
        }));
    } finally { if (token === insertionToken) insertPending = false; }
}
export function refocusInserted(target?: Composer) {
    const { generation } = snapshot;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!target || generation !== snapshot.generation || !snapshot.active || suppressedChannel !== target.channel.id
            || SelectedChannelStore.getChannelId() !== target.channel.id) return;
        const editor = target.editorRef.current;
        if (composer?.editorRef.current !== editor || editor?.props?.textValue !== suppressedText) return;
        try { Transforms.select(editor.getSlateEditor(), SlateEditor.end(editor.getSlateEditor(), [])); editor.focus(); }
        catch {
            // The initial insertion reports focus failures; never touch another editor.
        }
    }));
}
export function getDraftText(): string { return composer ? DraftStore.getDraft(composer.channel.id, DraftType.ChannelMessage) : ""; }
