# mod-manager

A per-session mod manager for Claude Code. A toolbar above the prompt lets you
switch any locally installed mod on or off for the current session.

```
╭────────────────────────────────────────────────────────╮
│ ⬢ MODS  [ Mods ▾  3/5 on ]  ● pending  [ ↻ Apply ]  ⚙ Manage │
╰────────────────────────────────────────────────────────╯
```

## Features

- **Dropdown toolbar** above the prompt listing every mod it knows about, marked
  `●` (on) or `○` (off), with versions. Pick a mod to toggle it; `Enable all` and
  `Disable all` are included.
- **Manage pane** (`/mods` or the `⚙ Manage` button): one card per mod with
  Enable/Disable buttons and a `★ Save as default` button.
- **Per-session choices:** selections are stored per session id. New sessions start
  from your saved default (everything on unless you saved otherwise).
- **Apply button:** a change shows a yellow `● pending` marker until you press
  `↻ Apply` (hotkey `a`).
- `mod-manager` itself is locked on so you can always turn mods back on.

Hotkeys (when the bar has focus): `a` Apply, `m` Manage.

## Install

Requires a Claude Code build with function-hook mods (plugin authoring support).

1. Put this folder inside your mods folder, for example
   `~/.claude/dev-mods/<id>/mod-manager/`, and accept the
   "Enable hot reloading for this session?" prompt.
2. Or load it directly for one session:

   ```bash
   claude --plugin-dir /path/to/mod-manager
   ```

### Make it available in every session

Add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`
(separate several folders with `;` on Windows, `:` elsewhere). `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`
makes long-lived sessions (the desktop app, the SDK) hot-reload it too:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/mod-manager",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

## New mods ask first

The first time mod-manager runs it treats every mod already present as known. After
that, a mod it has never seen is **refused until you decide**: the MODS bar shows a
magenta `✦ NEW MOD` row with `Enable` and `Keep off`. `Enable` loads it right away;
`Keep off` records the choice for this session. Your choices are remembered, so each mod
asks once.

## Where it looks for mods

`~/.claude/dev-mods`, `~/.claude/plugins/synced`, `~/.claude/plugins/marketplaces`,
`~/.claude/skills`, every folder in `CLAUDE_CODE_PLUGIN_DIRS`, and the folder beside
mod-manager. A folder counts as a mod when it has a `.claude-plugin/plugin.json` and a
`hooks/hooks.json` with a `modules` list. Mods that have loaded in any session are also
listed, whatever their location.

## How it works

- A `plugin.register` hook sees every mod before it joins the session. Mods you
  switched off are refused, so none of their hooks, commands or tools load.
  It records each mod it sees in the plugin store so the dropdown can list it.
- Sibling folders next to `mod-manager` are scanned for `.claude-plugin/plugin.json`,
  so mods that never loaded still appear.
- `↻ Apply` writes `hooks/.reload`. With hot reloading on, that save reloads all
  mods, and the refusal list is applied. Without hot reloading, changes take effect
  the next time mods load.

## Limitations

- Only mods in the `user` tier can be switched off; managed and built-in plugins
  are never refused.
- A mod that loads before `mod-manager` cannot be refused by it.
- The dropdown lists mods the manager has seen load plus siblings on disk. It does
  not scan marketplace-installed plugins that have never loaded.
- No toolbar on the mobile surface (it has no dropdown element); `/mods` still works.

## Development

```bash
claude plugin validate .
```

Files:

| Path | Purpose |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest |
| `hooks/hooks.json` | Points at the hooks module |
| `hooks/register.tsx` | All hooks: register filter, toolbar, pane, `/mods` |
| `types/index.d.ts` | `$.state` contract (`mods`, `disabled`, `isDirty`) |

## Contributing

Issues and pull requests are welcome. Please run `claude plugin validate .` before
submitting.

## License

[MIT](LICENSE)
