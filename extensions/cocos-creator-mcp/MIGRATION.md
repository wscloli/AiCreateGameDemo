# Migration Guide: v1 → v2.0.0

v2.0.0 is a **major release** with breaking changes. This document maps every v1 tool to its v2 equivalent.

## TL;DR

- **Aggregated**: many v1 tools are now actions of a single `category_action` tool (e.g. `node_create` → `node_manage(action: "create")`).
- **Removed**: read-only tools (`scene_query_node`, `component_get_info`, `prefab_list`, etc.) are now MCP **Resources** (`cocos://...`). Call them via `resources/read` instead of `tools/call`.
- **Renamed**: a few parameters renamed for consistency (`parentUuid` → `parent`, `scene_open.uuid` → `scene`, `view_focus_on_node.uuid` → `uuids` array).
- **Deprecated → Removed**: `debug_get_console_logs` / `debug_clear_console` are replaced by the unified `read_console`.

## Tool Mapping

### Scene

| v1 | v2 |
|---|---|
| `scene_get_hierarchy` | `scene_manage(action: "hierarchy")` or `cocos://scene/hierarchy` |
| `scene_open` | `scene_manage(action: "open", scene)` — note `uuid` → `scene` rename |
| `scene_save` | `scene_manage(action: "save")` |
| `scene_close` | `scene_manage(action: "close")` |
| `scene_get_list` | `scene_manage(action: "list")` or `cocos://scene/list` |
| `scene_get_current` | `scene_manage(action: "current")` or `cocos://scene/current` |
| `scene_copy_node` | `scene_clipboard(action: "copy", uuid)` |
| `scene_paste_node` | `scene_clipboard(action: "paste", parentUuid)` |
| `scene_cut_node` | `scene_clipboard(action: "cut", uuid)` |
| `scene_snapshot` | `scene_undo(action: "snapshot")` |
| `scene_snapshot_abort` | `scene_undo(action: "snapshot_abort")` |
| `scene_begin_undo` | `scene_undo(action: "begin")` |
| `scene_end_undo` | `scene_undo(action: "end")` |
| `scene_cancel_undo` | `scene_undo(action: "cancel")` |
| `scene_move_array_element` | `scene_array(action: "move", uuid, path, target, offset)` |
| `scene_remove_array_element` | `scene_array(action: "remove", uuid, path, index)` |
| `scene_reset_node_transform` | `scene_reset(action: "transform", uuid)` |
| `scene_reset_property` | `scene_reset(action: "property", uuid, path)` |
| `scene_reset_component` | `scene_reset(action: "component", uuid)` |
| `scene_restore_prefab` | `scene_reset(action: "restore_prefab", uuid)` |
| `scene_query_node_tree` | **Resource:** `cocos://scene/hierarchy` |
| `scene_query_node` | **Resource:** `cocos://node/{uuid}` |
| `scene_query_component` | **Resource:** `cocos://component/{uuid}` |
| `scene_query_dirty` | `scene_query(action: "dirty")` |
| `scene_query_ready` | `scene_query(action: "ready")` |
| `scene_query_classes` | `scene_query(action: "classes")` |
| `scene_query_components` | `scene_query(action: "components", uuid)` |
| `scene_query_component_has_script` | `scene_query(action: "component_has_script", name)` |
| `scene_query_nodes_by_asset` | `scene_query(action: "nodes_by_asset", assetUuid)` |
| `scene_query_scene_bounds` | `scene_query(action: "scene_bounds")` |

### View

