import { ToolCategory, ToolDefinition, ToolResult } from "../types";
import { ok, err } from "../tool-base";
import { BUILD_HASH } from "../mcp-server";

export class ServerTools implements ToolCategory {
    readonly categoryName = "server";

    getTools(): ToolDefinition[] {
        return [
            {
                name: "server_status",
                description: "Query editor server status, network, and code-sync state. Actions: 'get' (IP+port+buildId summary), 'ips' (IP list), 'port' (port only), 'build_hash' (MCP build hash), 'connectivity' (reachable check), 'interfaces' (network interface details), 'code_sync' (check if running code matches dist/).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'get' (default) | 'ips' | 'port' | 'build_hash' | 'connectivity' | 'interfaces' | 'code_sync'" },
                    },
                },
            },
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<ToolResult> {
        if (toolName !== "server_status") return err(`Unknown tool: ${toolName}`);
        const action = args.action || "get";
        try {
            switch (action) {
                case "ips": {
                    const ips = await (Editor.Message.request as any)("server", "query-ip-list");
                    return ok({ success: true, action, ips });
                }
                case "port": {
                    const port = await (Editor.Message.request as any)("server", "query-port");
                    return ok({ success: true, action, port });
                }
                case "get": {
                    const [ips, port] = await Promise.all([
                        (Editor.Message.request as any)("server", "query-ip-list").catch(() => []),
                        (Editor.Message.request as any)("server", "query-port").catch(() => null),
                    ]);
                    return ok({ success: true, action, ips, port, buildId: BUILD_HASH });
                }
                case "build_hash":
                    return ok({ success: true, action, buildHash: BUILD_HASH });
                case "connectivity": {
                    try {
                        const port = await (Editor.Message.request as any)("server", "query-port");
                        return ok({ success: true, action, reachable: true, port });
                    } catch {
                        return ok({ success: true, action, reachable: false });
                    }
                }
                case "interfaces": {
                    const os = require("os");
                    return ok({ success: true, action, interfaces: os.networkInterfaces() });
                }
                case "code_sync":
                    return this.checkCodeSync();
                default:
                    return err(`Unknown server_status action: ${action}. Expected get / ips / port / build_hash / connectivity / interfaces / code_sync.`);
            }
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async checkCodeSync(): Promise<ToolResult> {
        try {
            const fs = require("fs");
            const path = require("path");
            const crypto = require("crypto");
            const extDir = path.join(Editor.Project.path, "extensions", "cocos-creator-mcp", "dist");
            if (!fs.existsSync(extDir)) {
                return ok({ success: true, action: "code_sync", synced: false, note: "Extension dist/ not found", runtimeHash: BUILD_HASH });
            }
            const hash = crypto.createHash("sha256");
            const collectJs = (dir: string, prefix = ""): string[] => {
                let files: string[] = [];
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                    if (entry.isDirectory()) files = files.concat(collectJs(path.join(dir, entry.name), rel));
                    else if (entry.name.endsWith(".js")) files.push(rel);
                }
                return files;
            };
            for (const file of collectJs(extDir).sort()) {
                let content = fs.readFileSync(path.join(extDir, file), "utf8");
                if (file === "mcp-server.js") {
                    content = content.replace(/exports\.BUILD_HASH = "[a-f0-9]{12}"/, 'exports.BUILD_HASH = "__BUILD_HASH__"');
                }
                hash.update(content.replace(/__BUILD_HASH__/g, ""));
            }
            const diskHash = hash.digest("hex").substring(0, 12);
            const synced = diskHash === BUILD_HASH;
            return ok({
                success: true,
                action: "code_sync",
                synced,
                runtimeHash: BUILD_HASH,
                diskHash,
                next: synced ? "none" : "Extension reload or CC restart needed",
            });
        } catch (e: any) {
            return ok({ success: true, action: "code_sync", synced: false, error: e.message, runtimeHash: BUILD_HASH });
        }
    }
}
