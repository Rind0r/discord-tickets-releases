/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Luf
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import bundled from "./catalog.json";
import { Data, mergeImport, newId, Template, validateTransfer } from "./core";

export function getCatalog(): Template[] {
    if (bundled.templates.length) throw new Error("CSDT_PUBLIC_EMPTY_CATALOG_V1: личные шаблоны нельзя включать в сборку.");
    return validateTransfer({ ...bundled, greeting: { enabled: false, templateId: null } }).templates;
}
export function catalogHasTemplate(data: Data, template: Template): boolean {
    return data.templates.some(own => own.name === template.name && own.text === template.text);
}
export function addFromCatalog(data: Data, catalog: Template[], selectedIds: string[], createId = newId): Data {
    const validated = validateTransfer({ version: 1, templates: catalog, greeting: { enabled: false, templateId: null } });
    const selected = new Set(selectedIds);
    if (selectedIds.some(id => !validated.templates.some(template => template.id === id))) throw new Error("В наборе нет одного из выбранных шаблонов.");
    const templates = validated.templates.filter(template => selected.has(template.id) && !catalogHasTemplate(data, template));
    if (!templates.length) return data;
    const added = mergeImport(data, { version: 1, templates, greeting: { enabled: false, templateId: null } }, "add", createId);
    return { ...added, greeting: { ...data.greeting } };
}
