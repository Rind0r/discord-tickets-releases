/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Luf
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { normalizeForSearch } from "./core";

export interface TextPart { text: string; match: boolean; }
function queryWords(query: string): string[] {
    return [...new Set(normalizeForSearch(query).split(" ").filter(Boolean))].sort((a, b) => b.length - a.length);
}
function matchPattern(query: string): RegExp | undefined {
    const words = queryWords(query);
    if (!words.length) return;
    return new RegExp(words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[её]/giu, "[её]")).join("|"), "giu");
}
export function highlightedParts(text: string, query: string): TextPart[] {
    const pattern = matchPattern(query);
    if (!pattern) return [{ text, match: false }];
    const parts: TextPart[] = [];
    let end = 0;
    for (const match of text.matchAll(pattern)) {
        const start = match.index;
        if (start > end) parts.push({ text: text.slice(end, start), match: false });
        parts.push({ text: match[0], match: true });
        end = start + match[0].length;
    }
    if (end < text.length) parts.push({ text: text.slice(end), match: false });
    return parts;
}
export function matchingSnippet(text: string, query: string, limit = 170): string {
    if (text.length <= limit) return text;
    const first = matchPattern(query)?.exec(text)?.index ?? 0;
    let start = Math.max(0, first - 40);
    let end = Math.min(text.length, start + limit);
    if (/[\uDC00-\uDFFF]/.test(text[start])) start++;
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export type Format = "bold" | "italic" | "underline" | "strike" | "spoiler" | "inlineCode" | "codeBlock" | "quote" | "bullet" | "numbered" | "h1" | "h2" | "h3" | "link" | "mention";
export interface EditResult { text: string; start: number; end: number; }
const wrappers: Partial<Record<Format, string>> = { bold: "**", italic: "*", underline: "__", strike: "~~", spoiler: "||", inlineCode: "`" };
export function formatSelection(text: string, start: number, end: number, format: Format): EditResult {
    start = Math.max(0, Math.min(text.length, start));
    end = Math.max(start, Math.min(text.length, end));
    const selected = text.slice(start, end);
    const replace = (from: number, to: number, value: string, a: number, b: number): EditResult => ({ text: text.slice(0, from) + value + text.slice(to), start: a, end: b });
    if (format === "mention") return replace(start, end, "{автор}", start + 7, start + 7);
    if (format === "link") {
        const value = `[${selected}](https://)`;
        return replace(start, end, value, selected ? start + selected.length + 3 : start + 1, selected ? start + value.length - 1 : start + 1);
    }
    if (format === "codeBlock") {
        const before = start > 0 && text[start - 1] !== "\n" ? "\n" : "";
        const after = end < text.length && text[end] !== "\n" ? "\n" : "";
        const prefix = `${before}\`\`\`\n`;
        return replace(start, end, `${prefix}${selected}\n\`\`\`${after}`, start + prefix.length, start + prefix.length + selected.length);
    }
    const wrapper = wrappers[format];
    if (wrapper) {
        if (start >= wrapper.length && text.slice(start - wrapper.length, start) === wrapper && text.slice(end, end + wrapper.length) === wrapper) {
            return replace(start - wrapper.length, end + wrapper.length, selected, start - wrapper.length, end - wrapper.length);
        }
        if (selected.length >= wrapper.length * 2 && selected.startsWith(wrapper) && selected.endsWith(wrapper)) {
            const unwrapped = selected.slice(wrapper.length, -wrapper.length);
            return replace(start, end, unwrapped, start, start + unwrapped.length);
        }
        return replace(start, end, wrapper + selected + wrapper, start + wrapper.length, end + wrapper.length);
    }
    const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
    const finalCharacter = end > start && text[end - 1] === "\n" ? end - 1 : end;
    const nextBreak = text.indexOf("\n", finalCharacter);
    const lineEnd = nextBreak < 0 ? text.length : nextBreak;
    const lines = text.slice(lineStart, lineEnd).split("\n");
    const prefix = format === "quote" ? "> " : format === "bullet" ? "- " : format === "numbered" ? "" : `${"#".repeat(Number(format.slice(1)))} `;
    const alreadyFormatted = lines.every(line => format === "numbered" ? /^\d+\. /u.test(line) : line.startsWith(prefix));
    const changed = lines.map((line, index) => alreadyFormatted ? format === "numbered" ? line.replace(/^\d+\. /u, "") : line.slice(prefix.length)
        : (format === "numbered" ? `${index + 1}. ` : prefix) + line).join("\n");
    const lengthDelta = changed.length - (lineEnd - lineStart);
    const firstDelta = changed.indexOf("\n") < 0 ? lengthDelta : changed.split("\n")[0].length - lines[0].length;
    return replace(lineStart, lineEnd, changed, Math.max(lineStart, start + firstDelta), Math.max(lineStart, end + lengthDelta));
}
