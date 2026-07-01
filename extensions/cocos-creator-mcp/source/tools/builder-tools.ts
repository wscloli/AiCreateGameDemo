import { ToolCategory, ToolDefinition, ToolResult } from "../types";
import { ok, err } from "../tool-base";

export class BuilderTools implements ToolCategory {
    readonly categoryName = "builder";

    getTools(): ToolDefinition[] {
        return [
            {
                name: "builder_manage",
                description: "Manage the editor's Build / Preview server. Actions: 'open_panel' (open Build panel), 'get_settings' (read build config), 'query_tasks' (list active build tasks), 'run_preview' (start preview server), 'stop_preview' (stop preview server).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'open_panel' | 'get_settings' | 'query_tasks' | 'run_preview' | 'stop_preview'" },
                    },
                    required: ["action"],
                },
            },
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<ToolResult> {
        if (toolName !== "builder_manage") return err(`Unknown tool: ${toolName}`);
        try {
            switch (args.action) {
                case "open_panel":
                    Editor.Panel.open("builder");
                    return ok({ success: true, action: args.action });
                case "get_settings": {
                    const settings = await (Editor.Message.request as any)("builder", "query-build-options").catch(() => null);
                    return ok({ success: true, action: args.action, settings });
                }
                case "query_tasks": {
                    const tasks = await (Editor.Message.request as any)("builder", "query-tasks").catch(() => []);
                    return ok({ success: true, action: args.action, tasks });
                }
                case "run_preview":
                    await (Editor.Message.request as any)("preview", "start");
                    return ok({ success: true, action: args.action, message: "Preview started" });
                case "stop_preview":
                    await (Editor.Message.request as any)("preview", "stop");
                    return ok({ success: true, action: args.action, message: "Preview stopped" });
                default:
                    return err(`Unknown builder_manage action: ${args.action}. Expected open_panel / get_settings / query_tasks / run_preview / stop_preview.`);
            }
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }
}
