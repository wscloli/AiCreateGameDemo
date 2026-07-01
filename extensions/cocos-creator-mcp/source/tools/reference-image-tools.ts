import { ToolCategory, ToolDefinition, ToolResult } from "../types";
import { ok, err } from "../tool-base";

export class ReferenceImageTools implements ToolCategory {
    readonly categoryName = "referenceImage";

    getTools(): ToolDefinition[] {
        return [
            {
                name: "refimage_manage",
                description: "Manage scene-view reference image overlays. Actions: 'add' (path), 'remove' (index), 'clear_all', 'switch' (index), 'refresh'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'add' | 'remove' | 'clear_all' | 'switch' | 'refresh'" },
                        path: { type: "string", description: "Image file path or db:// path (action=add)" },
                        index: { type: "number", description: "Image index (action=remove|switch)" },
                    },
                    required: ["action"],
                },
            },
            {
                name: "refimage_set",
                description: "Adjust the currently active reference image. Actions: 'position' ({x,y}), 'scale' (scale), 'opacity' (opacity 0-255).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'position' | 'scale' | 'opacity'" },
                        x: { type: "number" },
                        y: { type: "number" },
                        scale: { type: "number" },
                        opacity: { type: "number", description: "0-255" },
                    },
                    required: ["action"],
                },
            },
            {
                name: "refimage_query",
                description: "Query reference image state. Actions: 'list' (all images / config), 'current' (active image info).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'list' (default) | 'current'" },
                    },
                },
            },
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<ToolResult> {
        try {
            switch (toolName) {
                case "refimage_manage":
                    return this.manage(args);
                case "refimage_set":
                    return this.set(args);
                case "refimage_query":
                    return this.query(args);
                default:
                    return err(`Unknown tool: ${toolName}`);
            }
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async manage(args: Record<string, any>): Promise<ToolResult> {
        switch (args.action) {
            case "add":
                if (!args.path) return err("refimage_manage(add): 'path' is required");
                await (Editor.Message.request as any)("scene", "add-reference-image", args.path);
                return ok({ success: true, action: args.action, path: args.path });
            case "remove":
                if (typeof args.index !== "number") return err("refimage_manage(remove): 'index' is required");
                await (Editor.Message.request as any)("scene", "remove-reference-image", args.index);
                return ok({ success: true, action: args.action, index: args.index });
            case "clear_all":
                await (Editor.Message.request as any)("scene", "clear-all-reference-images");
                return ok({ success: true, action: args.action });
            case "switch":
                if (typeof args.index !== "number") return err("refimage_manage(switch): 'index' is required");
                await (Editor.Message.request as any)("scene", "switch-reference-image", args.index);
                return ok({ success: true, action: args.action, index: args.index });
            case "refresh":
                await (Editor.Message.request as any)("scene", "refresh-reference-image");
                return ok({ success: true, action: args.action });
            default:
                return err(`Unknown refimage_manage action: ${args.action}`);
        }
    }

    private async set(args: Record<string, any>): Promise<ToolResult> {
        switch (args.action) {
            case "position":
                await (Editor.Message.request as any)("scene", "set-reference-image-position", args.x, args.y);
                return ok({ success: true, action: args.action, x: args.x, y: args.y });
            case "scale":
                await (Editor.Message.request as any)("scene", "set-reference-image-scale", args.scale);
                return ok({ success: true, action: args.action, scale: args.scale });
            case "opacity":
                await (Editor.Message.request as any)("scene", "set-reference-image-opacity", args.opacity);
                return ok({ success: true, action: args.action, opacity: args.opacity });
            default:
                return err(`Unknown refimage_set action: ${args.action}`);
        }
    }

    private async query(args: Record<string, any>): Promise<ToolResult> {
        const action = args.action || "list";
        switch (action) {
            case "list":
            case "config": {
                const config = await (Editor.Message.request as any)("scene", "query-reference-image-config").catch(() => null);
                return ok({ success: true, action, config });
            }
            case "current": {
                const current = await (Editor.Message.request as any)("scene", "query-current-reference-image").catch(() => null);
                return ok({ success: true, action, current });
            }
            default:
                return err(`Unknown refimage_query action: ${action}`);
        }
    }
}
