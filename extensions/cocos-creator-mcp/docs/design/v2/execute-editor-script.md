# `execute_editor_script` 設計メモ（v2.0.0 Phase 1-5）

Issue #29 で提案した「ツール体系の脱出口」。Cocos Creator Editor のメインプロセスまたは scene プロセスで任意の JavaScript を実行できる単一ツール。

## 背景

ツール体系を `category_action` パターンで集約しても、以下のような 1〜10% のニッチケースは取りこぼす：

1. 新規追加 API・experimental 機能（エンジン更新直後、まだツール対応していない機能）
2. 複合操作 (atomic transaction) — 「scene 変更 + prefab 編集を一括で、エラーなら rollback」
3. Editor 拡張固有の UI 操作 — カスタム Inspector 等
4. パフォーマンス重視の bulk 操作 — 100 ノード一気に生成等
5. ユーザー固有のワークフロー — プロジェクト固有の自動化

これらに毎回ツールを追加すると無限に肥大化するため、**1 つの脱出口で逃がす**。MCP for Unity の `execute_code`、DaxianLee/cocos-mcp-server v1.5 でも同様のアプローチ。

## API 設計

```ts
{
    name: "execute_editor_script",
    description: "Execute arbitrary JavaScript code in the editor's scene process. Use as an ESCAPE HATCH for operations not covered by other tools — atomic transactions, experimental APIs, bulk operations, project-specific workflows. Full access to Editor.Message, cc.* engine classes, and the current scene tree. Code is wrapped in an async function so 'await' is usable directly.",
    inputSchema: {
        type: "object",
        properties: {
            code: {
                type: "string",
                description: "JavaScript code to execute. The final expression's value (or explicit return) becomes the response. 'await' is supported. Available globals: 'Editor', 'cc' (engine module), 'console' for logging.",
            },
            timeoutMs: {
                type: "number",
                description: "Max execution time in milliseconds (default: 5000).",
            },
            returnLogs: {
                type: "boolean",
                description: "If true, capture console.log/warn/error output during execution and return alongside the result (default: false).",
            },
        },
        required: ["code"],
    },
}
```

### レスポンス

```ts
{
    success: true,
    result: any,       // 最後の式または return 値
    durationMs: number,
    logs?: string[],   // returnLogs=true のとき
}
// or
{
    success: false,
    error: string,
    stack?: string,
    durationMs: number,
}
```

## 実装方針

### 実行経路

scene プロセス側で実行する（既存の `debug_execute_script` と同じ経路）。理由：
- scene プロセスは現在のシーンと cc.* engine 全部にアクセスできる
- main プロセスでも実行可能だが、scene 操作には scene プロセスへの IPC が必要になり余計

scene.ts に新メソッド `executeEditorScript` を追加：

```ts
async executeEditorScript({ code, timeoutMs = 5000, returnLogs = false }) {
    const start = Date.now();
    const cc = require("cc");
    const logs: string[] = [];

    // console フック (returnLogs=true のとき)
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    if (returnLogs) {
        console.log = (...args) => { logs.push("[log] " + args.join(" ")); origLog.apply(console, args); };
        console.warn = (...args) => { logs.push("[warn] " + args.join(" ")); origWarn.apply(console, args); };
        console.error = (...args) => { logs.push("[error] " + args.join(" ")); origError.apply(console, args); };
    }

    try {
        // code を async function でラップ
        const fn = new Function("Editor", "cc", "console",
            `return (async () => { ${code} })();`);
        const promise = fn(Editor, cc, console);
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`execute_editor_script timeout after ${timeoutMs}ms`)), timeoutMs)
        );
        const result = await Promise.race([promise, timeout]);
        const durationMs = Date.now() - start;
        return { success: true, result: serializeForResponse(result), durationMs, ...(returnLogs ? { logs } : {}) };
    } catch (e: any) {
        return { success: false, error: e.message, stack: e.stack, durationMs: Date.now() - start, ...(returnLogs ? { logs } : {}) };
    } finally {
        if (returnLogs) {
            console.log = origLog; console.warn = origWarn; console.error = origError;
        }
    }
}
```

### 結果のシリアライズ

- `Node` インスタンスは `{__node__: true, uuid, name}` に
- `Component` は `{__component__: true, uuid, type}` に
- 循環参照は `[Circular]` に
- 関数は `[Function]` に
- それ以外は JSON 化（深さ制限あり）

これにより `node.children` 等を返しても JSON 化エラーで死なない。

## セキュリティ

- 任意コード実行なので **Editor のメインプロセス権限と同等の影響範囲**を持つ
- ファイル削除・無限ループ等が起こり得る
- 緩和策：
  - timeoutMs で最大実行時間を制限（デフォルト 5 秒）
  - description でリスクを明示
  - 将来的に「設定で disable できる」ようにする（panel か settings.json に switch）
  - tool 呼び出しごとに logTool で記録（既存）

LLM agent の利用は前提として想定するが、ローカル開発環境専用ツールであり、本番 server 等に晒さないことを README で警告する。

## 段階実装プラン

| Step | 内容 | コミット |
|---|---|---|
| 1 | 本設計メモ追加 | 1 |
| 2 | scene.ts に executeEditorScript ヘルパー | 1 |
| 3 | debug-tools.ts に execute_editor_script ツール定義 + dispatch | 1 |
| 4 | レスポンスシリアライザ (serializeForResponse) | 同上 |
| 5 | 回帰テスト (実呼び出し型) | 1 |
| 6 | README にセキュリティ警告とサンプル追加 | 1 |

## 回帰テストの方針

1. 基本: `return 1+1` → result===2
2. await 動作: `await new Promise(r => setTimeout(r, 50)); return "done"`
3. cc アクセス: `return cc.Node.name === "Node"`
4. Editor.Message アクセス: `const v = await Editor.Message.request("scene", "query-scene-bounds"); return v`
5. logs キャプチャ: returnLogs=true で console.log のキャプチャ確認
6. エラー catch: `throw new Error("test-marker")` → success:false + error 文字列
7. timeout: `await new Promise(() => {})` (永久に解決しない) + timeoutMs:100 → タイムアウトエラー
8. Node シリアライズ: `return cc.find("Canvas")` → `{__node__: true, ...}` 形式
9. 循環参照: 循環参照を含む値を返してもエラーにならない

## 関連 issue / PR

- Issue #29 (圧縮の限界 + execute_editor_script 脱出口) — 本 PR でカバー
- 親 PR: #31 (v2.0.0 着手)
- 設計参照: `docs/design/tool-topology.md` (PR #30 マージ済み)
