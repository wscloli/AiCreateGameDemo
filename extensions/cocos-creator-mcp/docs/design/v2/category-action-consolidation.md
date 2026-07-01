# `category_action` 集約 設計メモ（v2.0.0 Phase 2）

Issue #28 の対応。現状 166 ツールを **30〜50 ツール程度に圧縮**して LLM 体感を改善する。

## 現状（v2.0.0 着手時点）

```
36 scene_*    （含 scene_advanced）
22 debug_*
18 asset_*
15 view_*
14 node_*
12 prefab_*
11 refimage_*
 8 project_*
 8 component_*
 7 server_*
 5 builder_*
 4 preferences_*
 1 read_console
 1 execute_editor_script
─────────
166 tools
```

設計ドキュメント `docs/design/tool-topology.md` で「30〜50 ツール + execute_editor_script 脱出口 + Resource API」を最適解と定義済み。

## 設計方針（4 つの圧縮レーン）

### レーン1: Resource に移行して tool から削除（Phase 3 で実行）

Phase 1-4 で実装した 12 個の Resource (`cocos://`) に対応する読み出し系 tool を削除：

- `scene_get_current`, `scene_get_list`, `scene_get_hierarchy` (3)
- `component_get_components`, `component_get_info` (2)
- `scene_query_node`, `scene_query_component` (2 — ただし詳細 dump 用に残すか判断)
- `prefab_list`, `prefab_get_info` (2)
- `project_get_info`, `project_get_engine_info` (2)
- `asset_get_details` (1)
- `debug_get_editor_info` (1)

**削減: 13 tools**

### レーン2: CRUD / lifecycle を action_pattern に集約

似たライフサイクルツールを `{category}_manage(action: "...")` パターンに統合：

| 集約後 | 元のツール | 削減 |
|---|---|---|
| `scene_manage(action)` | `scene_open`, `scene_save`, `scene_save_as`, `scene_close`, `scene_create`, `scene_soft_reload` | 6→1 |
| `node_manage(action)` | `node_create`, `node_delete`, `node_duplicate`, `node_move` | 4→1 |
| `component_manage(action)` | `component_add`, `component_remove`, `component_query_enum`, `component_get_available` | 4→1 |
| `prefab_manage(action)` | `prefab_create`, `prefab_create_and_replace`, `prefab_create_from_spec`, `prefab_duplicate`, `prefab_instantiate`, `prefab_revert`, `prefab_validate`, `prefab_update` | 8→1 |
| `prefab_edit(action)` | `prefab_open`, `prefab_close` | 2→1 |
| `asset_manage(action)` | `asset_create`, `asset_delete`, `asset_move`, `asset_copy`, `asset_import`, `asset_save`, `asset_reimport`, `asset_save_meta`, `asset_open_external` | 9→1 |
| `asset_query(action)` | `asset_query_path`, `asset_query_uuid`, `asset_query_url`, `asset_query_dependencies`, `asset_query_users`, `asset_query_missing`, `asset_query_ready`, `asset_generate_available_url` | 8→1 |
| `view_gizmo(action)` | `view_change_gizmo_tool`, `view_query_gizmo_tool`, `view_change_gizmo_pivot`, `view_query_gizmo_pivot`, `view_change_gizmo_coordinate`, `view_query_gizmo_coordinate` | 6→1 |
| `view_settings(action)` | `view_set_grid_visible`, `view_query_grid_visible`, `view_set_icon_gizmo_3d`, `view_query_icon_gizmo_3d`, `view_set_icon_gizmo_size`, `view_query_icon_gizmo_size`, `view_change_mode_2d_3d`, `view_query_mode_2d_3d`, `view_get_status`, `view_reset` | 10→1 |
| `view_camera(action)` | `view_focus_on_node`, `view_align_with_view`, `view_align_view_with_node` | 3→1 |
| `refimage_manage(action)` | `refimage_add`, `refimage_remove`, `refimage_clear_all`, `refimage_switch`, `refimage_refresh` | 5→1 |
| `refimage_set(action)` | `refimage_set_position`, `refimage_set_scale`, `refimage_set_opacity` | 3→1 |
| `refimage_query(action)` | `refimage_list`, `refimage_query_config`, `refimage_query_current` | 3→1 |
| `preferences_manage(action)` | `preferences_get`, `preferences_set`, `preferences_get_all`, `preferences_reset` | 4→1 |
| `builder_manage(action)` | `builder_open_panel`, `builder_get_settings`, `builder_query_tasks`, `builder_run_preview`, `builder_stop_preview` | 5→1 |
| `server_status(action)` | `server_query_ip_list`, `server_query_port`, `server_get_status`, `server_check_connectivity`, `server_get_network_interfaces`, `server_get_build_hash`, `server_check_code_sync` | 7→1 |
| `scene_clipboard(action)` | `scene_copy_node`, `scene_paste_node`, `scene_cut_node` | 3→1 |
| `scene_undo(action)` | `scene_snapshot`, `scene_snapshot_abort`, `scene_begin_undo`, `scene_end_undo`, `scene_cancel_undo` | 5→1 |
| `scene_array(action)` | `scene_move_array_element`, `scene_remove_array_element` | 2→1 |
| `scene_reset(action)` | `scene_reset_node_transform`, `scene_reset_property`, `scene_reset_component`, `scene_restore_prefab` | 4→1 |
| `debug_logs(action)` | `debug_get_project_logs`, `debug_search_project_logs`, `debug_get_log_file_info` | 3→1 |
| `debug_record(action)` | `debug_record_start`, `debug_record_stop` | 2→1 |
| `debug_extension(action)` | `debug_list_extensions`, `debug_get_extension_info`, `debug_reload_extension` | 3→1 |
| `debug_preview(action)` | `debug_preview`, `debug_screenshot`, `debug_batch_screenshot`, `debug_game_command` | 4→1 |

