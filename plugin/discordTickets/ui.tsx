/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Luf
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { FormSwitch } from "@components/FormSwitch";
import { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, closeModal, ExpressionPickerStore, GuildStore, Modal, openModal, PermissionsBits, PermissionStore, React, ReactDOM, SearchableSelect, useEffect, useLayoutEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import { addFromCatalog, catalogHasTemplate, getCatalog } from "./catalog";
import { exportData, MAX_FILE_BYTES, mergeImport, newId, parseImport, removeTemplate, search, suggestions, Template, validateTemplate } from "./core";
import { FormattedText, TemplateTextEditor } from "./editor";
import { beginAdditionalTemplate, cancelAdditionalTemplate, Composer, composer, composing, getSnapshot, insertionReason, insertTemplate, maxLength, nativePopup, onCleanup, refocusInserted, registerComposer, resolveAuthor, saveData, setComposing, subscribe, templateSearch } from "./runtime";
import { highlightedParts, matchingSnippet } from "./text";

const useData = () => React.useSyncExternalStore(subscribe, getSnapshot);
const messageOf = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить действие.";
const modalKeys = new Set<string>();
const previewKeys = new Set<string>();
function PluginTitle() {
    return <span className="csdt-modal-title"><span>CYBERSHOKE Discord Tickets</span><span className="csdt-author">by Luf</span></span>;
}
function Highlight({ text, query }: { text: string; query: string }) {
    return <>{highlightedParts(text, query).map((part, index) => part.match ? <mark className="csdt-match" key={index}>{part.text}</mark> : <React.Fragment key={index}>{part.text}</React.Fragment>)}</>;
}
export function closePluginModals() { for (const key of modalKeys) closeModal(key); modalKeys.clear(); }
export function closePreviews() { for (const key of previewKeys) closeModal(key); previewKeys.clear(); }
function ownedModal(render: (props: RenderModalProps) => React.ReactNode, onCloseRequest?: () => void) {
    const Safe = ErrorBoundary.wrap(render, { noop: false });
    const key = openModal(props => <Safe {...props} />, { onCloseRequest, onCloseCallback: () => { modalKeys.delete(key); previewKeys.delete(key); } });
    modalKeys.add(key);
    return key;
}
function runConfirm(title: string, text: string, action: () => Promise<void>) {
    function Confirm(props: RenderModalProps) {
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState("");
        return <Modal {...props} title={title} subtitle={text} notice={error ? { type: "critical", message: error } : undefined} actions={[
            { text: "Отмена", variant: "secondary", disabled: busy, onClick: props.onClose },
            { text: "Подтвердить", variant: "critical-primary", disabled: busy, onClick: async () => {
                setBusy(true);
                try { await action(); props.onClose(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
            } }
        ]} />;
    }
    ownedModal(props => <Confirm {...props} />);
}

function Count({ text }: { text: string }) {
    const limit = maxLength();
    return <p className={limit && text.length > limit ? "csdt-warning" : "csdt-muted"}>
        {text.length}{limit ? ` / ${limit}` : " символов"}
        {limit && text.length > limit ? " · Превышен лимит сообщения" : ""}
    </p>;
}
export function openPreview(template: Template, target = composer, closeParent?: () => void) {
    const targetId = target?.channel.id;
    const { generation } = getSnapshot();
    function Preview(props: RenderModalProps) {
        const state = useData();
        const [recipient, setRecipient] = useState(template.text.includes("{автор}") ? "Определяю автора…" : "");
        const [text, setText] = useState(template.text);
        const [error, setError] = useState("");
        const [busy, setBusy] = useState(false);
        useEffect(() => {
            let cancelled = false;
            if (!state.data?.enabled) { setRecipient(""); return; }
            if (targetId && template.text.includes("{автор}")) resolveAuthor(targetId).then(result => {
                if (cancelled || generation !== getSnapshot().generation) return;
                if (result.id) {
                    const user = UserStore.getUser(result.id);
                    setRecipient(`Получатель: ${user?.globalName || user?.username || "пользователь"} — <@${result.id}>`);
                    setText(template.text.split("{автор}").join(`<@${result.id}>`));
                } else setRecipient(result.reason ?? "Автор не определён.");
            });
            return () => { cancelled = true; };
        }, []);
        const reason = insertionReason(target);
        return <Modal {...props} title={template.name} size="lg" subtitle={recipient || undefined} notice={error ? { type: "critical", message: error } : undefined} actions={[
            { text: "Закрыть", variant: "secondary", onClick: props.onClose },
            { text: "Вставить", variant: "primary", disabled: busy || Boolean(reason) || !state.active, onClick: async () => {
                setBusy(true);
                try { await insertTemplate(template, target); props.onClose(); closeParent?.(); refocusInserted(target); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
            } }
        ]}>
            <div className="csdt"><div className="csdt-preview"><FormattedText text={text} /></div><Count text={text} />{reason && <p className="csdt-warning">{reason}</p>}</div>
        </Modal>;
    }
    previewKeys.add(ownedModal(props => <Preview {...props} />));
}

function openEditor(existing?: Template) {
    let askClose = () => {};
    function Editor(props: RenderModalProps) {
        const [id] = useState(existing?.id ?? newId);
        const [name, setName] = useState(existing?.name ?? "");
        const [text, setText] = useState(existing?.text ?? "");
        const [error, setError] = useState("");
        const [busy, setBusy] = useState(false);
        const dirty = name !== (existing?.name ?? "") || text !== (existing?.text ?? "");
        const saving = useRef(false);
        async function save() {
            saving.current = true; setBusy(true);
            try {
                const template = validateTemplate({ id, name, text });
                await saveData(data => {
                    if (existing && !data.templates.some(t => t.id === id)) throw new Error("Этот шаблон уже удалён в другом окне.");
                    return { ...data, templates: existing ? data.templates.map(t => t.id === id ? template : t) : [...data.templates, template] };
                });
                props.onClose();
                return true;
            } catch (e) { setError(messageOf(e)); return false; } finally { saving.current = false; setBusy(false); }
        }
        askClose = () => {
            if (saving.current) return;
            if (!dirty) { props.onClose(); return; }
            ownedModal(p => <Modal {...p} title="Есть несохранённые изменения" subtitle="Сохранить шаблон перед закрытием?" actions={[
                { text: "Продолжить редактирование", variant: "secondary", onClick: p.onClose },
                { text: "Отказаться от изменений", variant: "secondary", onClick: () => { p.onClose(); props.onClose(); } },
                { text: "Сохранить", variant: "primary", onClick: async () => { p.onClose(); await save(); } }
            ]} />);
        };
        return <Modal {...props} onClose={() => askClose()} size="lg" title={existing ? "Изменить шаблон" : "Добавить шаблон"} notice={error ? { type: "critical", message: error } : undefined} actions={[
            { text: "Закрыть", variant: "secondary", disabled: busy, onClick: () => askClose() },
            { text: "Сохранить шаблон", variant: "primary", disabled: busy, onClick: () => { void save(); } }
        ]}>
            <div className="csdt csdt-stack">
                <label>Название<input className="csdt-input" value={name} maxLength={200} onChange={e => setName(e.target.value)} /></label>
                <TemplateTextEditor text={text} onChange={setText} />
                <Count text={text} />
            </div>
        </Modal>;
    }
    ownedModal(props => <Editor {...props} />, () => askClose());
}

function ScopeSettings({ report }: { report: (action: () => Promise<void>) => void }) {
    const { data } = useData();
    const [guilds, channels] = useStateFromStores([GuildStore, ChannelStore, PermissionStore], () => [Object.values(GuildStore.getGuilds()), Object.values(ChannelStore.getMutableGuildChannelsForGuild(data?.scope.guildId ?? ""))] as const);
    if (!data) return null;
    const { scope } = data;
    const categories = channels.filter(c => c.type === 4 && PermissionStore.can(PermissionsBits.VIEW_CHANNEL, c));
    const unavailable = scope.categoryIds.filter(id => !categories.some(c => c.id === id));
    return <fieldset className="csdt-stack"><legend>Область действия</legend>
        <label>Режим<SearchableSelect className="csdt-select" value={scope.mode} options={[
            { value: "categories", label: "Выбранные категории выбранного сервера" },
            { value: "guild", label: "Весь выбранный сервер" },
            { value: "all", label: "Все серверы" }
        ]} closeOnSelect clearable={false} onChange={mode => {
            report(() => saveData(d => ({ ...d, scope: { ...d.scope, mode } })));
        }} /></label>
        <label>Сервер<SearchableSelect className="csdt-select" value={scope.guildId} options={[
            ...(!guilds.some(g => g.id === scope.guildId) ? [{ value: scope.guildId, label: `Недоступен (${scope.guildId})` }] : []),
            ...guilds.sort((a, b) => a.name.localeCompare(b.name)).map(g => ({ value: g.id, label: g.name }))
        ]} maxVisibleItems={7} closeOnSelect clearable={false} placeholder="Выбрать сервер" onChange={guildId => {
            report(() => saveData(d => ({ ...d, scope: { ...d.scope, guildId, categoryIds: [] } })));
        }} /></label>
        {!GuildStore.getGuild(scope.guildId) && <p className="csdt-warning">Настроенный сервер недоступен. Настройки сохранены, область автоматически не расширяется.</p>}
        <span className="csdt-section-title">Категории</span>
        <div className="csdt-categories">{categories.map(c => <label key={c.id} className="csdt-check"><input type="checkbox" checked={scope.categoryIds.includes(c.id)} onChange={e => {
            const { checked } = e.target;
            report(() => saveData(d => ({ ...d, scope: { ...d.scope, categoryIds: checked ? [...new Set([...d.scope.categoryIds, c.id])] : d.scope.categoryIds.filter(id => id !== c.id) } })));
        }} />{c.name}</label>)}</div>
        {unavailable.map(id => <p className="csdt-warning" key={id}>Категория {id} недоступна. Её ID сохранён. <Button size="xs" variant="secondary" onClick={() => report(() => saveData(d => ({ ...d, scope: { ...d.scope, categoryIds: d.scope.categoryIds.filter(v => v !== id) } })))}>Убрать из выбора</Button></p>)}
        {scope.mode === "categories" && !scope.categoryIds.length && <p className="csdt-warning">Категории не выбраны: подсказки и вставка везде отключены.</p>}
    </fieldset>;
}

export function openLibrary(target = composer, closeParent?: () => void) {
    function Manager(props: RenderModalProps) {
        const state = useData();
        const [query, setQuery] = useState("");
        const [error, setError] = useState("");
        const [status, setStatus] = useState("");
        const [busy, setBusy] = useState(false);
        const inputFile = useRef<HTMLInputElement>(null);
        const { data } = state;
        function report(action: () => Promise<void>) {
            setError(""); setStatus(""); setBusy(true);
            action().then(() => setStatus("Сохранено локально.")).catch(e => setError(messageOf(e))).finally(() => setBusy(false));
        }
        async function importFile(file?: File) {
            if (!file) return;
            try {
                if (file.size > MAX_FILE_BYTES) throw new Error("Файл больше 4 МиБ.");
                const imported = parseImport(await file.text());
                if (!getSnapshot().active) return;
                ownedModal(p => <Modal {...p} title="Импорт шаблонов" subtitle={`Проверено шаблонов: ${imported.templates.length}. Выберите режим.`} actions={[
                    { text: "Отмена", variant: "secondary", onClick: p.onClose },
                    { text: "Добавить к существующим", variant: "primary", onClick: () => { p.onClose(); report(() => saveData(d => mergeImport(d, imported, "add"))); } },
                    { text: "Заменить…", variant: "critical-primary", onClick: () => {
                        p.onClose(); runConfirm("Заменить все шаблоны?", "Текущий набор шаблонов и выбор приветствия будут удалены и заменены содержимым файла. Сначала сохраните экспорт, если нужен старый набор.", () => saveData(d => mergeImport(d, imported, "replace")));
                    } }
                ]} />);
            } catch (e) { setError(messageOf(e)); }
        }
        function exportFile() {
            if (!data) return;
            const url = URL.createObjectURL(new Blob([exportData(data)], { type: "application/json" }));
            const a = document.createElement("a"); a.href = url; a.download = "Discord-Tickets.json"; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        const items = !query.trim() ? data?.templates ?? [] : search(data?.templates ?? [], query, 1);
        const reason = insertionReason(target);
        const finishInsert = () => { props.onClose(); closeParent?.(); };
        return <Modal {...props} size="lg" title="Все шаблоны" notice={error || state.error ? { type: "critical", message: error || state.error! } : undefined} actions={[{ text: "Закрыть", variant: "secondary", onClick: props.onClose }]}>
            <div className="csdt csdt-stack">
                {!data ? <p>{state.error ?? "Загрузка локальных данных…"}</p> : <>
                    <fieldset disabled={busy} className="csdt-stack csdt-controls">
                        {reason && <p className="csdt-warning">{reason}</p>}
                        <div className="csdt-actions"><Button onClick={() => openEditor()}>Добавить шаблон</Button><Button variant="secondary" onClick={exportFile}>Экспорт JSON</Button><Button variant="secondary" onClick={() => inputFile.current?.click()}>Импорт JSON</Button></div>
                        <input type="file" accept=".json,application/json" ref={inputFile} hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
                        <label>Поиск по всем шаблонам<input className="csdt-input" value={query} onChange={e => setQuery(e.target.value)} /></label>
                        <p className="csdt-muted" role="status">{status} Шаблонов: {data.templates.length}</p>
                        <div className="csdt-list">{items.map(t => <article key={t.id} className="csdt-card">
                            <strong><Highlight text={t.name} query={query} /></strong><p className="csdt-snippet"><Highlight text={matchingSnippet(t.text, query)} query={query} /></p>
                            <div className="csdt-actions"><Button size="small" variant="secondary" onClick={() => openPreview(t, target, finishInsert)}>Предпросмотр</Button>
                                <Button size="small" disabled={Boolean(reason)} onClick={() => report(async () => { await insertTemplate(t, target); finishInsert(); refocusInserted(target); })}>Вставить</Button>
                                <Button size="small" variant="secondary" onClick={() => openEditor(t)}>Изменить</Button>
                                <Button size="small" variant="dangerSecondary" onClick={() => runConfirm("Удалить шаблон?", `«${t.name}» будет удалён.`, () => saveData(d => removeTemplate(d, t.id)))}>Удалить</Button></div>
                        </article>)}{!items.length && <p>Шаблоны не найдены.</p>}</div>
                    </fieldset>
                </>}
            </div>
        </Modal>;
    }
    ownedModal(props => <Manager {...props} />);
}

export function openManager() {
    const target = composer;
    function Settings(props: RenderModalProps) {
        const { data, error: storageError } = useData();
        const [error, setError] = useState("");
        const [busy, setBusy] = useState(false);
        function report(action: () => Promise<void>) {
            setError(""); setBusy(true);
            action().catch(e => setError(messageOf(e))).finally(() => setBusy(false));
        }
        return <Modal {...props} size="lg" title={<PluginTitle />} notice={error || storageError ? { type: "critical", message: error || storageError! } : undefined} actions={[
            { text: "Все шаблоны", variant: "secondary", onClick: () => openLibrary(target, props.onClose) },
            { text: "Закрыть", variant: "secondary", onClick: props.onClose }
        ]}>
            <div className="csdt csdt-stack">{!data ? <p>{storageError ?? "Загрузка…"}</p> : <fieldset disabled={busy} className="csdt-controls csdt-stack">
                <FormSwitch title="Включить плагин" value={data.enabled} disabled={busy} hideBorder onChange={enabled => report(() => saveData(d => ({ ...d, enabled })))} />
                <ScopeSettings report={report} />
                <fieldset className="csdt-stack"><legend>Приветствие</legend>
                    <FormSwitch title="Предлагать при пустом поле" value={data.greeting.enabled} disabled={busy} hideBorder onChange={enabled => report(() => saveData(d => ({ ...d, greeting: { ...d.greeting, enabled } })))} />
                    <label>Шаблон<SearchableSelect className="csdt-select" value={data.greeting.templateId ?? ""} options={[
                        { value: "", label: "Не выбран" }, ...data.templates.map(t => ({ value: t.id, label: t.name }))
                    ]} closeOnSelect clearable={false} maxVisibleItems={6} onChange={value => report(() => saveData(d => ({ ...d, greeting: { ...d.greeting, templateId: value || null } })))} /></label>
                </fieldset>
                {getCatalog().length > 0 && <fieldset className="csdt-stack"><legend>Готовые шаблоны</legend>
                    <Button variant="secondary" onClick={openCatalog}>Выбрать из набора</Button>
                </fieldset>}
            </fieldset>}</div>
        </Modal>;
    }
    ownedModal(props => <Settings {...props} />);
}

function CatalogCard({ template, added, checked, onChange, query }: { template: Template; added: boolean; checked: boolean; onChange: (checked: boolean) => void; query: string }) {
    const [expanded, setExpanded] = useState(false);
    return <article className="csdt-card csdt-stack">
        <label className="csdt-check"><input type="checkbox" checked={checked} disabled={added} onChange={e => onChange(e.target.checked)} /><strong><Highlight text={template.name} query={query} /></strong>{added && <span className="csdt-catalog-badge">Уже добавлен</span>}</label>
        <p className="csdt-snippet"><Highlight text={matchingSnippet(template.text, query)} query={query} /></p>
        <div><Button variant="secondary" size="small" onClick={() => setExpanded(!expanded)}>{expanded ? "Скрыть текст" : "Предпросмотр"}</Button></div>
        {expanded && <div className="csdt-preview"><FormattedText text={template.text} /></div>}
    </article>;
}

function openCatalog() {
    function Catalog(props: RenderModalProps) {
        const { data, error: storageError } = useData();
        const catalog = React.useMemo(getCatalog, []);
        const [selected, setSelected] = useState<Set<string>>(() => new Set());
        const [query, setQuery] = useState("");
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState("");
        const [status, setStatus] = useState("");
        const available = data ? catalog.filter(template => !catalogHasTemplate(data, template)) : [];
        const chosen = available.filter(template => selected.has(template.id));
        const items = query.trim() ? search(catalog, query, 1) : catalog;
        async function add(ids: string[]) {
            setBusy(true); setError(""); setStatus("");
            try {
                let count = 0;
                await saveData(old => {
                    const next = addFromCatalog(old, catalog, ids);
                    count = next.templates.length - old.templates.length;
                    return next;
                });
                setStatus(count ? `Добавлено: ${count}` : "Выбранные шаблоны уже добавлены");
                setSelected(new Set());
            } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
        }
        return <Modal {...props} title="Набор шаблонов Luf" size="lg" notice={error || storageError ? { type: "critical", message: error || storageError! } : undefined} actions={[
            { text: "Закрыть", variant: "secondary", disabled: busy, onClick: props.onClose },
            { text: `Добавить выбранные (${chosen.length})`, variant: "primary", disabled: busy || !chosen.length, onClick: () => { void add(chosen.map(template => template.id)); } },
            { text: `Добавить все (${available.length})`, variant: "secondary", disabled: busy || !available.length, onClick: () => { void add(available.map(template => template.id)); } }
        ]}>
            <div className="csdt csdt-stack">
                <p className="csdt-muted">Добавляются к вашим шаблонам. Совпадающие копии пропускаются.</p>
                <label>Поиск<input className="csdt-input" value={query} onChange={e => setQuery(e.target.value)} /></label>
                <div className="csdt-actions"><Button variant="secondary" size="small" disabled={busy || !available.length} onClick={() => setSelected(chosen.length === available.length ? new Set() : new Set(available.map(template => template.id)))}>{chosen.length === available.length && available.length ? "Снять выбор" : "Выбрать все"}</Button></div>
                <p className="csdt-muted" role="status">{status || `В наборе: ${catalog.length} · Доступно: ${available.length}`}</p>
                <fieldset disabled={busy || !data} className="csdt-controls csdt-list">
                    {items.map(template => <CatalogCard key={template.id} template={template} added={Boolean(data && catalogHasTemplate(data, template))} checked={selected.has(template.id)} query={query} onChange={checked => setSelected(old => { const next = new Set(old); if (checked) next.add(template.id); else next.delete(template.id); return next; })} />)}
                    {!items.length && <p>Шаблоны не найдены.</p>}
                </fieldset>
            </div>
        </Modal>;
    }
    ownedModal(props => <Catalog {...props} />);
}

export const ComposerPanel = ErrorBoundary.wrap((props: Composer) => {
    const state = useData();
    const expressionOpen = ExpressionPickerStore.useExpressionPickerStore(s => s.activeView != null && s.activeChannelId === props.channel.id);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [popup, setPopup] = useState(false);
    const [rect, setRect] = useState<DOMRect>();
    const [theme, setTheme] = useState<React.CSSProperties>({});
    const [greetingActivated, setGreetingActivated] = useState(false);
    const main = props.type.analyticsName === "normal" && Boolean(props.channel.guild_id);
    useLayoutEffect(() => {
        if (state.active && main) registerComposer(props);
        return () => { if (composer === props) registerComposer({ ...props, disabled: true }); };
    });
    useEffect(() => { setError(""); }, [props.textValue, props.channel.id]);
    useEffect(() => {
        setGreetingActivated(false);
        if (!state.active || !main || !state.data?.enabled) return;
        const root = props.containerRef.current;
        if (!root) return;
        const update = () => {
            setRect(root.getBoundingClientRect());
            setPopup(nativePopup(props));
            // The body portal is outside Discord's theme container. Copy resolved
            // colors from the composer so the panel keeps its actual theme.
            const computed = getComputedStyle(root);
            const color = (...names: string[]) => names.map(name => computed.getPropertyValue(name).trim()).find(Boolean);
            const next = {
                "--csdt-surface": color("--background-surface-high", "--background-base-low", "--background-secondary", "--card-background-default") || "Canvas",
                "--csdt-card": color("--background-surface-higher", "--background-base-lower", "--card-background-default", "--background-primary") || "Canvas",
                "--csdt-text": color("--text-default", "--text-normal") || computed.color,
                "--csdt-subtle": color("--text-subtle", "--text-muted", "--text-default") || computed.color,
                "--csdt-border": color("--border-normal", "--border-subtle", "--background-modifier-accent") || computed.color,
                "--csdt-hover": color("--background-mod-subtle", "--background-modifier-hover", "--background-surface-higher", "--card-background-default") || "Canvas",
                colorScheme: computed.colorScheme,
                fontFamily: computed.fontFamily
            } as React.CSSProperties;
            setTheme(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
        };
        const start = (e: Event) => { if (root.contains(e.target as Node)) setComposing(true); };
        const end = (e: Event) => { if (root.contains(e.target as Node)) setComposing(false); };
        const activateGreeting = (e: PointerEvent) => {
            if (e.isTrusted && e.button === 0 && e.target instanceof HTMLElement && e.target.isContentEditable) setGreetingActivated(true);
        };
        const blurGreeting = (e: FocusEvent) => {
            if (e.target instanceof HTMLElement && e.target.isContentEditable) setGreetingActivated(false);
        };
        root.addEventListener("compositionstart", start); root.addEventListener("compositionend", end);
        root.addEventListener("pointerdown", activateGreeting, true); root.addEventListener("focusout", blurGreeting);
        const observer = new ResizeObserver(update); observer.observe(root);
        window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
        const interval = setInterval(update, 120);
        update();
        let cleaned = false;
        const clean = () => {
            if (cleaned) return; cleaned = true;
            observer.disconnect(); clearInterval(interval);
            root.removeEventListener("compositionstart", start); root.removeEventListener("compositionend", end);
            root.removeEventListener("pointerdown", activateGreeting, true); root.removeEventListener("focusout", blurGreeting);
            window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true);
        };
        const unregister = onCleanup(clean);
        return () => { unregister(); clean(); };
    }, [state.active, state.data?.enabled, state.generation, props.channel.id, main]);
    if (!main || !state.active || !state.data || !props.focused || !rect || rect.top < 70 || rect.top > window.innerHeight || insertionReason(props) || popup || nativePopup(props) || expressionOpen || composing || busy) return null;
    const selection = templateSearch(props);
    const { query } = selection;
    // Give commands, mentions, emoji and sticker autocompletion priority even before its popup mounts.
    if (/^(?:\s*\/)|(?:^|\s)[@#:]\S*$/u.test(query)) return null;
    const items = selection.mode === "paused" ? [] : suggestions(state.data, query, selection.mode === "initial" && greetingActivated);
    if (!items.length && selection.mode === "initial") return null;
    const width = Math.min(rect.width, window.innerWidth - 16);
    return ReactDOM.createPortal(<div className="csdt csdt-suggestions" style={{ ...theme, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), bottom: window.innerHeight - rect.top + 5, width, maxHeight: Math.min(320, rect.top - 16) }}>
        <div className="csdt-panel-header"><span className="csdt-panel-title">CYBERSHOKE Discord Tickets <span className="csdt-author">by Luf</span></span><div className="csdt-actions">
            {selection.mode === "paused" && <Button className="csdt-preview-button" size="small" variant="secondary" onMouseDown={e => e.preventDefault()} onClick={() => {
                try { beginAdditionalTemplate(props); setError(""); } catch (e) { setError(messageOf(e)); }
            }}>Добавить ещё шаблон</Button>}
            {selection.mode === "append" && <Button className="csdt-preview-button" size="small" variant="secondary" onMouseDown={e => e.preventDefault()} onClick={cancelAdditionalTemplate}>Отмена поиска</Button>}
            <Button className="csdt-preview-button" size="small" variant="secondary" onMouseDown={e => e.preventDefault()} onClick={() => openLibrary(props)}>Все шаблоны</Button>
        </div></div>
        {error && <p role="alert" className="csdt-warning">{error}</p>}
        {selection.mode === "append" && !items.length && <p className="csdt-muted">{query.trim().length < 2 ? "Введите запрос для следующего шаблона…" : "Нет совпадений"}</p>}
        {items.map(t => <div className="csdt-suggestion" key={t.id} onMouseDown={e => e.preventDefault()}>
            <button className="csdt-choice" onClick={async () => {
                setBusy(true); setError("");
                try { await insertTemplate(t, props); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
            }}><strong><Highlight text={t.name} query={query} /></strong><span className="csdt-snippet"><Highlight text={matchingSnippet(t.text, query)} query={query} /></span></button>
            <Button className="csdt-preview-button" size="small" variant="secondary" onClick={() => openPreview(t, props)}>Предпросмотр</Button>
        </div>)}
    </div>, document.body);
}, { noop: true });
