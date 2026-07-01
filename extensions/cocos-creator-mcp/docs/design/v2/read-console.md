# `read_console` 設計メモ（v2.0.0 Phase 1-1）

Issue #27 ③で「最優先候補」とした `read_console` 対応の設計案。
実装に入る前のレビュー用メモ。

## 背景

現状、コンパイルエラーやランタイムエラーを LLM が直接取得する手段が弱く、ユーザーにスクショを依頼するフローになっている。MCP for Unity は `read_console(action="get", types=["error","warning"], count=10)` で Editor Console を直接取得でき、エラー → 修正サイクルが大幅に高速化している。Cocos Creator MCP でも同等の体験を目指す。

## 既存実装の整理

| 出元 | 経路 | 取得方法 |
|------|------|---------|
| **Scene プロセス** | `scene.ts` の `console.log/warn/error` を wrapper で捕捉し `_consoleLogs[]` に蓄積 | `Editor.Message.request("scene", "execute-scene-script", { method: "getConsoleLogs" })` |
| **Game Preview** | プロジェクト側が `POST /log` でこの拡張に送信、`_gameLogs[]` に蓄積 | `getGameLogs(count, level)` (mcp-server.ts) |
| **Editor Console (compile error 等)** | `Editor.Message.request("console", "query-last-logs", count)` を試行中 | 3.8.x では `Message does not exist` で失敗する可能性が高い |
| **Project Log file** | `Editor.Project.tmpDir/logs/project.log` を直接 read | 既存の `debug_get_project_logs` / `debug_search_project_logs` |

既存ツール `debug_get_console_logs` は scene + game を merge して返すが、**Editor Console（compile error 等）は安定して取れない**のが現状の最大の弱点。

## 新ツール `read_console` の API 案

MCP for Unity に揃える形で `action` ベース、types は配列、source 分離。

```ts
{
    name: "read_console",
    description: "Read Editor / Scene / Game console logs. Captures compile errors, runtime errors, and console.log output across all sources.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                description: "'get' (default) | 'clear'",
            },
            types: {
                type: "array",
                description: "Filter by entry type. Any of 'log' | 'info' | 'warn' | 'error'. Returns all types if omitted.",
                items: { type: "string" },
            },
            sources: {
                type: "array",
                description: "Filter by source. Any of 'editor' | 'scene' | 'game'. Default: all three.",
                items: { type: "string" },
            },
            count: {
                type: "number",
                description: "Max entries to return after merge (default 50).",
            },
            includeStacktrace: {
                type: "boolean",
                description: "Include stacktrace strings if available (default false).",
            },
            since: {
                type: "string",
                description: "ISO timestamp — return only entries newer than this (optional).",
            },
            search: {
                type: "string",
                description: "Substring or regex pattern to filter messages (optional).",
            },
        },
    },
}
```

### レスポンス形

```ts
{
    success: true,
    entries: [
        { timestamp: "2026-05-28T12:00:00.000Z", source: "editor"|"scene"|"game", type: "error"|"warn"|"log"|"info", message: "...", stacktrace?: "..." },
        ...
    ],
    counts: { editor: number, scene: number, game: number, total: number },
}
```

## 3 ソースの取得経路（実装方針）

### 1. `editor` source — 最重要

最優先で **`Editor.Message.request("console", "query-last-logs", count)` を試行**。
失敗時は **`project.log` を末尾から読んで** compile error / warning パターンを正規表現で抽出。

compile error の典型パターン（Cocos Creator 3.8.x）:
```
[Scene] error TS2304: Cannot find name 'Foo'.
[Scene] file: assets/.../Foo.ts(12,5)
```

```
[Compiler] error: ...
```

これらを `editor` source の `error` / `warn` として扱う。

### 2. `scene` source

既存 `_consoleLogs[]` をそのまま使う（scene.ts の console wrapper 経由）。
変更不要。`level` → `type` のマッピングは新 API で吸収する。

### 3. `game` source

既存 `_gameLogs[]` をそのまま使う（mcp-server.ts の `POST /log` 経由）。
変更不要。

## action="clear"

3 ソースすべての buffer をクリア。
- editor: `Editor.Message.send("console", "clear")`
- scene: `Editor.Message.request("scene", "execute-scene-script", { method: "clearConsoleLogs" })`
- game: `clearGameLogs()` (mcp-server.ts)

## 既存ツールとの関係

- `debug_get_console_logs`: **Phase 3 で削除予定**。`read_console(action="get")` がフル機能の上位互換となる。
- `debug_clear_console`: **Phase 3 で削除予定**。`read_console(action="clear")` に統合。
- `debug_get_project_logs` / `debug_search_project_logs`: project.log のフルダンプ / パターン検索なので、`read_console` とは役割が違う。残す。

## 段階実装プラン

| Step | 内容 | コミット粒度 |
|------|------|------------|
| 1 | 本設計メモを `docs/design/v2/read-console.md` に追加 | 1 commit |
| 2 | `read_console` ツール定義 + scene/game の merge 実装（最小） | 1 commit |
| 3 | `editor` source 実装（`console:query-last-logs` → project.log fallback） | 1 commit |
| 4 | `since` / `search` / `includeStacktrace` フィルタ実装 | 1 commit |
| 5 | `action="clear"` 実装 | 1 commit |
| 6 | 実呼び出し型の回帰テスト追加（dummy console.log → tool 呼び出し → 副作用検証） | 1 commit |
| 7 | README / CHANGELOG に v2.0.0 read_console を追記 | 1 commit |

各 step で `npm run build` を通し、Cocos Editor 上で実機動作確認した上で次の step に進む。

## 回帰テストの方針（実動作検証型）

「`tools/list` に含まれるか」だけのテストでは捕捉できないバグ（compile error 取得 / fallback 経路 / types フィルタ等）を検出するため、以下を実呼び出しでカバーする:

1. **scene console capture テスト**: scene script で `console.error("test-error-marker")` を実行 → `read_console(types=["error"])` でそれが含まれることを assert
2. **game log capture テスト**: `POST /log` で test entry を送信 → `read_console(sources=["game"])` で取得確認
3. **types フィルタテスト**: warn + error 混在を投入 → `types=["error"]` で error のみ返ることを assert
4. **count フィルタテスト**: 60 件投入 → `count=10` で 10 件返ること、新しい順を assert
5. **action="clear" テスト**: clear 後に取得 → 空になることを assert
6. **stringified args テスト**: MCP client から `types` を JSON 文字列で送った場合の defensive parse

## 関連 issue / PR

- Issue #27 (MCP for Unity 比較改善)
- Issue #29 (圧縮の限界 + execute_editor_script 脱出口) — `read_console` は 残す側の特殊ツール
- 設計ドキュメント: `docs/design/tool-topology.md` (PR #30)
- 親 PR: #31 (v2.0.0 着手)
