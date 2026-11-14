/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Luf
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const GUILD_ID = "667408723052068894";
export const CATEGORY_ID = "813735380339785728";
export const BOT_ID = "1239308469593702410";
export const VARIABLE = "{автор}";
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_TEMPLATES = 500;
export const MAX_TEXT = 100_000;
export interface Template { id: string; name: string; text: string; }
export interface Greeting { enabled: boolean; templateId: string | null; }
export interface Transfer { version: 1; templates: Template[]; greeting: Greeting; }
export interface Scope { mode: "categories" | "guild" | "all"; guildId: string; categoryIds: string[]; }
export interface Data extends Transfer { enabled: boolean; scope: Scope; }
export interface ChannelInfo { id: string; type: number; guild_id?: string; parent_id?: string | null; }
export const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,20}$/.test(v);
export const newId = () => crypto.randomUUID();

export function initialData(): Data {
    const id = newId();
    return {
        version: 1, enabled: true,
        scope: { mode: "categories", guildId: GUILD_ID, categoryIds: [CATEGORY_ID] },
        greeting: { enabled: true, templateId: id },
        templates: [{ id, name: "Приветствие", text: "Доброго времени суток!\nСпасибо за обращение в поддержку CYBERSHOKE.\n\nНам потребуется некоторое время, чтобы проверить информацию и разобраться в ситуации.\nПожалуйста, ожидайте — мы напишем в чат по итогам проверки." }]
    };
}

export const normalizeForSearch = (text: string) => text.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
export function search(templates: Template[], query: string, minimumLength = 2): Template[] {
    const q = normalizeForSearch(query);
    if ([...q].length < minimumLength) return [];
    const words = q.split(" ");
    return templates.map((t, index) => {
        const title = normalizeForSearch(t.name);
        const all = title + " " + normalizeForSearch(t.text);
        return { t, index, matches: words.every(w => all.includes(w)), score: words.filter(w => title.includes(w)).length };
    }).filter(t => t.matches).sort((a, b) => b.score - a.score || a.index - b.index).map(t => t.t);
}

export function suggestions(data: Data, query: string, greetingActivated = false): Template[] {
    if (!data.enabled) return [];
    if (!query.trim()) return greetingActivated && data.greeting.enabled ? data.templates.filter(t => t.id === data.greeting.templateId) : [];
    return search(data.templates, query);
}

export function categoryOf(channel: ChannelInfo, get: (id: string) => ChannelInfo | undefined): string | undefined {
    if ([10, 11, 12].includes(channel.type)) {
        const parent = channel.parent_id ? get(channel.parent_id) : undefined;
        return parent?.guild_id === channel.guild_id ? parent?.parent_id ?? undefined : undefined;
    }
    return channel.parent_id ?? undefined;
}
export function inScope(channel: ChannelInfo | undefined, scope: Scope, get: (id: string) => ChannelInfo | undefined): boolean {
    if (!channel?.guild_id || ![0, 5, 10, 11, 12].includes(channel.type)) return false;
    if (scope.mode === "all") return true;
    if (channel.guild_id !== scope.guildId) return false;
    return scope.mode === "guild" || scope.categoryIds.includes(categoryOf(channel, get) ?? "");
}
export function ticketSource(channel: ChannelInfo | undefined, get: (id: string) => ChannelInfo | undefined): string | undefined {
    if (!channel || channel.guild_id !== GUILD_ID || categoryOf(channel, get) !== CATEGORY_ID) return;
    if ([10, 11, 12].includes(channel.type)) {
        const parent = channel.parent_id ? get(channel.parent_id) : undefined;
        return parent?.type === 0 ? parent.id : undefined;
    }
    return channel.type === 0 ? channel.id : undefined;
}

function object(v: unknown): Record<string, unknown> {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Ожидался объект JSON.");
    return v as Record<string, unknown>;
}
export function validateTemplate(value: unknown): Template {
    const v = object(value);
    if (typeof v.id !== "string" || !/^[\w-]{1,128}$/.test(v.id)) throw new Error("Недопустимый ID шаблона.");
    if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 200) throw new Error("Название должно содержать от 1 до 200 символов и не быть пробельным.");
    if (typeof v.text !== "string" || !v.text.trim() || v.text.length > MAX_TEXT) throw new Error(`Текст должен содержать от 1 до ${MAX_TEXT} символов и не быть пробельным.`);
    return { id: v.id, name: v.name, text: v.text };
}
export function validateTransfer(value: unknown): Transfer {
    const v = object(value);
    if (v.version !== 1) throw new Error("Неподдерживаемая версия формата. Нужна версия 1; данные не изменены.");
    if (!Array.isArray(v.templates) || v.templates.length > MAX_TEMPLATES) throw new Error(`Нужен массив templates, не более ${MAX_TEMPLATES} шаблонов.`);
    const templates = v.templates.map(validateTemplate);
    const ids = new Set(templates.map(t => t.id));
    if (ids.size !== templates.length) throw new Error("В файле повторяются ID шаблонов.");
    const g = object(v.greeting);
    if (typeof g.enabled !== "boolean" || !(g.templateId === null || typeof g.templateId === "string" && ids.has(g.templateId))) throw new Error("Настройка приветствия некорректна или ссылается на отсутствующий шаблон.");
    const result: Transfer = { version: 1, templates, greeting: { enabled: g.enabled, templateId: g.templateId as string | null } };
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_FILE_BYTES) throw new Error("Набор шаблонов превышает 4 МиБ. Уменьшите количество или размер шаблонов.");
    return result;
}
export function parseImport(text: string): Transfer {
    if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error("Файл больше 4 МиБ.");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error("Файл содержит повреждённый JSON."); }
    return validateTransfer(parsed);
}
export function validateData(value: unknown): Data {
    const v = object(value);
    const transfer = validateTransfer(v);
    const s = object(v.scope);
    if (typeof v.enabled !== "boolean" || !["categories", "guild", "all"].includes(s.mode as string)
        || !isId(s.guildId) || !Array.isArray(s.categoryIds) || s.categoryIds.length > 500
        || !s.categoryIds.every(isId) || new Set(s.categoryIds).size !== s.categoryIds.length) throw new Error("Повреждены настройки области действия. Автоматическое расширение запрещено.");
    return { ...transfer, enabled: v.enabled, scope: { mode: s.mode as Scope["mode"], guildId: s.guildId, categoryIds: [...s.categoryIds] } };
}
export function mergeImport(data: Data, imported: Transfer, mode: "add" | "replace", createId = newId): Data {
    if (mode === "replace") return validateData({ ...data, ...imported });
    const ids = new Set(data.templates.map(t => t.id));
    const remap = new Map<string, string>();
    const added = imported.templates.map(t => {
        let { id } = t;
        for (let tries = 0; ids.has(id); tries++) {
            if (tries >= 100) throw new Error("Не удалось создать уникальный ID.");
            id = createId();
        }
        ids.add(id); remap.set(t.id, id);
        return { ...t, id };
    });
    // Existing greeting wins. An imported greeting can fill an empty reference.
    const greeting = data.greeting.templateId ? data.greeting : {
        enabled: imported.greeting.enabled,
        templateId: imported.greeting.templateId ? remap.get(imported.greeting.templateId)! : null
    };
    return validateData({ ...data, templates: [...data.templates, ...added], greeting });
}
export function removeTemplate(data: Data, id: string): Data {
    return { ...data, templates: data.templates.filter(t => t.id !== id), greeting: data.greeting.templateId === id ? { ...data.greeting, templateId: null } : data.greeting };
}
export function exportData(data: Data): string {
    return JSON.stringify({ version: 1, templates: data.templates, greeting: data.greeting } satisfies Transfer, null, 2);
}

