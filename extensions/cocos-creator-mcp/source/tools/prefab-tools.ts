import { ToolCategory, ToolDefinition, ToolResult } from "../types";
import { ok, err } from "../tool-base";
import { ensureSceneSafeToSwitch, safeSaveScene } from "./scene-tools";
import { parseMaybeJson } from "../utils";
import type { ComponentTools } from "./component-tools";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const EXT_NAME = "cocos-creator-mcp";

/** prefab_instantiate で配置したネスト Prefab 情報を記憶 */
interface NestedPrefabEntry {
    nodeUuid: string;
    prefabAssetUuid: string;
    parentUuid: string;
}

export class PrefabTools implements ToolCategory {
    readonly categoryName = "prefab";
    private _pendingNestedPrefabs: NestedPrefabEntry[] = [];
    /** prefab_open で開いた Prefab アセット UUID */
    private _currentPrefabUuid: string | null = null;
    private _componentTools: ComponentTools | null;

    constructor(componentTools?: ComponentTools) {
        this._componentTools = componentTools ?? null;
    }

    getTools(): ToolDefinition[] {
        return [
            {
                name: "prefab_create",
                description: "Create a prefab. Modes: 'simple' (default — extract a node into a prefab, original node stays in scene; needs uuid + path), 'replace' (extract + replace original node with a prefab instance, recommended for nested prefabs; needs uuid + path), 'from_spec' (build node tree + auto-bind + create in one call from a JSON spec; needs path + spec [+ autoBindMode]).",
                inputSchema: {
                    type: "object",
                    properties: {
                        mode: { type: "string", description: "'simple' (default) | 'replace' | 'from_spec'" },
                        uuid: { type: "string", description: "Node UUID (mode=simple|replace)" },
                        path: { type: "string", description: "db:// path for the new prefab" },
                        spec: { description: "Node tree spec (mode=from_spec) — see node_create_tree format + optional autoBind field" },
                        autoBindMode: { type: "string", enum: ["fuzzy", "strict"], description: "Auto-bind matching mode (mode=from_spec, default fuzzy)" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "prefab_instantiate",
                description: "Instantiate a prefab into the scene.",
                inputSchema: {
                    type: "object",
                    properties: {
                        prefabUuid: { type: "string", description: "Prefab asset UUID" },
                        parent: { type: "string", description: "Parent node UUID (optional, defaults to scene root)" },
                    },
                    required: ["prefabUuid"],
                },
            },
            {
                name: "prefab_update",
                description: "Update (re-save) a prefab from its instance node in the scene.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uuid: { type: "string", description: "Node UUID of the prefab instance in the scene" },
                    },
                    required: ["uuid"],
                },
            },
            {
                name: "prefab_duplicate",
                description: "Duplicate a prefab asset to a new path.",
                inputSchema: {
                    type: "object",
                    properties: {
                        source: { type: "string", description: "Source prefab db:// path" },
                        destination: { type: "string", description: "Destination db:// path" },
                    },
                    required: ["source", "destination"],
                },
            },
            {
                name: "prefab_validate",
                description: "Validate a prefab for missing references or broken links.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uuid: { type: "string", description: "Prefab asset UUID" },
                    },
                    required: ["uuid"],
                },
            },
            {
                name: "prefab_revert",
                description: "Revert a prefab instance node to its original prefab state.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uuid: { type: "string", description: "Node UUID of the prefab instance" },
                    },
                    required: ["uuid"],
                },
            },
            {
                name: "prefab_edit",
                description: "Enter / exit prefab editing mode. Actions: 'open' (uuid or path [+ force]) — equivalent to double-clicking the prefab; 'close' ([+ save] [+ sceneUuid] [+ force]) — save & exit edit mode and return to a scene. dirty-untitled preflight applies as with scene_manage.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'open' | 'close'" },
                        uuid: { type: "string", description: "Prefab asset UUID (action=open)" },
                        path: { type: "string", description: "Prefab db:// path (action=open, alternative to uuid)" },
                        save: { type: "boolean", description: "Save prefab before closing (action=close, default true)" },
                        sceneUuid: { type: "string", description: "Scene UUID to return to on close (default: start scene)" },
                        force: { type: "boolean", description: "Skip dirty-scene preflight" },
                    },
                    required: ["action"],
                },
            },
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<ToolResult> {
        switch (toolName) {
            case "prefab_create": {
                const mode = args.mode || "simple";
                if (mode === "simple") {
                    if (!args.uuid) return err("prefab_create(simple): 'uuid' is required");
                    return this.createPrefab(args.uuid, args.path);
                }
                if (mode === "replace") {
                    if (!args.uuid) return err("prefab_create(replace): 'uuid' is required");
                    return this.createAndReplace(args.uuid, args.path);
                }
                if (mode === "from_spec") {
                    if (!args.spec) return err("prefab_create(from_spec): 'spec' is required");
                    return this.createFromSpec(args.path, parseMaybeJson(args.spec), args.autoBindMode ?? "fuzzy");
                }
                return err(`Unknown prefab_create mode: ${mode}. Expected simple / replace / from_spec.`);
            }
            case "prefab_instantiate":
                return this.instantiatePrefab(args.prefabUuid, args.parent);
            case "prefab_update":
                return this.updatePrefab(args.uuid);
            case "prefab_duplicate": {
                try {
                    await (Editor.Message.request as any)("asset-db", "copy-asset", args.source, args.destination);
                    return ok({ success: true, source: args.source, destination: args.destination });
                } catch (e: any) { return err(e.message || String(e)); }
            }
            case "prefab_validate": {
                try {
                    const info = await (Editor.Message.request as any)("asset-db", "query-asset-info", args.uuid);
                    const deps = await (Editor.Message.request as any)("asset-db", "query-depends", args.uuid).catch(() => []);
                    return ok({ success: true, uuid: args.uuid, info, dependencies: deps, valid: !!info });
                } catch (e: any) { return err(e.message || String(e)); }
            }
            case "prefab_revert":
                return this.revertPrefab(args.uuid);
            case "prefab_edit":
                if (args.action === "open") return this.openPrefab(args.uuid, args.path, !!args.force);
                if (args.action === "close") return this.closePrefab(args.save !== false, args.sceneUuid, !!args.force);
                return err(`Unknown prefab_edit action: ${args.action}. Expected 'open' or 'close'.`);
            default:
                return err(`Unknown tool: ${toolName}`);
        }
    }

    private async listPrefabs(): Promise<ToolResult> {
        try {
            const results = await Editor.Message.request("asset-db", "query-assets", {
                pattern: "db://assets/**/*.prefab",
            });
            const prefabs = (results || []).map((a: any) => ({
                uuid: a.uuid,
                path: a.path || a.url,
                name: a.name,
            }));
            return ok({ success: true, prefabs });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async createPrefab(nodeUuid: string, path: string): Promise<ToolResult> {
        try {
            // 既存Prefabがある場合は警告を返す（上書きダイアログでタイムアウトするため）
            const existing = await this.assetExists(path);
            if (existing) {
                return err(
                    `Prefab already exists at "${path}". Use prefab_update instead to update an existing prefab. ` +
                    `Workflow: 1) prefab_instantiate to place in scene, 2) modify properties, 3) prefab_update to save.`
                );
            }
            const result = await (Editor.Message.request as any)("scene", "create-prefab", nodeUuid, path);
            return ok({ success: true, nodeUuid, path, result });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async assetExists(path: string): Promise<boolean> {
        try {
            const pattern = path.replace(/\.prefab$/, "") + ".*";
            const results = await Editor.Message.request("asset-db", "query-assets", { pattern });
            return (results || []).length > 0;
        } catch {
            try {
                const info = await (Editor.Message.request as any)("asset-db", "query-asset-info", path);
                return !!info;
            } catch {
                return false;
            }
        }
    }

    private async instantiatePrefab(prefabUuid: string, parent?: string): Promise<ToolResult> {
        try {
            const nodeUuid = await Editor.Message.request("scene", "create-node", {
                parent: parent || undefined,
                assetUuid: prefabUuid,
            });

            // Prefab 編集モード中の場合、ネスト Prefab 情報を記憶
            // prefab_update 時に JSON 後処理で asset/instance/nestedPrefabInstanceRoots を設定
            if (parent) {
                this._pendingNestedPrefabs.push({
                    nodeUuid,
                    prefabAssetUuid: prefabUuid,
                    parentUuid: parent,
                });
            }

            return ok({ success: true, nodeUuid, prefabUuid });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }


    private async updatePrefab(nodeUuid: string): Promise<ToolResult> {
        try {
            const result = await (Editor.Message.request as any)("scene", "apply-prefab", nodeUuid);

            // ネスト Prefab の JSON 後処理
            if (this._pendingNestedPrefabs.length > 0) {
                await this._fixNestedPrefabJson(nodeUuid);
            }

            return ok({ success: true, nodeUuid, result });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    /**
     * prefab_update 後に Prefab JSON を後処理して、ネスト Prefab 参照を正しく設定する.
     */
    private async _fixNestedPrefabJson(_rootNodeUuid: string): Promise<void> {
        if (this._pendingNestedPrefabs.length === 0) return;

        try {
            // シーンを保存して Prefab JSON を書き出す
            // 現在シーンが untitled (scene-2d) の場合、save-scene はダイアログを出すので
            // safeSaveScene でスキップする。untitled でシーンにインスタンスが居るケースは
            // 本来 prefab_open モードでのみ発生するので save が効く想定だが、
            // テスト等で直接呼ばれた場合の保護として skip する。
            const saved = await safeSaveScene();
            if (!saved) {
                console.warn(
                    "[PrefabTools] _fixNestedPrefabJson: save-scene skipped (untitled scene). " +
                    "Nested prefab JSON post-processing may be incomplete."
                );
                return;
            }
            await new Promise(r => setTimeout(r, 1500));

            // prefab_open で記憶した UUID からファイルパスを取得
            if (!this._currentPrefabUuid) return;

            const prefabPath = await (Editor.Message.request as any)(
                "asset-db", "query-path", this._currentPrefabUuid
            );
            if (!prefabPath) return;
            if (!fs.existsSync(prefabPath)) return;

            const data = JSON.parse(fs.readFileSync(prefabPath, "utf-8"));

            // 各ネスト Prefab エントリを処理
            for (const entry of this._pendingNestedPrefabs) {
                // fileId でノードを検索（nodeUuid はシーン内 UUID、Prefab JSON 内では fileId）
                let flpNodeIdx = -1;
                for (let i = 0; i < data.length; i++) {
                    if (data[i].__type__ === "cc.PrefabInfo" && data[i].fileId === entry.nodeUuid) {
                        // この PrefabInfo を持つノードを探す
                        for (let j = 0; j < data.length; j++) {
                            if (data[j]._prefab?.__id__ === i) {
                                flpNodeIdx = j;
                                break;
                            }
                        }
                        break;
                    }
                }

                // fileId で見つからない場合、ノード名で検索
                if (flpNodeIdx < 0) {
                    // Prefab アセット名を取得
                    const assetInfo = await (Editor.Message.request as any)("asset-db", "query-asset-info", entry.prefabAssetUuid);
                    const assetName = assetInfo?.name?.replace(".prefab", "") || "";
                    for (let i = 0; i < data.length; i++) {
                        if (data[i].__type__ === "cc.Node" && (data[i]._name === assetName || data[i]._name === undefined)) {
                            const prefabIdx = data[i]._prefab?.__id__;
                            if (prefabIdx != null && data[prefabIdx]?.asset?.__id__ === 0 && !data[prefabIdx]?.instance) {
                                flpNodeIdx = i;
                                break;
                            }
                        }
                    }
                }

                if (flpNodeIdx < 0) continue;

                const prefabInfoIdx = data[flpNodeIdx]._prefab?.__id__;
                if (prefabInfoIdx == null) continue;

                // PrefabInfo を修正
                const prefabInfo = data[prefabInfoIdx];
                prefabInfo.root = { __id__: flpNodeIdx };
                prefabInfo.asset = {
                    __uuid__: entry.prefabAssetUuid,
                    __expectedType__: "cc.Prefab",
                };

                // PrefabInstance を追加
                if (!prefabInfo.instance) {
                    const instanceIdx = data.length;
                    data.push({
                        __type__: "cc.PrefabInstance",
                        fileId: crypto.randomBytes(16).toString("base64").replace(/[+/=]/g, "").substring(0, 22),
                        prefabRootNode: { __id__: 1 }, // Prefab 編集モードのルート
                        mountedChildren: [],
                        mountedComponents: [],
                        propertyOverrides: [],
                        removedComponents: [],
                    });
                    prefabInfo.instance = { __id__: instanceIdx };
                }

                // 子ノード・コンポーネントをクリア（Prefab アセットから復元される）
                data[flpNodeIdx]._children = [];
                data[flpNodeIdx]._components = [];

                // ルートの nestedPrefabInstanceRoots に追加
                const rootPrefabIdx = data[1]._prefab?.__id__;
                if (rootPrefabIdx != null) {
                    const rootPrefab = data[rootPrefabIdx];
                    if (!rootPrefab.nestedPrefabInstanceRoots) {
                        rootPrefab.nestedPrefabInstanceRoots = [];
                    }
                    const alreadyNested = rootPrefab.nestedPrefabInstanceRoots.some(
                        (r: any) => r?.__id__ === flpNodeIdx
                    );
                    if (!alreadyNested) {
                        rootPrefab.nestedPrefabInstanceRoots.push({ __id__: flpNodeIdx });
                    }
                }
            }

            fs.writeFileSync(prefabPath, JSON.stringify(data, null, 2), "utf-8");
            this._pendingNestedPrefabs = [];
        } catch (e: any) {
            console.warn("[PrefabTools] _fixNestedPrefabJson failed:", e.message);
        }
    }

    private async revertPrefab(nodeUuid: string): Promise<ToolResult> {
        try {
            const result = await (Editor.Message.request as any)("scene", "revert-prefab", nodeUuid);
            return ok({ success: true, nodeUuid, result });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async getPrefabInfo(uuid: string): Promise<ToolResult> {
        try {
            const info = await (Editor.Message.request as any)("asset-db", "query-asset-info", uuid);
            return ok({ success: true, info });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async createAndReplace(nodeUuid: string, path: string): Promise<ToolResult> {
        try {
            // 1. Check if prefab already exists
            const existing = await this.assetExists(path);
            if (existing) {
                return err(
                    `Prefab already exists at "${path}". Delete it first or use a different path.`
                );
            }

            // 2. Get node info (parent, sibling index, transform) before creating prefab
            const nodeInfo = await this.sceneScript("getNodeInfo", [nodeUuid]);
            if (!nodeInfo?.success) {
                return err(`Node ${nodeUuid} not found`);
            }
            const parentUuid = nodeInfo.data?.parent;

            // 3. Create prefab from the node
            const prefabAssetUuid = await (Editor.Message.request as any)("scene", "create-prefab", nodeUuid, path);
            if (!prefabAssetUuid) {
                return err("create-prefab returned no asset UUID");
            }

            // 4. Delete the original node
            await (Editor.Message.request as any)("scene", "remove-node", { uuid: nodeUuid });

            // 5. Instantiate the prefab at the same parent
            const newNodeUuid = await Editor.Message.request("scene", "create-node", {
                parent: parentUuid || undefined,
                assetUuid: prefabAssetUuid,
            });

            return ok({
                success: true,
                prefabAssetUuid,
                prefabPath: path,
                originalNodeUuid: nodeUuid,
                newInstanceUuid: newNodeUuid,
            });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async openPrefab(uuid?: string, path?: string, force: boolean = false): Promise<ToolResult> {
        try {
            // Prefab を開くときも内部的にシーン切替が発生するので dirty untitled チェック
            await ensureSceneSafeToSwitch(force);

            // Resolve UUID from path if needed
            let assetUuid = uuid;
            if (!assetUuid && path) {
                const info = await (Editor.Message.request as any)("asset-db", "query-asset-info", path);
                assetUuid = info?.uuid;
            }
            if (!assetUuid) {
                return err("Either uuid or path is required");
            }

            // Open prefab in editing mode (equivalent to double-click)
            await (Editor.Message.request as any)("asset-db", "open-asset", assetUuid);
            // Wait for prefab editing mode to initialize
            await new Promise(r => setTimeout(r, 1000));

            this._currentPrefabUuid = assetUuid;
            this._pendingNestedPrefabs = [];

            return ok({ success: true, uuid: assetUuid, mode: "prefab-edit" });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async closePrefab(save: boolean, sceneUuid?: string, force: boolean = false): Promise<ToolResult> {
        try {
            // 1. Save prefab if requested
            // prefab edit モード中は "current scene" = 編集中 Prefab なので save-scene は Prefab を保存する。
            // ただし untitled フォールバックに当たった場合はダイアログ回避のためスキップする。
            if (save) {
                await safeSaveScene();
                await new Promise(r => setTimeout(r, 500));
            }

            // 2. Determine which scene to return to
            let targetScene = sceneUuid;
            if (!targetScene) {
                // Try project's start scene
                try {
                    targetScene = await (Editor as any).Profile.getConfig("preview", "general.start_scene", "local");
                } catch { /* ignore */ }

                // Fallback to first scene
                if (!targetScene || targetScene === "current_scene") {
                    const scenes = await Editor.Message.request("asset-db", "query-assets", {
                        ccType: "cc.SceneAsset",
                        pattern: "db://assets/**/*",
                    });
                    if (Array.isArray(scenes) && scenes.length > 0) {
                        targetScene = scenes[0].uuid;
                    }
                }
            }

            // 3. Open the scene
            if (targetScene) {
                // prefab edit モードから戻る遷移もダイアログが出うる
                await ensureSceneSafeToSwitch(force);
                await (Editor.Message.request as any)("scene", "open-scene", targetScene);
                await new Promise(r => setTimeout(r, 1000));
            }

            return ok({ success: true, returnedToScene: targetScene });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async createFromSpec(prefabPath: string, spec: any, autoBindMode: string): Promise<ToolResult> {
        try {
            // 1. 既存 Prefab チェック
            const existing = await this.assetExists(prefabPath);
            if (existing) {
                return err(
                    `Prefab already exists at "${prefabPath}". Delete it first or use a different path.`
                );
            }

            // 2. シーンの最初の cc.Node UUID を取得（Scene UUID ではなく Canvas 等）
            const hier = await this.sceneScript("getSceneHierarchy", [false]);
            const hierarchy = hier?.hierarchy || [];
            const firstNode = hierarchy[0];
            if (!firstNode?.uuid) return err("Could not find a node in the current scene to use as parent");
            const parentUuid = firstNode.uuid;

            // 3. ノードツリーを構築
            const autoBind = spec.autoBind;
            const cleanSpec = { ...spec };
            delete cleanSpec.autoBind;

            const treeResult = await this.sceneScript("buildNodeTree", [parentUuid, cleanSpec]);
            if (!treeResult?.success) return err(treeResult?.error || "buildNodeTree failed");
            const nodeUuid = treeResult.data?.uuid;
            if (!nodeUuid) return err("buildNodeTree returned no root node UUID");

            // 4. フォント・SpriteFrame を Editor API 経由で設定（アセット依存追跡のため）
            await this._applyDefaultAssets(nodeUuid);

            // 4b. v2.0.0: spec.properties を Editor API 経由で再設定する
            //     buildNodeRecursive は scene-process 内で `comp[propName] = value` で代入するが、
            //     これだと asset ref (UUID 文字列) が raw 文字列のまま .prefab に書き出され、
            //     runtime で `{__uuid__, __expectedType__}` 形式に解決されないバグがある。
            //     component_set_property 経由で再設定することで Editor が正しい dump 形式で
            //     シリアライズしてくれる。値型 (Vec3/Color/Size) や enum 名なども透過的に解決される。
            await this._reapplyPropertiesViaEditor(treeResult.data, cleanSpec);

            // 5. autoBind 実行 (旧4)
            let autoBindResult: any = null;
            if (autoBind) {
                if (!this._componentTools) {
                    return err("autoBind requires ComponentTools dependency (internal configuration error)");
                }
                const bindToolResult = await this._componentTools.execute("component_auto_bind", {
                    uuid: nodeUuid,
                    componentType: autoBind,
                    force: false,
                    mode: autoBindMode,
                });
                try {
                    autoBindResult = JSON.parse(bindToolResult.content[0].text);
                } catch { autoBindResult = bindToolResult; }
            }

            // 6. Prefab 作成
            const prefabAssetUuid = await (Editor.Message.request as any)(
                "scene", "create-prefab", nodeUuid, prefabPath
            );
            if (!prefabAssetUuid) {
                await (Editor.Message.request as any)("scene", "remove-node", { uuid: nodeUuid });
                return err("create-prefab returned no asset UUID");
            }

            // 7. 一時ノードを削除
            await (Editor.Message.request as any)("scene", "remove-node", { uuid: nodeUuid });

            return ok({
                success: true,
                prefabAssetUuid,
                path: prefabPath,
                nodeTree: treeResult.data,
                autoBind: autoBindResult,
            });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    /**
     * buildNodeTree で作成したノードツリーの Label にプロジェクトフォントを設定する。
     * Editor API (scene:set-property) 経由で設定することでアセット依存が正しく追跡される。
     */
    private async _applyDefaultAssets(rootUuid: string): Promise<void> {
        // プロジェクトのデフォルトフォントを検索（resources/fonts/ 配下の TTFFont）
        let fontUuid: string | null = null;
        try {
            const assets = await Editor.Message.request("asset-db", "query-assets", {
                pattern: "db://assets/resources/fonts/**",
                ccType: "cc.TTFFont",
            });
            if (Array.isArray(assets) && assets.length > 0) {
                fontUuid = assets[0].uuid;
            }
        } catch { /* ignore */ }

        if (!fontUuid) return;

        // 全子孫ノードを取得
        const descendants = await this.sceneScript("getAllDescendants", [rootUuid]);
        if (!descendants?.success) return;
        const allNodes = [{ uuid: rootUuid, name: "root" }, ...descendants.data];

        for (const node of allNodes) {
            try {
                const nodeDump = await (Editor.Message.request as any)("scene", "query-node", node.uuid);
                if (!nodeDump) continue;
                const comps = nodeDump.__comps__ || [];
                for (let i = 0; i < comps.length; i++) {
                    const compType = comps[i].type || "";
                    // Label にフォント設定
                    if (compType === "cc.Label") {
                        const fontDump = comps[i].value?.font;
                        if (!fontDump?.value?.uuid) {
                            await (Editor.Message.request as any)("scene", "set-property", {
                                uuid: node.uuid,
                                path: `__comps__.${i}.font`,
                                dump: { type: "cc.TTFFont", value: { uuid: fontUuid } },
                            });
                        }
                    }
                }
            } catch { /* skip nodes that can't be queried */ }
        }
    }

    /**
     * v2.0.0: spec.properties を Editor API (component_set_property) 経由で再設定する。
     *
     * buildNodeRecursive (scene.ts) は `comp[propName] = value` で代入するが、asset ref
     * を含むプロパティは Editor シリアライザを通らないため .prefab JSON に raw UUID
     * 文字列として書き出されてしまう (README Known Limitation 解消)。
     *
     * 本メソッドは nodeTree と spec を平行 walk して、各ノードの properties を再設定する。
     * ComponentTools の buildDumpWithTypeInfo が型解決を行うため、UUID/path/{path,guid}/
     * enum 名/Vec3/Color などをそのまま渡せる。
     */
    private async _reapplyPropertiesViaEditor(nodeTree: any, spec: any): Promise<void> {
        if (!this._componentTools || !nodeTree?.uuid || !spec) return;

        if (spec.properties && typeof spec.properties === "object") {
            for (const [key, value] of Object.entries(spec.properties)) {
                const dotIdx = key.lastIndexOf(".");
                if (dotIdx < 0) continue;
                const compType = key.substring(0, dotIdx);
                const propName = key.substring(dotIdx + 1);
                // contentSize は scene.ts 側で setContentSize() で適切に処理済みなのでスキップ
                // (Editor 経由で再設定しても害はないが冗長)
                if (propName === "contentSize") continue;
                try {
                    await this._componentTools.execute("component_set_property", {
                        uuid: nodeTree.uuid,
                        componentType: compType,
                        property: propName,
                        value,
                    });
                } catch (_e) {
                    // 個別プロパティの失敗は無視して続行 (auto_bind 等で後から設定する場合あり)
                }
            }
        }

        const children = (nodeTree.children || []) as any[];
        const specChildren = (spec.children || []) as any[];
        for (let i = 0; i < Math.min(children.length, specChildren.length); i++) {
            await this._reapplyPropertiesViaEditor(children[i], specChildren[i]);
        }
    }

    private async sceneScript(method: string, args: any[]): Promise<any> {
        return Editor.Message.request("scene", "execute-scene-script", {
            name: "cocos-creator-mcp",
            method,
            args,
        });
    }
}
