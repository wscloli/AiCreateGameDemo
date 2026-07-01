import type { ResourceDef } from "./types";

/**
 * Resource definitions for v2.0.0. Each function delegates to Editor.Message
 * to fetch the underlying data — same logic as the corresponding read-only
 * tools, but exposed via URI instead of tool name.
 */

// ─── Scene ───

export const sceneCurrentResource: ResourceDef = {
    uri: "cocos://scene/current",
    name: "Current Scene",
    description: "Name and UUID of the currently open scene.",
    async read() {
        // query-current-scene は 3.8.x で動かないため query-node-tree のルートから取得
        const tree = await (Editor.Message.request as any)("scene", "query-node-tree");
        return {
            name: tree?.name,
            uuid: tree?.uuid,
        };
    },
};

export const sceneListResource: ResourceDef = {
    uri: "cocos://scene/list",
    name: "Scene List",
    description: "List of all .scene files in the project.",
    async read() {
        const assets = await (Editor.Message.request as any)("asset-db", "query-assets", {
            ccType: "cc.Scene",
        });
        return {
            scenes: (Array.isArray(assets) ? assets : []).map((a: any) => ({
                uuid: a.uuid,
                name: a.name,
                url: a.url,
            })),
        };
    },
};

export const sceneHierarchyResource: ResourceDef = {
    uri: "cocos://scene/hierarchy",
    name: "Scene Hierarchy",
    description: "Node tree of the currently open scene. Shallow (name, uuid, children) — for full dumps, use cocos://node/{uuid}.",
    async read() {
        const tree = await (Editor.Message.request as any)("scene", "query-node-tree");
        return { hierarchy: tree };
    },
};

// ─── Node / Component ───

export const nodeResource: ResourceDef = {
    uriTemplate: "cocos://node/{uuid}",
    name: "Node Dump",
    description: "Full property dump of a node by UUID. Includes components (__comps__).",
    async read({ uuid }) {
        const dump = await (Editor.Message.request as any)("scene", "query-node", uuid);
        if (!dump) throw new Error(`Node not found: ${uuid}`);
        return dump;
    },
};

export const nodeComponentsResource: ResourceDef = {
    uriTemplate: "cocos://node/{uuid}/components",
    name: "Node Components",
    description: "Components on a node (uuid + type) — lighter than the full node dump.",
    async read({ uuid }) {
        const dump = await (Editor.Message.request as any)("scene", "query-node", uuid);
        if (!dump) throw new Error(`Node not found: ${uuid}`);
        const comps = (dump.__comps__ || []).map((c: any) => ({
            uuid: c.value?.uuid?.value || c.uuid,
            type: c.type,
        }));
        return { uuid, components: comps };
    },
};

export const componentResource: ResourceDef = {
    uriTemplate: "cocos://component/{uuid}",
    name: "Component Dump",
    description: "Full property dump of a component by component UUID (not node UUID).",
    async read({ uuid }) {
        const dump = await (Editor.Message.request as any)("scene", "query-component", uuid);
        if (!dump) throw new Error(`Component not found: ${uuid}`);
        return dump;
    },
};

// ─── Prefab ───

export const prefabListResource: ResourceDef = {
    uri: "cocos://prefab/list",
    name: "Prefab List",
    description: "All prefabs in the project (uuid + path).",
    async read() {
        const assets = await (Editor.Message.request as any)("asset-db", "query-assets", {
            ccType: "cc.Prefab",
        });
        return {
            prefabs: (Array.isArray(assets) ? assets : []).map((a: any) => ({
                uuid: a.uuid,
                name: a.name,
                url: a.url,
            })),
        };
    },
};

export const prefabResource: ResourceDef = {
    uriTemplate: "cocos://prefab/{uuid}",
    name: "Prefab Info",
    description: "Asset info for a prefab by UUID.",
    async read({ uuid }) {
        const info = await (Editor.Message.request as any)("asset-db", "query-asset-info", uuid);
        if (!info) throw new Error(`Prefab not found: ${uuid}`);
        return info;
    },
};

// ─── Project / Editor ───

export const projectInfoResource: ResourceDef = {
    uri: "cocos://project/info",
    name: "Project Info",
    description: "Project name and root path.",
    async read() {
        return {
            name: Editor.Project.name,
            path: Editor.Project.path,
            tmpDir: Editor.Project.tmpDir,
        };
    },
};

export const projectEngineResource: ResourceDef = {
    uri: "cocos://project/engine",
    name: "Engine Info",
    description: "Engine version and engine path.",
    async read() {
        try {
            const info = await (Editor.Message.request as any)("engine", "query-info");
            return info || {};
        } catch {
            return {};
        }
    },
};

export const editorInfoResource: ResourceDef = {
    uri: "cocos://editor/info",
    name: "Editor Info",
    description: "Cocos Creator editor version, install path, and language.",
    async read() {
        return {
            version: Editor.App.version,
            path: Editor.App.path,
            home: Editor.App.home,
            language: Editor.I18n?.getLanguage?.() || "unknown",
        };
    },
};

// ─── Asset ───

export const assetResource: ResourceDef = {
    uriTemplate: "cocos://asset/{uuid}",
    name: "Asset Info",
    description: "Asset details by UUID (path, type, dependencies).",
    async read({ uuid }) {
        const info = await (Editor.Message.request as any)("asset-db", "query-asset-info", uuid);
        if (!info) throw new Error(`Asset not found: ${uuid}`);
        return info;
    },
};

export const ALL_RESOURCES: ResourceDef[] = [
    sceneCurrentResource,
    sceneListResource,
    sceneHierarchyResource,
    nodeResource,
    nodeComponentsResource,
    componentResource,
    prefabListResource,
    prefabResource,
    projectInfoResource,
    projectEngineResource,
    editorInfoResource,
    assetResource,
];
