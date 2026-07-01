import { ToolCategory, ToolDefinition, ToolResult } from "../types";
import { ok, err } from "../tool-base";

export class AssetTools implements ToolCategory {
    readonly categoryName = "asset";

    getTools(): ToolDefinition[] {
        return [
            {
                name: "asset_manage",
                description: "CRUD-style asset operations on the asset database. Actions: 'create' (path[, content]), 'delete' (path), 'move' (source, destination), 'copy' (source, destination), 'save' (uuid), 'reimport' (path), 'import' (source disk path, target db:// path), 'save_meta' (uuid, meta JSON), 'open_external' (path).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'create' | 'delete' | 'move' | 'copy' | 'save' | 'reimport' | 'import' | 'save_meta' | 'open_external'" },
                        path: { type: "string", description: "db:// path (most actions)" },
                        source: { type: "string", description: "Source path (move/copy/import)" },
                        destination: { type: "string", description: "Destination db:// path (move/copy)" },
                        target: { type: "string", description: "Target db:// path (import)" },
                        uuid: { type: "string", description: "Asset UUID (save/save_meta)" },
                        content: { type: "string", description: "File content for new asset (create)" },
                        meta: { type: "string", description: "Meta JSON string (save_meta)" },
                    },
                    required: ["action"],
                },
            },
            {
                name: "asset_query",
                description: "Read-only asset queries. For full asset dumps use resource cocos://asset/{uuid}. Actions: 'path' (uuid→path), 'uuid' (path→uuid), 'url' (uuid→url), 'dependencies' (uuid), 'users' (uuid — assets referencing this), 'missing' (uuid — broken refs), 'ready' (asset-db readiness), 'generate_url' (non-conflicting db:// path), 'details' (info + meta dump).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'path' | 'uuid' | 'url' | 'dependencies' | 'users' | 'missing' | 'ready' | 'generate_url' | 'details'" },
                        uuid: { type: "string", description: "Asset UUID" },
                        path: { type: "string", description: "db:// path" },
                        url: { type: "string", description: "Desired db:// path (generate_url)" },
                    },
                    required: ["action"],
                },
            },
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<ToolResult> {
        try {
            switch (toolName) {
                case "asset_manage": return this.manage(args);
                case "asset_query": return this.query(args);
                default: return err(`Unknown tool: ${toolName}`);
            }
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async manage(args: Record<string, any>): Promise<ToolResult> {
        switch (args.action) {
            case "create":
                await (Editor.Message.request as any)("asset-db", "create-asset", args.path, args.content || null);
                return ok({ success: true, action: args.action, path: args.path });
            case "delete":
                await (Editor.Message.request as any)("asset-db", "delete-asset", args.path);
                return ok({ success: true, action: args.action, path: args.path });
            case "move":
                await (Editor.Message.request as any)("asset-db", "move-asset", args.source, args.destination);
                return ok({ success: true, action: args.action, source: args.source, destination: args.destination });
            case "copy":
                await (Editor.Message.request as any)("asset-db", "copy-asset", args.source, args.destination);
                return ok({ success: true, action: args.action, source: args.source, destination: args.destination });
            case "save":
                await (Editor.Message.request as any)("asset-db", "save-asset", args.uuid);
                return ok({ success: true, action: args.action, uuid: args.uuid });
            case "reimport":
                await (Editor.Message.request as any)("asset-db", "reimport-asset", args.path);
                return ok({ success: true, action: args.action, path: args.path });
            case "import":
                await (Editor.Message.request as any)("asset-db", "import-asset", args.source, args.target);
                return ok({ success: true, action: args.action, source: args.source, target: args.target });
            case "save_meta":
                await (Editor.Message.request as any)("asset-db", "save-asset-meta", args.uuid, args.meta);
                return ok({ success: true, action: args.action, uuid: args.uuid });
            case "open_external":
                await (Editor.Message.request as any)("asset-db", "open-asset", args.path);
                return ok({ success: true, action: args.action, path: args.path });
            default:
                return err(`Unknown asset_manage action: ${args.action}`);
        }
    }

    private async query(args: Record<string, any>): Promise<ToolResult> {
        switch (args.action) {
            case "path": {
                const path = await (Editor.Message.request as any)("asset-db", "query-path", args.uuid);
                return ok({ success: true, action: args.action, uuid: args.uuid, path });
            }
            case "uuid": {
                const uuid = await (Editor.Message.request as any)("asset-db", "query-uuid", args.path);
                return ok({ success: true, action: args.action, path: args.path, uuid });
            }
            case "url": {
                const url = await (Editor.Message.request as any)("asset-db", "query-url", args.uuid);
                return ok({ success: true, action: args.action, uuid: args.uuid, url });
            }
            case "details": {
                const info = await (Editor.Message.request as any)("asset-db", "query-asset-info", args.uuid);
                const meta = await (Editor.Message.request as any)("asset-db", "query-asset-meta", args.uuid).catch(() => null);
                return ok({ success: true, action: args.action, info, meta });
            }
            case "dependencies": {
                let deps;
                try { deps = await (Editor.Message.request as any)("asset-db", "query-depends", args.uuid); }
                catch {
                    try { deps = await (Editor.Message.request as any)("asset-db", "query-asset-depends", args.uuid); }
                    catch { deps = []; }
                }
                return ok({ success: true, action: args.action, uuid: args.uuid, dependencies: deps });
            }
            case "users": {
                const users = await (Editor.Message.request as any)("asset-db", "query-asset-users", args.uuid).catch(() => []);
                return ok({ success: true, action: args.action, uuid: args.uuid, users });
            }
            case "missing": {
                const missing = await (Editor.Message.request as any)("asset-db", "query-missing-asset-info", args.uuid).catch(() => null);
                return ok({ success: true, action: args.action, uuid: args.uuid, missing, hasMissing: !!missing });
            }
            case "ready": {
                const ready = await (Editor.Message.request as any)("asset-db", "query-ready");
                return ok({ success: true, action: args.action, ready });
            }
            case "generate_url": {
                const url = await (Editor.Message.request as any)("asset-db", "generate-available-url", args.url);
                return ok({ success: true, action: args.action, url });
            }
            default:
                return err(`Unknown asset_query action: ${args.action}`);
        }
    }
}