| v1 | v2 |
|---|---|
| `view_change_gizmo_tool` | `view_gizmo(action: "set_tool", tool)` |
| `view_query_gizmo_tool` | `view_gizmo(action: "get_tool")` |
| `view_change_gizmo_pivot` | `view_gizmo(action: "set_pivot", pivot)` |
| `view_query_gizmo_pivot` | `view_gizmo(action: "get_pivot")` |
| `view_change_gizmo_coordinate` | `view_gizmo(action: "set_coordinate", coordinate)` |
| `view_query_gizmo_coordinate` | `view_gizmo(action: "get_coordinate")` |
| `view_change_mode_2d_3d` | `view_settings(action: "set_mode", mode)` |
| `view_query_mode_2d_3d` | `view_settings(action: "get_mode")` |
| `view_set_grid_visible` | `view_settings(action: "set_grid", visible)` |
| `view_query_grid_visible` | `view_settings(action: "get_grid")` |
| `view_set_icon_gizmo_3d` | `view_settings(action: "set_icon3d", enabled)` |
| `view_query_icon_gizmo_3d` | `view_settings(action: "get_icon3d")` |
| `view_set_icon_gizmo_size` | `view_settings(action: "set_icon_size", size)` |
| `view_query_icon_gizmo_size` | `view_settings(action: "get_icon_size")` |
| `view_get_status` | `view_settings(action: "status")` |
| `view_reset` | `view_settings(action: "reset")` |
| `view_focus_on_node` | `view_camera(action: "focus_on_nodes", uuids)` — note `uuid` → `uuids` array |
| `view_align_with_view` | `view_camera(action: "align_with_view")` |
| `view_align_view_with_node` | `view_camera(action: "align_view_with_node")` |

### Node

| v1 | v2 |
|---|---|
| `node_create` | `node_manage(action: "create", name, parent?, components?)` |
| `node_delete` | `node_manage(action: "delete", uuid)` |
| `node_duplicate` | `node_manage(action: "duplicate", uuid)` |
| `node_move` | `node_manage(action: "move", uuid, parent)` — `parentUuid` renamed to `parent` |
| `node_set_layer` | `node_set_property(uuid, property: "layer", value)` — tool removed |
| `node_set_property`, `node_set_transform`, `node_set_active`, `node_set_layout`, `node_create_tree`, `node_get_info`, `node_find_by_name`, `node_get_all`, `node_detect_type` | unchanged |

### Component

| v1 | v2 |
|---|---|
| `component_add` | `component_manage(action: "add", uuid, componentType)` |
| `component_remove` | `component_manage(action: "remove", uuid, componentType)` |
| `component_get_available` | `component_manage(action: "available")` |
| `component_query_enum` | `component_manage(action: "enum", uuid, componentType, property)` |
| `component_get_components` | **Resource:** `cocos://node/{uuid}/components` |
| `component_get_info` | **Resource:** `cocos://component/{uuid}` |
| `component_set_property`, `component_auto_bind` | unchanged (enhanced — see Value Reference Forms in README) |

### Prefab

| v1 | v2 |
|---|---|
| `prefab_open` | `prefab_edit(action: "open", uuid or path)` |
| `prefab_close` | `prefab_edit(action: "close")` |
| `prefab_list` | **Resource:** `cocos://prefab/list` |
| `prefab_get_info` | **Resource:** `cocos://prefab/{uuid}` |
| `prefab_create` (v1: extract a node) | `prefab_create(mode: "simple", uuid, path)` — mode default also `simple` so existing calls still work parameter-wise |
| `prefab_create_and_replace` | `prefab_create(mode: "replace", uuid, path)` |
| `prefab_create_from_spec` | `prefab_create(mode: "from_spec", path, spec [, autoBindMode])` |
| `prefab_instantiate`, `prefab_update`, `prefab_revert`, `prefab_duplicate`, `prefab_validate` | unchanged |

### Asset

| v1 | v2 |
|---|---|
| `asset_create`, `asset_delete`, `asset_move`, `asset_copy`, `asset_save`, `asset_reimport`, `asset_import`, `asset_save_meta`, `asset_open_external` | `asset_manage(action: ..., ...)` |
| `asset_query_path`, `asset_query_uuid`, `asset_query_url`, `asset_get_details`, `asset_get_dependencies`, `asset_query_users`, `asset_query_missing`, `asset_query_ready`, `asset_generate_available_url` | `asset_query(action: ..., ...)` |

### Project

| v1 | v2 |
|---|---|
| `project_get_info` | **Resource:** `cocos://project/info` |
| `project_get_engine_info` | **Resource:** `cocos://project/engine` |
| `project_refresh_assets`, `project_get_asset_info`, `project_find_asset`, `project_get_settings`, `project_set_settings`, `project_query_scripts` | unchanged |

### Debug

