# Copy Selected Name

Copy Selected Name is an Obsidian desktop plugin that turns the selected file or folder in the file explorer into mention text such as `@01_Example.md `. It keeps that text in a plugin-owned clipboard panel, supports quick append workflows, and can convert mentions to Obsidian URLs.

## Install

1. Copy this folder to `<vault>/.obsidian/plugins/copy-selected-name`.
2. In Obsidian, open `Settings -> Community plugins`.
3. Disable Safe mode if needed, then enable `Copy Selected Name`.
4. Select one or more files or folders in the file explorer and press `Alt+C`.

For GitHub release packaging, include these files:

- `main.js`
- `manifest.json`
- `styles.css` if you add external styles later
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `versions.json`

Do not publish `data.json`; it contains local clipboard history and is ignored by `.gitignore`.

## Usage

- Single `Alt+C`: overwrite the plugin clipboard with the selected item names.
- Double `Alt+C` within 1 second: start or continue append mode.
- Triple `Alt+C` within 1 second: open the overwrite/append/cancel modal.
- Multiple selected files or folders: all selected names are copied in one formatted string.
- Claudian input focused: insert the formatted text into the current cursor position.
- Other editable Obsidian areas: `Ctrl+V` inserts the plugin clipboard content once, then clears the plugin clipboard.
- Clipboard panel: edit the plugin clipboard, clear it, toggle Obsidian URL format, or copy an Obsidian URL version to the system clipboard.
- History: open the modal history, copy a record back to the plugin clipboard, or edit and save a record.

The plugin clipboard is separate from the system clipboard. The system clipboard is only written by the `转成 ObsidianURL并复制` button.

## Development

This plugin is currently plain CommonJS JavaScript and does not require a build step.

```bash
npm run check
```

`npm run check` runs `node --check main.js`.
