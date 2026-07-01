# MCP Resource API 設計メモ（v2.0.0 Phase 1-4）

Issue #27 ④ の対応。読み出し系の操作を MCP の `resource` 概念に分離し、tool 表面を slim にする。

## 背景

`tools/list` に含まれる description は毎リクエスト LLM context に積まれるため、読み出し系（query 系）も全部 tool として並んでいると token 消費が増える。

MCP には **resource** という別のプリミティブがあり：
- `resources/list` で利用可能な URI 一覧を取得（説明文付き）
- `resources/read` で URI の内容を読み出し
- `resources/templates/list` でパラメータ付き URI テンプレートを取得

LLM クライアント側はツール一覧とは別に resource をハンドリングするので、tools の description token に乗らない（あるいは半分くらい）。

MCP for Unity は **18 resources + 30 tools** の構成。本拡張も同方針に揃える。

## 設計する URI スキーマ

`cocos://` プレフィックスで Cocos Creator 専用 namespace。

| URI | 内容 | 対応する既存ツール |
|---|---|---|
| `cocos://scene/current` | 現在のシーン名・UUID | `scene_get_current` |
| `cocos://scene/list` | 全 .scene ファイル一覧 | `scene_get_list` |
| `cocos://scene/hierarchy` | 現在のシーンの hierarchy (node tree) | `scene_get_hierarchy` |
| `cocos://node/{uuid}` | 特定ノードの dump（components 含む） | `scene_query_node` |
| `cocos://node/{uuid}/components` | ノードのコンポーネント一覧 (uuid + type) | `component_get_components` |
| `cocos://component/{uuid}` | コンポーネント詳細 | `component_get_info` / `scene_query_component` |
| `cocos://prefab/list` | Prefab 一覧 | `prefab_list` |
| `cocos://prefab/{uuid}` | Prefab 情報 | `prefab_get_info` |
| `cocos://project/info` | プロジェクト名・パス | `project_get_info` |
| `cocos://project/engine` | エンジンバージョン・パス | `project_get_engine_info` |
| `cocos://asset/{uuid}` | アセット詳細 | `asset_get_details` |
| `cocos://editor/info` | エディタバージョン・platform | `debug_get_editor_info` |

合計 12 個程度。これに伴い Phase 3 で対応する read-only tools を削除できる（推定 10-12 個削減）。

## MCP プロトコル

### resources/list

```json
{
    "resources": [
        {
            "uri": "cocos://scene/current",
            "name": "Current Scene",
            "description": "Name and UUID of the currently open scene.",
            "mimeType": "application/json"
        },
        ...
    ]
}
```

### resources/templates/list

`{uuid}` のような placeholder を含むテンプレート URI を返す。

```json
{
    "resourceTemplates": [
        {
            "uriTemplate": "cocos://node/{uuid}",
            "name": "Node Dump",
            "description": "Full property dump of a node by UUID. Includes components.",
            "mimeType": "application/json"
        },
        ...
    ]
}
```

### resources/read

```json
// request
{ "method": "resources/read", "params": { "uri": "cocos://node/abc123" } }

// response
{
    "contents": [
        {
            "uri": "cocos://node/abc123",
            "mimeType": "application/json",
            "text": "{\"uuid\":\"abc123\",\"name\":\"Canvas\",...}"
        }
    ]
}
```

## 実装方針

### ファイル構成

新規ファイル: `source/resources/resource-registry.ts`

```ts
export interface ResourceDef {
    uri?: string;                    // 固定 URI
    uriTemplate?: string;            // テンプレート URI ({uuid} 等を含む)
    name: string;
    description: string;
    mimeType?: string;
    read(params: Record<string, string>): Promise<unknown>;
}
```

各 resource は専用の `read` 関数を持つ。`mcp-server.ts` に `resources/list` / `resources/templates/list` / `resources/read` の handler を追加。

### URI パース

```ts
function parseUri(uri: string): { uri: string; params: Record<string, string> } | null {
    // cocos://node/abc123 → match cocos://node/{uuid} template
    for (const r of registry) {
        if (r.uri && r.uri === uri) return { uri, params: {} };
        if (r.uriTemplate) {
            const re = new RegExp("^" + r.uriTemplate.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)") + "$");
            const m = re.exec(uri);
            if (m) return { uri, params: m.groups || {} };
        }
    }
    return null;
}
```

### read 実装の再利用

既存ツールのロジックを resource 経由でも使えるよう抽出。例：

```ts
// resources/scene-resources.ts
import { sceneTools } from "../tools/scene-tools";

export const sceneCurrentResource: ResourceDef = {
    uri: "cocos://scene/current",
    name: "Current Scene",
    description: "Name and UUID of the currently open scene.",
    mimeType: "application/json",
    async read() {
        const dump = await Editor.Message.request("scene", "query-current-scene");
        return { name: dump?.name, uuid: dump?.uuid };
    },
};
```

旧 tool 経由でも resource 経由でも同じ実装を呼ぶ（クリーンアップ Phase 3 までは並存）。

## 段階実装プラン

| Step | 内容 | コミット |
|---|---|---|
| 1 | 本設計メモ追加 | 1 |
| 2 | `source/resources/types.ts` + `registry.ts` の枠組み | 1 |
| 3 | scene 系 resource (4 URI) | 1 |
| 4 | node / component 系 resource (3 URI) | 1 |
| 5 | prefab / asset / project / editor 系 resource | 1 |
| 6 | `mcp-server.ts` に resources/list / templates / read を結線 | 同上 |
| 7 | 回帰テスト (resources/list と各 URI の read) | 1 |
| 8 | README に Resource 節を追加 | 1 |

## 回帰テストの方針（実動作検証型）

1. `resources/list` で 12 個前後の resource が返る
2. `resources/templates/list` でテンプレート URI が返る
3. `cocos://scene/current` で現在シーン情報が取れる
4. `cocos://node/<Canvas UUID>` で Canvas dump が取れる
5. `cocos://component/<UUID>` でコンポーネント dump
6. 存在しない URI でエラー
7. テンプレート未マッチ URI でエラー

## クリーンアップ (Phase 3 と連動)

Resource に置き換えられた read-only tools (`scene_get_current`, `scene_get_list`, `scene_get_hierarchy`, `scene_query_node`, `component_get_components`, `component_get_info`, `scene_query_component`, `prefab_list`, `prefab_get_info`, `project_get_info`, `project_get_engine_info`, `asset_get_details`, `debug_get_editor_info`) は Phase 3 で削除する。

ただし `scene_query_node` 等で取れる詳細 dump は LLM が tool 経由で expect する場合があるため、慎重に判断（一部は tool として残す可能性あり）。

## 関連 issue / PR

- Issue #27 ④ Prefab/Scene の resource API
- Issue #28 category_action 集約（同じ方向性: tool slim 化）
- 設計参照: `docs/design/tool-topology.md` (PR #30 マージ済み)
- 親 PR: #31 (v2.0.0 着手)