export interface StarterMessage {
    id: string; channel_id: string; type: number; author: { id: string };
    content: string; mentions: unknown[]; mentionRoles?: unknown[]; mention_roles?: unknown[]; embeds: unknown[];
}
export type AuthorResult = { id: string; reason?: never } | { id?: never; reason: string };
export function authorFromStart(messages: StarterMessage[], channelId: string, hasBeginning: boolean): AuthorResult {
    if (!hasBeginning) return { reason: "Начало переписки не загружено." };
    const sorted = [...messages].filter(m => m.channel_id === channelId && isId(m.id))
        .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
    // System notices are not ticket messages. Never fall back to a later bot message.
    const first = sorted.find(m => m.type === 0 || m.type === 19);
    if (!first || first.type !== 0 || first.author?.id !== BOT_ID || !Array.isArray(first.embeds) || !first.embeds.length) return { reason: "Стартовое сообщение CYBERSHOKE Tickets с карточкой не найдено в начале чата." };
    if (typeof first.content !== "string" || !Array.isArray(first.mentions)) return { reason: "Неизвестная структура упоминаний стартового сообщения." };
    const users = first.mentions.map(v => typeof v === "string" ? v : v && typeof v === "object" ? (v as { id?: unknown }).id : undefined);
    if (!users.every(isId)) return { reason: "Неизвестная структура пользовательских упоминаний." };
    const roles = first.mentionRoles ?? first.mention_roles;
    if (!Array.isArray(roles) || !roles.every(isId)) return { reason: "Нет надёжных данных о ролях в стартовом сообщении." };
    const unique = [...new Set(users)];
    if (unique.length !== 1 || roles.includes(unique[0])) return { reason: "Автор неоднозначен: в стартовом сообщении должно быть ровно одно пользовательское упоминание." };
    const id = unique[0];
    const tokens = [...first.content.matchAll(/<@(!?)(\d+)>|<@&(\d+)>/g)];
    if (tokens[0]?.[2] !== id || tokens.some(t => t[3] ? !roles.includes(t[3]) : t[2] !== id)) return { reason: "Стартовое сообщение не соответствует данным упоминаний: сначала пользователь, затем роли." };
    const delay = (BigInt(first.id) >> 22n) - (BigInt(channelId) >> 22n);
    if (delay < 0n || delay > 120_000n) return { reason: "Самое раннее доступное сообщение слишком далеко от создания чата. Возможно, стартовое сообщение удалено; автор не определён." };
    return { id };
}
export function substitute(text: string, author: AuthorResult): string {
    if (!text.includes(VARIABLE)) return text;
    if (!author.id) throw new Error(author.reason);
    return text.split(VARIABLE).join(`<@${author.id}>`);
}

export function createAuthorResolver(load: (id: string) => Promise<AuthorResult>, now = Date.now) {
    const cache = new Map<string, { value: AuthorResult; at: number }>();
    const pending = new Map<string, Promise<AuthorResult>>();
    let generation = 0;
    return {
        resolve(id: string): Promise<AuthorResult> {
            const cached = cache.get(id);
            if (cached && (cached.value.id || now() - cached.at < 60_000)) return Promise.resolve(cached.value);
            if (pending.has(id)) return pending.get(id)!;
            const epoch = generation;
            const request = Promise.resolve().then(() => load(id)).catch(() => ({ reason: "Не удалось прочитать начало обращения. Возможна ошибка сети или ограничение частоты; повторите через минуту." } as AuthorResult))
                .then(value => { if (epoch === generation) cache.set(id, { value, at: now() }); return value; })
                .finally(() => { if (epoch === generation) pending.delete(id); });
            pending.set(id, request);
            return request;
        },
        clear() { generation++; cache.clear(); pending.clear(); }
    };
}