**削減: 106→24 = 82 tools**

### レーン3: そのまま残す（特殊・高頻度・LLM 誘導したい）

description が直感的で選択精度に効くもの、または独自パラメータが大きいもの：

- `read_console` — 体感効果最重要、専用名で残す
- `execute_editor_script` — 脱出口、専用名
- `component_set_property` — Phase 1-2 で強化済みの主力 setter
- `component_auto_bind` — Prefab 構築の主力
- `node_set_property`, `node_set_transform`, `node_set_active`, `node_set_layer`, `node_set_layout` — node 編集の主力（よく使う）
- `node_create_tree` — Prefab 構築の入口
- `node_find_by_name`, `node_detect_type`, `node_get_all` — クエリ系（resource にもあるが tool で使う）
- `node_get_info` — 詳細 dump、tool 経由で使う場面が多い
- `scene_execute_script`, `scene_execute_component_method`, `scene_query_classes`, `scene_query_dirty`, `scene_query_ready`, `scene_query_nodes_by_asset`, `scene_query_scene_bounds`, `scene_query_component_has_script` — 既存利用パターン、見直し検討
- `scene_set_parent`
- `debug_validate_scene`, `debug_query_devices`, `debug_open_url`, `debug_clear_code_cache`, `debug_wait_compile`, `debug_get_console_logs` (deprecated→削除), `debug_clear_console` (deprecated→削除), `debug_execute_script`
- `project_refresh_assets`, `project_get_asset_info`, `project_find_asset`, `project_get_settings`, `project_set_settings`, `project_query_scripts`

**残す: 推定 30 tools**

### レーン4: 削除（重複・低価値）

- `debug_get_console_logs` (deprecated, read_console に統合)
- `debug_clear_console` (deprecated, read_console に統合)
- `scene_query_node_tree` (resource cocos://scene/hierarchy で代替)

**削減: 3 tools**

## 集約後の数値見積もり

```
現状: 166 tools

レーン1 (resource 移行で削除):  -13
レーン2 (action 集約):           -82
レーン3 (そのまま残す):            0
レーン4 (重複削除):              -3
新規追加 (集約後の category_action tools): +24
─────────
最終: 166 - 13 - 82 - 3 + 24 = 92 tools
```

92 tools は当初目標 (30〜50) より多い。さらに圧縮するには：

- レーン3 の「残す tools」を見直して action 集約に取り込む（推定 10-15 個減らせる）
- 一部 tool を Resource に移行（推定 5 個）

**現実的な最終目標: 70〜80 tools**。MCP for Unity (30 tools + 18 resources = 48) より多いが、Cocos のドメインカバレッジ（scene/prefab/asset/builder の操作幅）を考えると妥当な範囲。

## マイグレーション方針

**v2.0.0 では旧ツールを削除（[[feedback_cocos_mcp_v2_remove_unused]] に従う、エイリアス保持しない）**

- 集約された旧ツール (例: `scene_open`) は `scene_manage(action="open", ...)` に置き換え
- README / CHANGELOG / MIGRATION.md で **旧 → 新の対応表** を提示
- 外部利用者（@Cuick 等）には事前告知 issue を立てる

## 段階実装プラン

| Step | 内容 | コミット |
|---|---|---|
| 1 | 本設計メモ追加 | 1 |
| 2 | レーン2 のうち優先度高 5 カテゴリ (scene/node/component/prefab/asset の lifecycle) を集約実装 | 5 |
| 3 | 残り (view/refimage/preferences/builder/server/debug) を集約 | 5-7 |
| 4 | レーン1 + レーン4 で旧ツール削除 (Phase 3 の一部) | 1-2 |
| 5 | README に新ツール体系を反映 | 1 |
| 6 | MIGRATION.md に旧→新対応表を作成 | 1 |
| 7 | 回帰テストを新ツール名へ移行 | 1-2 |

合計推定 15-18 commit、Phase 2 + Phase 3 の前半を兼ねる。

## 回帰テストの方針

集約された各 `{category}_{verb}(action)` ツールについて：
1. tools/list に登録されている
2. 各 action が動作する（旧ツールと同じ effect を生む）
3. 不正な action は error 返却
4. 必須パラメータ欠落は error 返却

## 関連 issue / PR

- Issue #28 (category_action 集約)
- Issue #29 (圧縮の限界 + execute_editor_script 脱出口) — execute_editor_script は Phase 1-5 で実装済み
- 設計参照: `docs/design/tool-topology.md` (PR #30 マージ済み)
- 親 PR: #31 (v2.0.0 着手)
