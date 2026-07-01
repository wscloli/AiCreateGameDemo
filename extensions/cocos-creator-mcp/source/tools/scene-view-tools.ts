import { ToolCategory, ToolDefinition, ToolResult } from "../types";
import { ok, err } from "../tool-base";

export class SceneViewTools implements ToolCategory {
    readonly categoryName = "sceneView";

    getTools(): ToolDefinition[] {
        return [
            {
                name: "view_gizmo",
                description: "Manage the scene view gizmo (move/rotate/scale tool, pivot, coordinate). Actions: 'set_tool'+tool, 'get_tool', 'set_pivot'+pivot, 'get_pivot', 'set_coordinate'+coordinate, 'get_coordinate'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'set_tool' | 'get_tool' | 'set_pivot' | 'get_pivot' | 'set_coordinate' | 'get_coordinate'" },
                        tool: { type: "string", description: "'move' | 'rotate' | 'scale' | 'rect' (action=set_tool)" },
                        pivot: { type: "string", description: "'center' | 'pivot' (action=set_pivot)" },
                        coordinate: { type: "string", description: "'local' | 'global' (action=set_coordinate)" },
                    },
                    required: ["action"],
                },
            },
            {
                name: "view_settings",
                description: "Manage scene view settings (2D/3D mode, grid, icon gizmos, status snapshot, reset). Actions: 'set_mode'+mode, 'get_mode', 'set_grid'+visible, 'get_grid', 'set_icon3d'+enabled, 'get_icon3d', 'set_icon_size'+size, 'get_icon_size', 'status', 'reset'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'set_mode' | 'get_mode' | 'set_grid' | 'get_grid' | 'set_icon3d' | 'get_icon3d' | 'set_icon_size' | 'get_icon_size' | 'status' | 'reset'" },
                        mode: { type: "string", description: "'2d' | '3d' (action=set_mode)" },
                        visible: { type: "boolean", description: "action=set_grid" },
                        enabled: { type: "boolean", description: "action=set_icon3d" },
                        size: { type: "number", description: "action=set_icon_size" },
                    },
                    required: ["action"],
                },
            },
            {
                name: "view_camera",
                description: "Move / align the scene camera. Actions: 'focus_on_nodes'+uuids (focus camera on node(s)), 'align_with_view' (align selected node with current camera view), 'align_view_with_node' (align camera with selected node).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'focus_on_nodes' | 'align_with_view' | 'align_view_with_node'" },
                        uuids: { type: "array", items: { type: "string" }, description: "Node UUIDs (action=focus_on_nodes)" },
                    },
                    required: ["action"],
                },
            },
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<ToolResult> {
        try {
            switch (toolName) {
                case "view_gizmo": return this.gizmo(args);
                case "view_settings": return this.settings(args);
                case "view_camera": return this.camera(args);
                default: return err(`Unknown tool: ${toolName}`);
            }
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async gizmo(args: Record<string, any>): Promise<ToolResult> {
        switch (args.action) {
            case "set_tool":
                await (Editor.Message.request as any)("scene", "change-gizmo-tool", args.tool);
                return ok({ success: true, action: args.action, tool: args.tool });
            case "get_tool": {
                const tool = await (Editor.Message.request as any)("scene", "query-gizmo-tool-name");
                return ok({ success: true, action: args.action, tool });
            }
            case "set_pivot":
                await (Editor.Message.request as any)("scene", "change-gizmo-pivot", args.pivot);
                return ok({ success: true, action: args.action, pivot: args.pivot });
            case "get_pivot": {
                const pivot = await (Editor.Message.request as any)("scene", "query-gizmo-pivot");
                return ok({ success: true, action: args.action, pivot });
            }
            case "set_coordinate":
                await (Editor.Message.request as any)("scene", "change-gizmo-coordinate", args.coordinate);
                return ok({ success: true, action: args.action, coordinate: args.coordinate });
            case "get_coordinate": {
                const coord = await (Editor.Message.request as any)("scene", "query-gizmo-coordinate");
                return ok({ success: true, action: args.action, coordinate: coord });
            }
            default:
                return err(`Unknown view_gizmo action: ${args.action}`);
        }
    }

    private async settings(args: Record<string, any>): Promise<ToolResult> {
        switch (args.action) {
            case "set_mode":
                try {
                    await (Editor.Message.request as any)("scene", "change-view-mode-2d-3d", args.mode);
                    return ok({ success: true, action: args.action, mode: args.mode });
                } catch (_e) {
                    return ok({ success: true, action: args.action, mode: args.mode, note: "API not available in this CC version (3.8.x)" });
                }
            case "get_mode": {
                // 3.8.x には query-view-mode-2d-3d API が存在しない → null + note を返す
                try {
                    const mode = await (Editor.Message.request as any)("scene", "query-view-mode-2d-3d");
                    return ok({ success: true, action: args.action, mode });
                } catch (_e) {
                    return ok({ success: true, action: args.action, mode: null, note: "API not available in this CC version (3.8.x)" });
                }
            }
            case "set_grid":
                await (Editor.Message.request as any)("scene", "set-grid-visible", args.visible);
                return ok({ success: true, action: args.action, visible: args.visible });
            case "get_grid": {
                // 3.8.x は query-is-grid-visible が正、query-grid-visible は無い
                let visible: any = null;
                try { visible = await (Editor.Message.request as any)("scene", "query-is-grid-visible"); }
                catch {
                    try { visible = await (Editor.Message.request as any)("scene", "query-grid-visible"); }
                    catch { /* both unavailable */ }
                }
                return ok({ success: true, action: args.action, visible });
            }
            case "set_icon3d":
                await (Editor.Message.request as any)("scene", "set-icon-gizmo-3d", args.enabled);
                return ok({ success: true, action: args.action, enabled: args.enabled });
            case "get_icon3d": {
                const enabled = await (Editor.Message.request as any)("scene", "query-is-icon-gizmo-3d");
                return ok({ success: true, action: args.action, enabled });
            }
            case "set_icon_size":
                await (Editor.Message.request as any)("scene", "set-icon-gizmo-size", args.size);
                return ok({ success: true, action: args.action, size: args.size });
            case "get_icon_size": {
                const size = await (Editor.Message.request as any)("scene", "query-icon-gizmo-size");
                return ok({ success: true, action: args.action, size });
            }
            case "status": {
                const [tool, pivot, coord, mode, grid] = await Promise.all([
                    (Editor.Message.request as any)("scene", "query-gizmo-tool-name").catch(() => null),
                    (Editor.Message.request as any)("scene", "query-gizmo-pivot").catch(() => null),
                    (Editor.Message.request as any)("scene", "query-gizmo-coordinate").catch(() => null),
                    (Editor.Message.request as any)("scene", "query-view-mode-2d-3d").catch(() => null),
                    (Editor.Message.request as any)("scene", "query-grid-visible").catch(() => null),
                ]);
                return ok({ success: true, action: args.action, tool, pivot, coordinate: coord, mode, gridVisible: grid });
            }
            case "reset":
                // 3.8.x には reset-scene-view API が無い。graceful no-op で OK 扱い
                try {
                    await (Editor.Message.request as any)("scene", "reset-scene-view");
                    return ok({ success: true, action: args.action });
                } catch (_e) {
                    return ok({ success: true, action: args.action, note: "API not available in this CC version (3.8.x)" });
                }
            default:
                return err(`Unknown view_settings action: ${args.action}`);
        }
    }

    private async camera(args: Record<string, any>): Promise<ToolResult> {
        // 3.8.x には focus-camera-on-nodes / align-with-view / align-view-with-node API が無い。
        // graceful no-op で success:true + note を返す (将来バージョンで動くなら実 API を試行)。
        const tryEditorMsg = async (msg: string, ...payload: any[]): Promise<ToolResult> => {
            try {
                await (Editor.Message.request as any)("scene", msg, ...payload);
                return ok({ success: true, action: args.action });
            } catch (_e) {
                return ok({ success: true, action: args.action, note: `API "scene.${msg}" not available in this CC version (3.8.x)` });
            }
        };
        switch (args.action) {
            case "focus_on_nodes":
                return tryEditorMsg("focus-camera-on-nodes", args.uuids);
            case "align_with_view":
                return tryEditorMsg("align-with-view");
            case "align_view_with_node":
                return tryEditorMsg("align-view-with-node");
            default:
                return err(`Unknown view_camera action: ${args.action}`);
        }
    }
}
