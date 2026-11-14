/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Luf
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Parser, React, useRef } from "@webpack/common";

import { composer } from "./runtime";
import { Format, formatSelection } from "./text";

export const FormattedText = ErrorBoundary.wrap(({ text }: { text: string }) => {
    const deferredText = React.useDeferredValue(text);
    const channelId = composer?.channel.id;
    const parsed = React.useMemo(() => {
        try { return Parser.parse(deferredText, false, { channelId, allowLinks: true, allowHeading: true, allowList: true, allowEmojiLinks: false }); }
        catch { return deferredText; }
    }, [deferredText, channelId]);
    return <div className="csdt-rendered">{parsed}</div>;
}, { noop: false });

// Discord React is unavailable when Vencord first imports plugin modules.
const formats: { format: Format; title: string; label: string }[] = [
    { format: "bold", title: "Жирный (Ctrl+B)", label: "B" },
    { format: "italic", title: "Курсив (Ctrl+I)", label: "I" },
    { format: "underline", title: "Подчёркнутый (Ctrl+U)", label: "U" },
    { format: "strike", title: "Зачёркнутый", label: "S" },
    { format: "spoiler", title: "Спойлер", label: "||" },
    { format: "inlineCode", title: "Код в строке", label: "</>" },
    { format: "codeBlock", title: "Блок кода", label: "```" },
    { format: "quote", title: "Цитата", label: ">" },
    { format: "bullet", title: "Маркированный список", label: "•" },
    { format: "numbered", title: "Нумерованный список", label: "1." },
    { format: "h1", title: "Заголовок 1", label: "H1" },
    { format: "h2", title: "Заголовок 2", label: "H2" },
    { format: "h3", title: "Заголовок 3", label: "H3" },
    { format: "link", title: "Ссылка", label: "Ссылка" }
];

export const TemplateTextEditor = ErrorBoundary.wrap(({ text, onChange }: { text: string; onChange: (text: string) => void }) => {
    const textarea = useRef<HTMLTextAreaElement>(null);
    function apply(format: Format) {
        const input = textarea.current;
        const edited = formatSelection(text, input?.selectionStart ?? text.length, input?.selectionEnd ?? text.length, format);
        onChange(edited.text);
        requestAnimationFrame(() => { if (input?.isConnected) { input.focus(); input.setSelectionRange(edited.start, edited.end); } });
    }
    return <div className="csdt-stack">
        <div className="csdt-formatbar" role="toolbar" aria-label="Форматирование текста">
            {formats.map(item => <Button key={item.format} variant="secondary" size="small" className="csdt-format-button" data-format={item.format} title={item.title} aria-label={item.title} onMouseDown={e => e.preventDefault()} onClick={() => apply(item.format)}>{item.label}</Button>)}
            <Button variant="secondary" size="small" onMouseDown={e => e.preventDefault()} onClick={() => apply("mention")}>Упомянуть</Button>
        </div>
        <label>Текст<textarea ref={textarea} className="csdt-input csdt-textarea" rows={9} value={text} onChange={e => onChange(e.target.value)} onKeyDown={e => {
            if (e.nativeEvent.isComposing || !e.ctrlKey && !e.metaKey || e.altKey || e.shiftKey) return;
            const format = ({ KeyB: "bold", KeyI: "italic", KeyU: "underline" } as Record<string, Format>)[e.code];
            if (format) { e.preventDefault(); apply(format); }
        }} /></label>
        <div><div className="csdt-section-title">Предпросмотр</div><div className="csdt-preview"><FormattedText text={text} /></div></div>
    </div>;
}, { noop: false });
