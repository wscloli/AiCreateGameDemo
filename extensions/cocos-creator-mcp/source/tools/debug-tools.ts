import { ToolCategory, ToolDefinition, ToolResult } from "../types";
import { ok, err } from "../tool-base";
import { getGameLogs, clearGameLogs, queueGameCommand, getCommandResult } from "../mcp-server";
import { parseMaybeJson } from "../utils";
import { ensureSceneSafeToSwitch } from "./scene-tools";
import { processImage, takeEditorScreenshot } from "../screenshot";

export class DebugTools implements ToolCategory {
    readonly categoryName = "debug";

    getTools(): ToolDefinition[] {
        return [
            {
                name: "debug_list_messages",
                description: "List available Editor messages for a given extension or built-in module.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target: { type: "string", description: "Message target (e.g. 'scene', 'asset-db', 'extension')" },
                    },
                    required: ["target"],
                },
            },
            {
                name: "debug_execute_script",
                description: "Execute a custom scene script method. The method must be registered in scene.ts.",
                inputSchema: {
                    type: "object",
                    properties: {
                        method: { type: "string", description: "Method name from scene.ts" },
                        args: { type: "array", description: "Arguments to pass", items: {} },
                    },
                    required: ["method"],
                },
            },
            {
                name: "read_console",
                description: "Read Editor / Scene / Game console logs in one tool. Captures compile errors (from Editor / project.log), runtime errors, and console.log output across all sources. Supports action='get' (default) and action='clear'. Replaces debug_get_console_logs / debug_clear_console in v2.0.0.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'get' (default) or 'clear'." },
                        types: {
                            type: "array",
                            items: { type: "string" },
                            description: "Filter by entry type. Any of 'log' | 'info' | 'warn' | 'error'. Returns all types if omitted.",
                        },
                        sources: {
                            type: "array",
                            items: { type: "string" },
                            description: "Filter by source. Any of 'editor' | 'scene' | 'game'. Default: all three.",
                        },
                        count: { type: "number", description: "Max entries to return after merge (default 50)." },
                        includeStacktrace: { type: "boolean", description: "Include stacktrace strings if available (default false)." },
                        since: { type: "string", description: "ISO timestamp — return only entries newer than this (optional)." },
                        search: { type: "string", description: "Substring or regex pattern to filter messages (optional)." },
                    },
                },
            },
            {
                name: "debug_logs",
                description: "Read or search the project log file (separate from read_console — this is the editor's persistent log). Actions: 'get' (last N lines), 'search' (regex pattern), 'info' (file size / path / mtime).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'get' (default) | 'search' | 'info'" },
                        lines: { type: "number", description: "Number of lines to read (action=get, default 100)" },
                        pattern: { type: "string", description: "Regex pattern (action=search)" },
                    },
                },
            },
            {
                name: "debug_extension",
                description: "Manage editor extensions (this MCP server itself + others). Actions: 'list' (all installed extensions), 'info' (details for a specific extension by name), 'reload' (reload this MCP extension — for new tool definitions a full CC restart is still required).",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'list' (default) | 'info' | 'reload'" },
                        name: { type: "string", description: "Extension name (action=info)" },
                    },
                },
            },
            // ── 以下、既存MCP未対応のEditor API ──
            {
                name: "debug_query_devices",
                description: "List connected devices (for native debugging).",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "debug_open_url",
                description: "Open a URL in the system browser from the editor.",
                inputSchema: {
                    type: "object",
                    properties: { url: { type: "string", description: "URL to open" } },
                    required: ["url"],
                },
            },
            {
                name: "debug_validate_scene",
                description: "Validate the current scene for common issues.",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "debug_game_command",
                description: "Send a command to the running game preview. Requires GameDebugClient in the game. Commands: 'screenshot' (capture game canvas), 'state' (dump GameDb), 'navigate' (go to a page), 'click' (click a node by name), 'inspect' (get runtime node info: UITransform sizes, Widget, Layout, position). Returns the result from the game.",
                inputSchema: {
                    type: "object",
                    properties: {
                        type: { type: "string", description: "Command type: 'screenshot', 'state', 'navigate', 'click', 'inspect'" },
                        args: { type: "object", description: "Command arguments (e.g. {page: 'HomePageView'} for navigate, {name: 'ButtonName'} for click)" },
                        timeout: { type: "number", description: "Max wait time in ms (default 5000)" },
                        maxWidth: { type: "number", description: "Max width for screenshot resize (default: 960, 0 = no resize)" },
                        imageFormat: { type: "string", description: "Screenshot output format: 'webp' (default, Q=85) or 'png' (lossless)" },
                    },
                    required: ["type"],
                },
            },
            {
                name: "debug_screenshot",
                description: "Capture screenshots. Targets: 'window' (default — editor window, returns saved PNG path) or 'pages' (navigate game preview to each page name in `pages` and screenshot each — requires GameDebugClient + active preview).",
                inputSchema: {
                    type: "object",
                    properties: {
                        target: { type: "string", description: "'window' (default) | 'pages'" },
                        savePath: { type: "string", description: "File path (target=window, default temp/screenshots/screenshot_<timestamp>.png)" },
                        maxWidth: { type: "number", description: "Max width in pixels for resize (default 960, 0 = no resize)" },
                        pages: { type: "array", items: { type: "string" }, description: "Page names to screenshot (target=pages, e.g. ['HomePageView','ShopPageView'])" },
                        delay: { type: "number", description: "Delay ms between navigate and screenshot (target=pages, default 1000)" },
                    },
                },
            },
            {
                name: "debug_preview",
                description: "Start or stop the game preview. Uses Preview in Editor (auto-opens MainScene if needed). Falls back to browser preview if editor preview fails.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'start' (default) or 'stop'" },
                        waitForReady: { type: "boolean", description: "If true, wait until GameDebugClient connects after start (default: false)" },
                        waitTimeout: { type: "number", description: "Max wait time in ms for waitForReady (default: 15000)" },
                    },
                },
            },
            {
                name: "debug_clear_code_cache",
                description: "Clear the code cache (equivalent to Developer > Cache > Clear code cache) and soft-reload the scene.",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "debug_record",
                description: "Record the game preview canvas to a video file (MP4/WebM via MediaRecorder on the game side). Actions: 'start' (configure fps/quality/format/savePath) and 'stop' (returns file path + size). Video saved to project's temp/recordings/rec_<datetime>.* by default.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "'start' | 'stop'" },
                        fps: { type: "number", description: "Frames per second (action=start, default 30)" },
                        quality: { type: "string", description: "'low'|'medium'|'high'|'ultra' (action=start, default medium). Coefficients 0.15/0.25/0.40/0.60." },
                        coefficient: { type: "number", description: "Custom bitrate coefficient (width × height × fps × coefficient). Overrides quality." },
                        videoBitsPerSecond: { type: "number", description: "Explicit bitrate in bps. Overrides quality-based calculation." },
                        format: { type: "string", description: "'mp4' (default) | 'webm'. mp4 falls back to webm if unsupported." },
                        savePath: { type: "string", description: "Save directory (project-relative or absolute). Default: temp/recordings" },
                        timeout: { type: "number", description: "Max wait time in ms for file upload (action=stop, default 30000)" },
                    },
                    required: ["action"],
                },
            },
            {
                name: "execute_editor_script",
                description: "ESCAPE HATCH (v2.0.0). Execute arbitrary JavaScript in the editor's scene process. Use for operations not covered by other tools: atomic transactions, experimental APIs, bulk operations, project-specific workflows. Code is wrapped in an async function so 'await' is usable directly. Available globals: Editor (Message API), cc (engine module), console. Return values are serialized; cc.Node / cc.Component instances become summary objects. WARNING: full Editor process privileges — local development only, never expose to untrusted callers.",
                inputSchema: {
                    type: "object",
                    properties: {
                        code: { type: "string", description: "JavaScript code. Use `return <expr>` to return a value. Async / await supported." },
                        timeoutMs: { type: "number", description: "Max execution time in ms (default: 5000)." },
                        returnLogs: { type: "boolean", description: "If true, captures console.log/warn/error during execution and returns them in `logs` (default: false)." },
                    },
                    required: ["code"],
                },
            },
            {
                name: "debug_wait_compile",
                description: "Wait for TypeScript compilation to complete. Monitors the packer-driver debug log for 'Target(editor) ends' message. Use after modifying .ts files to ensure changes are compiled before operating on Prefabs. With clean=true, deletes compiled output first to force a fresh recompile (slower but guaranteed).",
                inputSchema: {
                    type: "object",
                    properties: {
                        timeout: { type: "number", description: "Max wait time in ms (default: 15000)" },
                        clean: { type: "boolean", description: "If true, delete compiled output first to force fresh recompile (default: false)" },
                    },
                },
            },
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<ToolResult> {
        try {
            switch (toolName) {
                case "debug_list_messages":
                    return this.listMessages(args.target);
                case "debug_execute_script":
                    return this.executeScript(args.method, args.args || []);
                case "read_console":
                    return this.readConsole({
                        action: args.action || "get",
                        types: parseMaybeJson(args.types),
                        sources: parseMaybeJson(args.sources),
                        count: args.count || 50,
                        includeStacktrace: args.includeStacktrace ?? false,
                        since: args.since,
                        search: args.search,
                    });
                case "debug_logs":
                    return this.handleLogsAction(args);
                case "debug_extension":
                    return this.handleExtensionAction(args);
                case "debug_query_devices": {
                    const devices = await (Editor.Message.request as any)("device", "query").catch(() => []);
                    return ok({ success: true, devices });
                }
                case "debug_open_url":
                    await (Editor.Message.request as any)("program", "open-url", args.url);
                    return ok({ success: true, url: args.url });
                case "debug_game_command":
                    return this.gameCommand(args.type || args.command, parseMaybeJson(args.args), args.timeout || 5000, args.maxWidth, args.imageFormat);
                case "debug_screenshot": {
                    const target = args.target || "window";
                    if (target === "window") return this.takeScreenshot(args.savePath, args.maxWidth);
                    if (target === "pages") {
                        if (!Array.isArray(args.pages)) return err("debug_screenshot(pages): 'pages' array is required");
                        return this.batchScreenshot(args.pages, args.delay || 1000, args.maxWidth);
                    }
                    return err(`Unknown debug_screenshot target: ${target}. Expected 'window' or 'pages'.`);
                }
                case "debug_preview":
                    return this.handlePreview(args.action || "start", args.waitForReady, args.waitTimeout || 15000);
                case "debug_clear_code_cache":
                    return this.clearCodeCache();
                case "debug_validate_scene":
                    return this.validateScene();
                case "debug_record":
                    if (args.action === "start") {
                        return this.gameCommand("record_start", {
                            fps: args.fps, quality: args.quality, coefficient: args.coefficient,
                            videoBitsPerSecond: args.videoBitsPerSecond, format: args.format, savePath: args.savePath,
                        }, 5000);
                    }
                    if (args.action === "stop") {
                        return this.gameCommand("record_stop", undefined, args.timeout || 30000);
                    }
                    return err(`Unknown debug_record action: ${args.action}. Expected 'start' or 'stop'.`);
                case "debug_wait_compile":
                    return this.waitCompile(args.timeout || 15000, args.clean ?? false);
                case "execute_editor_script": {
                    if (typeof args.code !== "string" || args.code.length === 0) {
                        return err("execute_editor_script: 'code' is required and must be a non-empty string");
                    }
                    try {
                        const result = await Editor.Message.request("scene", "execute-scene-script", {
                            name: "cocos-creator-mcp",
                            method: "executeEditorScript",
                            args: [{
                                code: args.code,
                                timeoutMs: args.timeoutMs,
                                returnLogs: args.returnLogs,
                            }],
                        });
                        return ok(result);
                    } catch (e: any) {
                        return err(e.message || String(e));
                    }
                }
                default:
                    return err(`Unknown tool: ${toolName}`);
            }
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async getEditorInfo(): Promise<ToolResult> {
        return ok({
            success: true,
            version: Editor.App.version,
            path: Editor.App.path,
            home: Editor.App.home,
            language: Editor.I18n?.getLanguage?.() || "unknown",
        });
    }

    private async listMessages(target: string): Promise<ToolResult> {
        try {
            const info = await (Editor.Message.request as any)("extension", "query-info", target);
            return ok({ success: true, target, info });
        } catch (e: any) {
            const knownMessages: Record<string, string[]> = {
                "scene": [
                    "query-node-tree", "create-node", "remove-node", "duplicate-node",
                    "set-property", "create-prefab", "save-scene", "execute-scene-script",
                    "query-is-dirty", "query-classes", "soft-reload", "snapshot",
                    "change-gizmo-tool", "query-gizmo-tool-name", "focus-camera-on-nodes",
                ],
                "asset-db": [
                    "query-assets", "query-asset-info", "query-asset-meta",
                    "refresh-asset", "save-asset", "create-asset", "delete-asset",
                    "move-asset", "copy-asset", "open-asset", "reimport-asset",
                    "query-path", "query-uuid", "query-url", "query-asset-depends",
                ],
            };
            const messages = knownMessages[target];
            if (messages) {
                return ok({ success: true, target, messages, note: "Static list (query failed)" });
            }
            return err(e.message || String(e));
        }
    }

    private async executeScript(method: string, args: any[]): Promise<ToolResult> {
        const result = await Editor.Message.request("scene", "execute-scene-script", {
            name: "cocos-creator-mcp",
            method,
            args,
        });
        return ok(result);
    }

    private async readConsole(opts: {
        action: string;
        types?: string[];
        sources?: string[];
        count: number;
        includeStacktrace: boolean;
        since?: string;
        search?: string;
    }): Promise<ToolResult> {
        const allowedSources = new Set(["editor", "scene", "game"]);
        const sources = (opts.sources && opts.sources.length > 0)
            ? opts.sources.filter(s => allowedSources.has(s))
            : ["editor", "scene", "game"];

        if (opts.action === "clear") {
            const cleared: string[] = [];
            if (sources.includes("editor")) {
                try { Editor.Message.send("console", "clear"); cleared.push("editor"); } catch { /* ignore */ }
            }
            if (sources.includes("scene")) {
                try {
                    await Editor.Message.request("scene", "execute-scene-script", {
                        name: "cocos-creator-mcp",
                        method: "clearConsoleLogs",
                        args: [],
                    });
                    cleared.push("scene");
                } catch { /* scene not available */ }
            }
            if (sources.includes("game")) {
                clearGameLogs();
                cleared.push("game");
            }
            return ok({ success: true, action: "clear", cleared });
        }

        if (opts.action !== "get") {
            return err(`Unknown action: ${opts.action}. Expected 'get' or 'clear'.`);
        }

        const entries: Array<{ timestamp: string; source: string; type: string; message: string; stacktrace?: string }> = [];

        // scene source
        if (sources.includes("scene")) {
            try {
                const result = await Editor.Message.request("scene", "execute-scene-script", {
                    name: "cocos-creator-mcp",
                    method: "getConsoleLogs",
                    args: [opts.count * 2, undefined], // request more, filter after merge
                });
                if (result?.logs) {
                    for (const l of result.logs) {
                        entries.push({
                            timestamp: l.timestamp,
                            source: "scene",
                            type: normalizeType(l.level),
                            message: l.message,
                            stacktrace: l.stacktrace,
                        });
                    }
                }
            } catch { /* scene not available */ }
        }

        // game source
        if (sources.includes("game")) {
            const gameResult = getGameLogs(opts.count * 2);
            for (const l of gameResult.logs) {
                entries.push({
                    timestamp: l.timestamp,
                    source: "game",
                    type: normalizeType(l.level),
                    message: l.message,
                    stacktrace: (l as any).stacktrace,
                });
            }
        }

        // editor source
        if (sources.includes("editor")) {
            let viaApi = false;
            // 1. Try native console API first
            try {
                const logs = await (Editor.Message.request as any)("console", "query-last-logs", opts.count * 2);
                if (Array.isArray(logs) && logs.length > 0) {
                    viaApi = true;
                    for (const l of logs) {
                        entries.push({
                            timestamp: l.timestamp || new Date().toISOString(),
                            source: "editor",
                            type: normalizeType(l.type || l.level),
                            message: l.message || String(l),
                            stacktrace: l.stack || l.stacktrace,
                        });
                    }
                }
            } catch { /* not supported in this version → fallback */ }

            // 2. Fallback: parse project.log tail for compile error / warning patterns
            if (!viaApi) {
                try {
                    const parsed = await readProjectLogTail(opts.count * 2);
                    for (const e of parsed) {
                        entries.push({ ...e, source: "editor" });
                    }
                } catch { /* project.log unavailable */ }
            }
        }

        // Apply filters
        let filtered = entries;
        if (opts.types && opts.types.length > 0) {
            const allow = new Set(opts.types.map(normalizeType));
            filtered = filtered.filter(e => allow.has(e.type));
        }
        if (opts.since) {
            filtered = filtered.filter(e => e.timestamp > opts.since!);
        }
        if (opts.search) {
            let re: RegExp;
            try { re = new RegExp(opts.search, "i"); }
            catch { re = new RegExp(escapeRegex(opts.search), "i"); }
            filtered = filtered.filter(e => re.test(e.message));
        }
        if (!opts.includeStacktrace) {
            filtered = filtered.map(({ stacktrace, ...rest }) => rest);
        }

        // Sort by timestamp ascending, take last `count`
        filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const result = filtered.slice(-opts.count);

        const counts = {
            editor: entries.filter(e => e.source === "editor").length,
            scene: entries.filter(e => e.source === "scene").length,
            game: entries.filter(e => e.source === "game").length,
            total: result.length,
        };

        return ok({ success: true, action: "get", entries: result, counts });
    }

    /** debug_logs dispatcher (v2.0.0). */
    private async handleLogsAction(args: Record<string, any>): Promise<ToolResult> {
        const action = args.action || "get";
        switch (action) {
            case "get":
                return this.getProjectLogs(args.lines || 100);
            case "search":
                if (!args.pattern) return err("debug_logs(search): 'pattern' is required");
                return this.searchProjectLogs(args.pattern);
            case "info":
                return this.getLogFileInfo();
            default:
                return err(`Unknown debug_logs action: ${action}. Expected get / search / info.`);
        }
    }

    /** debug_extension dispatcher (v2.0.0). */
    private async handleExtensionAction(args: Record<string, any>): Promise<ToolResult> {
        const action = args.action || "list";
        switch (action) {
            case "list":
                return this.listExtensions();
            case "info":
                if (!args.name) return err("debug_extension(info): 'name' is required");
                return this.getExtensionInfo(args.name);
            case "reload":
                return this.reloadExtension();
            default:
                return err(`Unknown debug_extension action: ${action}. Expected list / info / reload.`);
        }
    }

    private async listExtensions(): Promise<ToolResult> {
        try {
            const list = await (Editor.Message.request as any)("extension", "query-all");
            return ok({ success: true, extensions: list });
        } catch {
            return ok({ success: true, extensions: [], note: "Extension query not supported" });
        }
    }

    private async getExtensionInfo(name: string): Promise<ToolResult> {
        try {
            const info = await (Editor.Message.request as any)("extension", "query-info", name);
            return ok({ success: true, name, info });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async getProjectLogs(lines: number): Promise<ToolResult> {
        try {
            const fs = require("fs");
            const path = require("path");
            const logPath = path.join(Editor.Project.tmpDir, "logs", "project.log");
            if (!fs.existsSync(logPath)) return ok({ success: true, logs: [], note: "Log file not found" });
            const content = fs.readFileSync(logPath, "utf-8");
            const allLines = content.split("\n");
            const recent = allLines.slice(-lines);
            return ok({ success: true, lines: recent.length, logs: recent });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async searchProjectLogs(pattern: string): Promise<ToolResult> {
        try {
            const fs = require("fs");
            const path = require("path");
            const logPath = path.join(Editor.Project.tmpDir, "logs", "project.log");
            if (!fs.existsSync(logPath)) return ok({ success: true, matches: [] });
            const content = fs.readFileSync(logPath, "utf-8");
            const regex = new RegExp(pattern, "gi");
            const matches = content.split("\n").filter((line: string) => regex.test(line));
            return ok({ success: true, pattern, count: matches.length, matches: matches.slice(0, 100) });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async getLogFileInfo(): Promise<ToolResult> {
        try {
            const fs = require("fs");
            const path = require("path");
            const logPath = path.join(Editor.Project.tmpDir, "logs", "project.log");
            if (!fs.existsSync(logPath)) return ok({ success: true, exists: false });
            const stat = fs.statSync(logPath);
            return ok({ success: true, exists: true, path: logPath, size: stat.size, modified: stat.mtime });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async handlePreview(action: string, waitForReady?: boolean, waitTimeout?: number): Promise<ToolResult> {
        if (action === "stop") {
            return this.stopPreview();
        }
        const result = await this.startPreview();
        if (waitForReady) {
            const resultData = JSON.parse(result.content[0].text);
            if (resultData.success) {
                const ready = await this.waitForGameReady(waitTimeout || 15000);
                resultData.gameReady = ready;
                if (!ready) {
                    resultData.note = (resultData.note || "") + " GameDebugClient did not connect within timeout.";
                }
                return ok(resultData);
            }
        }
        return result;
    }

    private async waitForGameReady(timeout: number): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            // Check if game has sent any log or command result recently
            const gameResult = getGameLogs(1);
            if (gameResult.total > 0) return true;
            await new Promise(r => setTimeout(r, 500));
        }
        return false;
    }

    private async startPreview(): Promise<ToolResult> {
        try {
            await this.ensureMainSceneOpen();

            // ツールバーのVueインスタンス経由でplay()を呼ぶ（UI状態も同期される）
            const played = await this.executeOnToolbar("start");
            if (played) {
                return ok({ success: true, action: "start", mode: "editor" });
            }

            // フォールバック: 直接API
            const isPlaying = await (Editor.Message.request as any)("scene", "editor-preview-set-play", true);
            return ok({ success: true, isPlaying, action: "start", mode: "editor", note: "direct API (toolbar UI may not sync)" });
        } catch (e: any) {
            try {
                const electron = require("electron");
                await electron.shell.openExternal("http://127.0.0.1:7456");
                return ok({ success: true, action: "start", mode: "browser" });
            } catch (e2: any) {
                return err(e2.message || String(e2));
            }
        }
    }

    private async stopPreview(): Promise<ToolResult> {
        try {
            // ツールバー経由で停止（UI同期）
            const stopped = await this.executeOnToolbar("stop");
            if (!stopped) {
                // フォールバック: 直接API
                await (Editor.Message.request as any)("scene", "editor-preview-set-play", false);
            }
            // scene:preview-stop ブロードキャストでツールバーUI状態をリセット
            Editor.Message.broadcast("scene:preview-stop");
            // シーンビューに戻す
            await new Promise(r => setTimeout(r, 500));
            await this.ensureMainSceneOpen();
            return ok({ success: true, action: "stop" });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async executeOnToolbar(action: "start" | "stop"): Promise<boolean> {
        try {
            const electron = require("electron");
            const allContents = electron.webContents.getAllWebContents();
            for (const wc of allContents) {
                try {
                    // play()をawaitしない — プレビュー完了を待つとタイムアウトするため
                    if (action === "start") {
                        const result = await wc.executeJavaScript(
                            `(function() { if (window.xxx && window.xxx.play && !window.xxx.gameView.isPlay) { window.xxx.play(); return true; } return false; })()`
                        );
                        if (result) return true;
                    } else {
                        const result = await wc.executeJavaScript(
                            `(function() { if (window.xxx && window.xxx.gameView.isPlay) { window.xxx.play(); return true; } return false; })()`
                        );
                        if (result) return true;
                    }
                } catch { /* not the toolbar webContents */ }
            }
        } catch { /* electron API not available */ }
        return false;
    }

    private async ensureMainSceneOpen(): Promise<void> {
        const hierarchy = await Editor.Message.request("scene", "execute-scene-script", {
            name: "cocos-creator-mcp",
            method: "getSceneHierarchy",
            args: [false],
        }).catch(() => null);

        if (!hierarchy?.sceneName || hierarchy.sceneName === "scene-2d") {
            // プロジェクト設定のStart Sceneを参照
            let sceneUuid: string | null = null;
            try {
                sceneUuid = await (Editor as any).Profile.getConfig("preview", "general.start_scene", "local");
            } catch { /* ignore */ }

            // Start Sceneが未設定 or "current_scene" の場合、最初のシーンを使う
            if (!sceneUuid || sceneUuid === "current_scene") {
                const scenes = await Editor.Message.request("asset-db", "query-assets", {
                    ccType: "cc.SceneAsset",
                    pattern: "db://assets/**/*",
                });
                if (Array.isArray(scenes) && scenes.length > 0) {
                    sceneUuid = scenes[0].uuid;
                }
            }

            if (sceneUuid) {
                // debug_preview 内部の自動遷移は preview を優先して force=true
                // （dialog 出るより preview 開始を優先する運用）
                await ensureSceneSafeToSwitch(true);
                await (Editor.Message.request as any)("scene", "open-scene", sceneUuid);
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    }

    private async clearCodeCache(): Promise<ToolResult> {
        try {
            const electron = require("electron");
            const menu = electron.Menu.getApplicationMenu();
            if (!menu) return err("Application menu not found");

            const findMenuItem = (items: any[], path: string[]): any => {
                for (const item of items) {
                    if (item.label === path[0]) {
                        if (path.length === 1) return item;
                        if (item.submenu?.items) return findMenuItem(item.submenu.items, path.slice(1));
                    }
                }
                return null;
            };

            const cacheItem = findMenuItem(menu.items, ["Developer", "Cache", "Clear code cache"]);
            if (!cacheItem) return err("Menu item 'Developer > Cache > Clear code cache' not found");

            cacheItem.click();
            await new Promise(r => setTimeout(r, 1000));
            return ok({ success: true, note: "Code cache cleared via menu" });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async gameCommand(type: string, args: any, timeout: number, maxWidth?: number, imageFormat?: string): Promise<ToolResult> {
        const cmdId = queueGameCommand(type, args);

        // Poll for result
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const result = getCommandResult();
            if (result && result.id === cmdId) {
                // If screenshot, save to file and return path
                if (type === "screenshot" && result.success && result.data?.dataUrl) {
                    try {
                        const fs = require("fs");
                        const path = require("path");
                        const dir = path.join(Editor.Project.tmpDir, "screenshots");
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                        const base64 = result.data.dataUrl.replace(/^data:image\/png;base64,/, "");
                        const pngBuffer = Buffer.from(base64, "base64");
                        const effectiveMaxWidth = maxWidth !== undefined ? maxWidth : 960;
                        const electron = require("electron");
                        const origImage = electron.nativeImage.createFromBuffer(pngBuffer);
                        const originalSize = origImage.getSize();
                        const { buffer, width, height, format } = await processImage(pngBuffer, effectiveMaxWidth, imageFormat);
                        const ext = format === "webp" ? "webp" : format === "jpeg" ? "jpg" : "png";
                        const filePath = path.join(dir, `game_${timestamp}.${ext}`);
                        fs.writeFileSync(filePath, buffer);
                        return ok({
                            success: true, path: filePath, size: buffer.length, format,
                            originalSize: `${originalSize.width}x${originalSize.height}`,
                            savedSize: `${width}x${height}`,
                        });
                    } catch (e: any) {
                        return ok({ success: true, note: "Screenshot captured but file save failed", error: e.message });
                    }
                }
                return ok(result);
            }
            await new Promise(r => setTimeout(r, 200));
        }
        return err(`Game did not respond within ${timeout}ms. Is GameDebugClient running in the preview?`);
    }

    private async takeScreenshot(savePath?: string, maxWidth?: number): Promise<ToolResult> {
        try {
            const result = await takeEditorScreenshot(savePath, maxWidth);
            return ok(result);
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    private async reloadExtension(): Promise<ToolResult> {
        // Schedule reload after response is sent
        setTimeout(async () => {
            try {
                await (Editor.Message.request as any)("extension", "reload", "cocos-creator-mcp");
            } catch (e: any) {
                console.error("[MCP] Extension reload failed:", e.message);
            }
        }, 500);
        return ok({ success: true, note: "Extension reload scheduled. MCP server will restart in ~1s. NOTE: Adding new tool definitions or modifying scene.ts requires a full CocosCreator restart (reload is not sufficient)." });
    }

    private async batchScreenshot(pages: string[], delay: number, maxWidth?: number): Promise<ToolResult> {
        const results: any[] = [];
        const timeout = 10000;

        for (const page of pages) {
            // Navigate
            const navResult = await this.gameCommand("navigate", { page }, timeout, maxWidth);
            const navData = JSON.parse(navResult.content[0].text);
            if (!navData.success) {
                results.push({ page, success: false, error: "navigate failed" });
                continue;
            }

            // Wait for page to render
            await new Promise(r => setTimeout(r, delay));

            // Screenshot
            const ssResult = await this.gameCommand("screenshot", {}, timeout, maxWidth);
            const ssData = JSON.parse(ssResult.content[0].text);
            results.push({
                page,
                success: ssData.success || false,
                path: ssData.path,
                error: ssData.success ? undefined : (ssData.error || ssData.message),
            });
        }

        const succeeded = results.filter(r => r.success).length;
        return ok({
            success: true,
            total: pages.length,
            succeeded,
            failed: pages.length - succeeded,
            results,
        });
    }

    private async validateScene(): Promise<ToolResult> {
        try {
            const tree = await Editor.Message.request("scene", "query-node-tree");
            const issues: string[] = [];
            const checkNodes = (nodes: any[]) => {
                if (!nodes) return;
                for (const node of nodes) {
                    if (!node.name) issues.push(`Node ${node.uuid} has no name`);
                    if (node.children) checkNodes(node.children);
                }
            };
            if (Array.isArray(tree)) checkNodes(tree);
            return ok({ success: true, issueCount: issues.length, issues });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }

    /**
     * TypeScript コンパイル完了を待つ。
     * packer-driver の debug.log に "Target(editor) ends" が現れるのを監視する。
     * 既にコンパイル済み（直近数秒以内に完了ログあり）なら即座に返す。
     */
    private async waitCompile(timeout: number, clean: boolean): Promise<ToolResult> {
        try {
            const fs = require("fs");
            const path = require("path");
            const logPath = path.join(Editor.Project.path, "temp", "programming", "packer-driver", "logs", "debug.log");
            const chunksDir = path.join(Editor.Project.path, "temp", "programming", "packer-driver", "targets", "editor", "chunks");

            if (!fs.existsSync(logPath)) {
                return err(`Compile log not found: ${logPath}`);
            }

            const MARKER = "Target(editor) ends";

            // clean モード: コードキャッシュクリア + soft-reload で再コンパイルを強制
            if (clean) {
                // Developer > Cache > Clear code cache をクリック
                try {
                    const electron = require("electron");
                    const menu = electron.Menu.getApplicationMenu();
                    const findMenuItem = (items: any[], labels: string[]): any => {
                        for (const item of items) {
                            if (item.label === labels[0]) {
                                if (labels.length === 1) return item;
                                if (item.submenu?.items) return findMenuItem(item.submenu.items, labels.slice(1));
                            }
                        }
                        return null;
                    };
                    const cacheItem = menu ? findMenuItem(menu.items, ["Developer", "Cache", "Clear code cache"]) : null;
                    if (cacheItem) cacheItem.click();
                } catch (_e) { /* ignore */ }
                await new Promise(r => setTimeout(r, 500));
                // soft-reload でシーンを再読み込み → コンパイルトリガー
                await (Editor.Message.request as any)("scene", "soft-reload").catch(() => {});
            }

            // refresh-asset でファイル変更を CC に通知してコンパイルをトリガー
            await (Editor.Message.request as any)("asset-db", "refresh-asset", "db://assets").catch(() => {});

            const initialSize = fs.statSync(logPath).size;
            const startTime = Date.now();
            const POLL_INTERVAL = 200;
            const DETECT_GRACE_MS = 2000; // CC がファイル変更を検知するまでの猶予

            while (Date.now() - startTime < timeout) {
                await new Promise(r => setTimeout(r, POLL_INTERVAL));

                const currentSize = fs.statSync(logPath).size;

                // ログが成長していない
                if (currentSize <= initialSize) {
                    // clean モードでは必ずコンパイルが走るので猶予判定しない
                    if (clean) continue;
                    // 猶予期間内はまだ待つ (CC の検知が遅い可能性)
                    if (Date.now() - startTime < DETECT_GRACE_MS) continue;
                    // 猶予期間を過ぎてもログが成長しない → コンパイル不要
                    return ok({ success: true, compiled: true, waitedMs: Date.now() - startTime, note: "No compilation triggered (no changes detected)" });
                }

                // ログが成長した → 新しい部分にマーカーがあるか確認
                const fd = fs.openSync(logPath, "r");
                const newBytes = currentSize - initialSize;
                const buffer = Buffer.alloc(newBytes);
                fs.readSync(fd, buffer, 0, newBytes, initialSize);
                fs.closeSync(fd);
                const newContent = buffer.toString("utf8");

                if (newContent.includes(MARKER)) {
                    return ok({ success: true, compiled: true, waitedMs: Date.now() - startTime });
                }
            }

            return ok({ success: true, compiled: false, timeout: true, waitedMs: timeout });
        } catch (e: any) {
            return err(e.message || String(e));
        }
    }
}

/** Normalize various level / type spellings to a canonical "log"|"info"|"warn"|"error" string. */
function normalizeType(raw: any): string {
    const s = String(raw ?? "").toLowerCase();
    if (s === "warning") return "warn";
    if (s === "err") return "error";
    if (s === "log" || s === "info" || s === "warn" || s === "error") return s;
    return "log";
}

/** Escape a string so it can be embedded into a RegExp literally. */
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * project.log の末尾を読み、Cocos Creator が書き出す compile error / warning /
 * generic message を構造化エントリに変換する。
 *
 * Cocos Creator が project.log に書き出す代表的なパターン:
 *   [11:22:33] [info] message...
 *   [11:22:33] [warn] message...
 *   [11:22:33] [error] message... (TS2304: Cannot find name 'Foo' など)
 *   [Scene] [error] file: assets/.../Foo.ts(12,5)
 *
 * Editor バージョンや locale により書式は変わる可能性があるので、行頭の
 * `[ts] [level]` パターンと、`error TS\d+:` の TypeScript エラー、
 * `[level]` 単独行など複数パターンを許容する。
 */
async function readProjectLogTail(maxEntries: number): Promise<Array<{ timestamp: string; type: string; message: string; stacktrace?: string }>> {
    const fs = require("fs");
    const path = require("path");
    const logPath = path.join(Editor.Project.tmpDir, "logs", "project.log");
    if (!fs.existsSync(logPath)) return [];

    const stat = fs.statSync(logPath);
    // 末尾 256KB を読む（compile error は大きくないので十分）
    const READ_BYTES = 256 * 1024;
    const start = Math.max(0, stat.size - READ_BYTES);
    const fd = fs.openSync(logPath, "r");
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    const text = buffer.toString("utf8");

    const lines = text.split(/\r?\n/);
    // 部分行（先頭行は切れている可能性）を捨てる
    if (start > 0 && lines.length > 0) lines.shift();

    const entries: Array<{ timestamp: string; type: string; message: string; stacktrace?: string }> = [];
    const lineRe = /^\[(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s*(?:\[([^\]]+)\])?\s*\[?(log|info|warn|warning|error)\]?\s*(.*)$/i;
    const tsErrRe = /\berror\s+TS\d+:\s*/i;
    const today = new Date();
    const isoDate = today.toISOString().slice(0, 10);

    let pending: { timestamp: string; type: string; message: string; stacktrace?: string } | null = null;

    for (const raw of lines) {
        const line = raw.replace(/\[[0-9;]*m/g, ""); // strip ANSI color codes
        if (!line.trim()) continue;

        const m = line.match(lineRe);
        if (m) {
            if (pending) entries.push(pending);
            const [, time, tag, level, body] = m;
            const ts = `${isoDate}T${time}${time.length === 8 ? ".000" : ""}Z`;
            pending = {
                timestamp: ts,
                type: normalizeType(level),
                message: tag ? `[${tag}] ${body}` : body,
            };
        } else if (tsErrRe.test(line)) {
            // TypeScript エラー単独行（タイムスタンプなし）
            if (pending) entries.push(pending);
            pending = {
                timestamp: new Date().toISOString(),
                type: "error",
                message: line.trim(),
            };
        } else if (pending) {
            // 継続行 — stacktrace に追加
            pending.stacktrace = pending.stacktrace ? `${pending.stacktrace}\n${line}` : line;
        }
    }
    if (pending) entries.push(pending);

    // 末尾 maxEntries 件
    return entries.slice(-maxEntries);
}
