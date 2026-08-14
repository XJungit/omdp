// SKELETON — host-only DSH bundle plugin.
// Copy this file into a new plugin directory, rename, and implement your logic.
//
// Conventions (from docs/user/develop/basic):
//   - `export const inject` lists the Cordis services this plugin needs.
//   - `export const Config` is a Schemastery schema; anything two deployments
//     may want to set differently MUST be a config field (see config.md).
//   - `apply(ctx, config)` is the entry point. Registrations are effects and
//     clean themselves up on HMR / unload (see config.md "Work with HMR").
//
// For a Web UI (settings tab) plugin, use _skeleton-client instead — this
// skeleton has no client half and exposes no browser UI.

const NAME = 'REPLACE-ME'

// Example: a tool plugin. Swap `inject: ['tools']` for whatever services you
// actually depend on (e.g. ['webServer'], ['tools', 'webServer'], ...).
export const inject = ['tools']

// Example Config schema. Remove if your plugin needs no configuration.
// (Schemastery is available as a dependency; install it in the real plugin.)
// export const Config = Schema.object({
//   enabled: Schema.boolean().default(true),
// })

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config]
 */
export function apply(ctx, config) {
  ctx.logger?.info?.('[%s] loaded', NAME)

  // === Replace the block below with your plugin's registrations. ===
  // Example — register a tool (see docs/user/develop/basic/tool.md):
  //
  // ctx.tools.register(defineTool({
  //   name: 'REPLACE-ME-action',
  //   description: '...',
  //   parameters: { input: { type: 'string', required: true } },
  //   output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
  //   async execute(args) { return `did: ${args.input}` },
  // }))
  // ===============================================================

  // Cleanup is automatic: every registration made through ctx is an effect
  // that the framework reverses on unload/HMR.
}
