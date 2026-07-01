import { ToolCategory, ToolDefinition, ToolResult } from "../types";
import { ok, err } from "../tool-base";

export class PreferencesTools implements ToolCategory {
    readonly categoryName = "preferences";

    getTools(): ToolDefinition[] {
        return [
            {
                name: "preferences_manage",
                description: "Manage editor preferences. Actions: 'get' (read one value), 'set' (write one value), 'get_all' (dump all keys for a protocol), 'reset' (revert one key to default).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'get' | 'set' | 'get_all' | 'reset'" },
                        protocol: { type: "string", description: "Protocol name (e.g. 'general', 'builder', 'engine')" },
                        key: { type: "string", description: "Preference key (required for get/set/reset)" },
                        value: { description: "Value to set (required for action=set)" },
                    },
                    required: ["action", "protocol"],
                },
            },
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<ToolResult> {
        if (toolName !== "preferences_manage") return err(`Unknown tool: ${toolName}`);
        try {
            const action = args.action;
            switch (action) {
                case "get": {
                    if (!args.key) return err("preferences_manage(get): 'key' is required");
                    const value = Editor.Profile.getConfig(args.protocol, args.key);
                    return ok({ success: true, action, protocol: args.protocol, key: args.key, value });
                }
                case "set": {
                    if (!args.key) return err("preferences_manage(set): 'key' is required");
                    if (args.value === undefined) return err("preferences_manage(set): 'value' is required");
                    Editor.Profile.setConfig(args.protocol, args.key, args.value);
                    return ok({ success: true, action, protocol: args.protocol, key: args.key });
                }
                case "get_all": {
                    const config = Editor.Profile.getConfig(args.protocol);
                    return ok({ success: true, action, protocol: args.protocol, config });
                }
                case "reset": {
                    if (!args.key) return err("preferences_manage(reset): 'key' is required");
                    Editor.Profile.removeConfig(args.protocol, args.key);
                    return ok({ success: true, action, protocol: args.protocol, key: args.key });
                }
                default:
                    return err(`Unknown preferences_manage action: ${action}. Expected get / set / get_all / reset.`);
            }
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }
}
