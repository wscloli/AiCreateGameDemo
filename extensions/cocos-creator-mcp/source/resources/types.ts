/**
 * MCP Resource definitions (v2.0.0).
 *
 * Resources are read-only data sources exposed via URI, separate from tools.
 * They are listed via `resources/list` and `resources/templates/list`, and
 * fetched via `resources/read`. Reading a resource does not appear in the
 * tools surface, so resources do not consume tool description tokens.
 */

/**
 * A single resource definition. Provides exactly one of `uri` (fixed URI)
 * or `uriTemplate` (URI with {param} placeholders).
 */
export interface ResourceDef {
    /** Fixed URI (e.g. "cocos://scene/current"). Mutually exclusive with uriTemplate. */
    uri?: string;
    /** URI template with {param} placeholders (e.g. "cocos://node/{uuid}"). Mutually exclusive with uri. */
    uriTemplate?: string;
    /** Short display name. */
    name: string;
    /** Description shown to the LLM via resources/list. */
    description: string;
    /** MIME type of the returned content. Default: "application/json". */
    mimeType?: string;
    /**
     * Read the resource. `params` contains values extracted from uriTemplate placeholders
     * (empty object for fixed-URI resources). Returns the data to serialize as JSON.
     */
    read(params: Record<string, string>): Promise<unknown>;
}

/** Match result for parseUri. */
export interface ResourceMatch {
    def: ResourceDef;
    params: Record<string, string>;
}
