# Changelog

## 1.6.0

- Added editable history records in the overwrite/append modal.
- Kept the overwrite/append modal as a singleton, so repeated `Alt+C` presses update one dialog instead of stacking dialogs.
- Added an editable internal clipboard panel with auto-hide, hover/focus pinning, manual clear, and synchronized modal embedding.
- Added Obsidian URL conversion, URL toggle-back behavior, and a separate "convert and copy" action that writes only to the system clipboard.
- Added paste handling that clears the plugin clipboard after the first paste outside the plugin clipboard editor.
- Added append-chain behavior for quick double presses and manual overwrite/append choice after an append chain.

## 1.0.0

- Initial local version for copying the selected Obsidian file or folder name with `Alt+C`.
