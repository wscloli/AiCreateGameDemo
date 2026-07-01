# `component_set_property` 強化設計メモ（v2.0.0 Phase 1-2）

Issue #27 ① + ② の統合対応として、既存 `component_set_property` を「Reflection 設計はそのままに、参照解決の透過化と値型ヘルパーを上乗せする」改修。

## 既存実装の整理（調査結果）

`source/tools/component-tools.ts` の `buildDumpWithTypeInfo` で以下は実装済み：

| 機能 | 状態 |
|---|---|
| `componentType + property + value` で任意プロパティを設定 | ✅ |
| 複数プロパティ一括設定 (`properties` 配列) | ✅ |
| プリミティブ型 (Number/Boolean) の自動 dump | ✅ |
| Component / Node / Asset 参照型の `query-node` 経由型解決 | ✅ |
| `{uuid, type}` オブジェクト形式の受付 | ✅ |
| `{uuid}` だけ → 文字列扱いで型解決 | ✅ |
| `@path:Canvas/Bg` 形式の node path 解決 | ✅（README 未掲載） |
| stringified args の defensive parse | ✅ |
| `cc.Widget._alignFlags` の自動再計算 | ✅（v1.14.0） |
| nodeName / uuid どちらでも受付 | ✅ |

つまり **issue #27 ① の「Reflection ベース汎用 `set_property`」は既に実装済み**。

## 残課題（v2.0.0 で解消する 5 つ）

### 1. Asset path → UUID 自動解決

**現状:** Asset 参照は UUID 文字列のみ受付。`db://assets/textures/foo.png` を渡せない。
**改修:** `value` が `db://` 始まりなら `asset-db` の `query-uuid` で UUID に変換してから dump。

```ts
// buildDumpWithTypeInfo の文字列分岐に追加
if (typeof value === "string" && value.startsWith("db://")) {
    const uuid = await Editor.Message.request("asset-db", "query-uuid", value);
    if (uuid) value = uuid;  // 以降は既存の Asset ref 経路に流れる
}
```

### 2. `{path: "db://..."}` / `{guid: "..."}` オブジェクト受付

**現状:** Asset 参照を渡す場合は `{uuid, type}` のみ。
**改修:** MCP for Unity 流の `{path: "db://..."}` と `{guid: "..."}` も受付：

```ts
if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.path === "string" && value.path.startsWith("db://")) {
        const uuid = await Editor.Message.request("asset-db", "query-uuid", value.path);
        if (uuid) return { type: value.type || resolvedType, value: { uuid } };
    }
    if (typeof value.guid === "string") {
        return { type: value.type || resolvedType, value: { uuid: value.guid } };
    }
}
```

### 3. enum 名で入力受付

**現状:** enum は数値のみ受付。`Layout.type` に `"HORIZONTAL"` を渡せない。
**改修:** 文字列で渡された場合、プロパティ dump の `enumList` から名前 → 数値変換：

```ts
if (typeof value === "string") {
    // ...existing type-resolve logic...
    if (propDump.type === "Enum" && Array.isArray(propDump.enumList)) {
        const item = propDump.enumList.find((e: any) => e.name === value);
        if (item) return { value: item.value, type: "Enum" };
    }
}
```

### 4. Vec3 / Color の入力簡易化

**現状:** `{x, y, z}` で渡しても `{ value: { x: { value: 0 }, ... } }` に wrap される（一般オブジェクト処理）。
これが cc.Vec3 として正しく dump されているかは要検証。
**改修:** プロパティ型が `cc.Vec3` / `cc.Vec2` / `cc.Color` / `cc.Size` の場合、専用の dump 形式を構築：

```ts
const VALUE_TYPES = {
    "cc.Vec3": (v: any) => ({ value: { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 }, type: "cc.Vec3" }),
    "cc.Vec2": (v: any) => ({ value: { x: v.x ?? 0, y: v.y ?? 0 }, type: "cc.Vec2" }),
    "cc.Color": (v: any) => ({ value: { r: v.r ?? 0, g: v.g ?? 0, b: v.b ?? 0, a: v.a ?? 255 }, type: "cc.Color" }),
    "cc.Size": (v: any) => ({ value: { width: v.width ?? v.x ?? 0, height: v.height ?? v.y ?? 0 }, type: "cc.Size" }),
};
```