| v1 | v2 |
|---|---|
| `debug_get_console_logs` | `read_console(action: "get", types?, sources?, count?, since?, search?)` |
| `debug_clear_console` | `read_console(action: "clear", sources?)` |
| `debug_get_editor_info` | **Resource:** `cocos://editor/info` |
| `debug_get_project_logs` | `debug_logs(action: "get", lines?)` |
| `debug_search_project_logs` | `debug_logs(action: "search", pattern)` — `keyword` renamed to `pattern` |
| `debug_get_log_file_info` | `debug_logs(action: "info")` |
| `debug_list_extensions` | `debug_extension(action: "list")` |
| `debug_get_extension_info` | `debug_extension(action: "info", name)` |
| `debug_reload_extension` | `debug_extension(action: "reload")` |
| `debug_record_start` | `debug_record(action: "start", ...)` |
| `debug_record_stop` | `debug_record(action: "stop", timeout?)` |
| `debug_screenshot` (window) | `debug_screenshot(target: "window", ...)` — `target` default `"window"` so existing calls still work |
| `debug_batch_screenshot` | `debug_screenshot(target: "pages", pages, ...)` |
| `debug_validate_scene`, `debug_clear_code_cache`, `debug_wait_compile`, `debug_query_devices`, `debug_open_url`, `debug_preview`, `debug_game_command`, `debug_execute_script`, `debug_list_messages` | unchanged |

### Preferences / Builder / Server

| v1 | v2 |
|---|---|
| `preferences_get`, `preferences_set`, `preferences_get_all`, `preferences_reset` | `preferences_manage(action: ...)` |
| `builder_open_panel`, `builder_get_settings`, `builder_query_tasks`, `builder_run_preview`, `builder_stop_preview` | `builder_manage(action: ...)` |
| `server_query_ip_list`, `server_query_port`, `server_get_status`, `server_get_build_hash`, `server_check_connectivity`, `server_get_network_interfaces`, `server_check_code_sync` | `server_status(action: ...)` |

### Reference Image

| v1 | v2 |
|---|---|
| `refimage_add`, `refimage_remove`, `refimage_clear_all`, `refimage_switch`, `refimage_refresh` | `refimage_manage(action: ...)` |
| `refimage_set_position`, `refimage_set_scale`, `refimage_set_opacity` | `refimage_set(action: ...)` |
| `refimage_list`, `refimage_query_config`, `refimage_query_current` | `refimage_query(action: ...)` |

## New in v2.0.0

These tools did not exist in v1:

- **`read_console`** — replaces `debug_get_console_logs` + `debug_clear_console`, adds `editor` source (compile errors via `project.log` fallback), type/source filters, `since`/`search`.
- **`execute_editor_script`** — escape hatch for arbitrary editor-side JavaScript. Use for atomic transactions, experimental APIs, bulk operations.

## New: MCP Resources (`cocos://...`)

Resources are read-only data exposed via URI, separate from tools. Call via `resources/read`, not `tools/call`. They don't appear in `tools/list` so they don't consume tool description tokens.

See [README.md](./README.md#available-resources-12) for the full URI list.

## `component_set_property` value reference forms (enhanced)

Asset references, node references, enums, and structured value types now accept multiple convenient forms:

```jsonc
// asset references — all four equivalent for a SpriteFrame field:
{ "value": "<uuid>" }
{ "value": "db://assets/textures/foo.png" }
{ "value": { "path": "db://assets/textures/foo.png" } }
{ "value": { "guid": "<uuid>" } }

// node references — by descendant path or direct UUID:
{ "value": "@path:Canvas/Background" }
{ "value": "<node-uuid>" }

// enum values:
{ "value": "HORIZONTAL" }  // name (v2.0.0)
{ "value": 1 }              // numeric (still supported)

// structured value types:
{ "value": { "x": 100, "y": 50, "z": 0 } }       // cc.Vec3
{ "value": { "r": 255, "g": 0, "b": 0, "a": 255 } }  // cc.Color
{ "value": { "width": 200, "height": 100 } }     // cc.Size
```

These also work inside `prefab_create_from_spec`'s `spec.properties` (the v1 asset-ref serialization bug is fixed in v2.0.0).