### 5. `prefab_create_from_spec` の asset ref シリアライズ修正

**現状（README Known Limitation）:** `prefab_create_from_spec` の spec で `properties` に asset 参照（spriteFrame 等）を含めると、生成された `.prefab` JSON に raw UUID 文字列が書かれ、runtime で `{__uuid__, __expectedType__}` 形式に解決されず Sprite が表示されない。

**改修方針:**
- `prefab_create_from_spec` 実装内で、最終的に書き出される `.prefab` JSON を post-process し、asset 参照箇所を `{__uuid__, __expectedType__}` 形式に書き換える
- 対象フィールドは prop dump で `extends` に `cc.Asset` が含まれる、または既知の asset ref フィールド（`_spriteFrame`, `_atlas`, `_font` 等）
- 既存テストで動作を確認

詳細実装場所: `source/tools/prefab-tools.ts` 内の `createFromSpec` メソッド付近。

## 段階実装プラン

| Step | 内容 | コミット |
|---|---|---|
| 1 | 本設計メモを `docs/design/v2/component-set-property-enhance.md` に追加 | 1 |
| 2 | Asset path (`db://`) 文字列の自動 UUID 解決 | 1 |
| 3 | `{path}` / `{guid}` オブジェクト形式の受付 | 1 |
| 4 | enum 名の自動変換 (`enumList` 経由) | 1 |
| 5 | Vec3 / Vec2 / Color / Size の専用 dump | 1 |
| 6 | `prefab_create_from_spec` の asset ref シリアライズ修正 | 1 |
| 7 | README 更新: `@path:` の既存機能、`db://` / `{path}` の新機能、Known Limitation の解消を反映 | 1 |
| 8 | 回帰テスト追加（マーカー注入＋実 dump 検証） | 1 |

## 回帰テストの方針（実動作検証型）

1. **Asset path 解決テスト**: Sprite の `spriteFrame` に `db://internal/default_ui/default_btn/spriteFrame` を渡して dump を確認 → UUID に解決されていること
2. **`{path}` 形式テスト**: 同上を `{ path: "db://..." }` で渡す
3. **`{guid}` 形式テスト**: 同上を `{ guid: "<uuid>" }` で渡す
4. **enum 名テスト**: `Layout.type` に `"HORIZONTAL"` を渡す → 数値変換されて反映されること
5. **Vec3 テスト**: `UITransform.contentSize` に `{ width: 100, height: 50 }` を渡す
6. **Color テスト**: `Sprite.color` に `{ r: 255, g: 0, b: 0, a: 255 }` を渡す
7. **prefab_create_from_spec asset ref テスト**: spec に spriteFrame 参照を含めて生成 → `.prefab` JSON を読み戻して `{__uuid__, __expectedType__}` 形式になっていること
8. **後方互換テスト**: UUID 直渡しも依然動くこと（既存パターン）

## 関連 issue / PR

- Issue #27 ① 汎用 `set_property` ツール — 結論: 既に実装済み、強化のみ必要
- Issue #27 ② 参照解決を透過に — 本 PR でカバー
- README Known Limitation: `prefab_create_from_spec` の asset ref バグ — 本 PR で解消
- 親 PR: #31 (v2.0.0 着手)
- 設計参照: `docs/design/tool-topology.md` (PR #30 マージ済み)

## 後方互換性

すべて **既存 API の上乗せ強化**。破壊的変更なし：

- 文字列 UUID 直渡し: 引き続き動作
- `{uuid, type}` 形式: 引き続き動作
- 数値での enum 入力: 引き続き動作
- `@path:` 形式: 引き続き動作（README に追加するだけ）

新規対応：
- `db://` 文字列
- `{path}` / `{guid}` オブジェクト
- enum 名文字列
- Vec3 / Color の単純オブジェクト形式
