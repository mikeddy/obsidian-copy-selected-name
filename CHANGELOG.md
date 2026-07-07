# Changelog

## 1.8.0

- `Alt+X` / `Option+X` now supports quick double presses, mirroring the `Alt+C` double-press behavior: a double press appends the current selection's disk paths to the previously copied paths in the system clipboard instead of overwriting them.
- Appended disk paths are deduplicated line by line, and the press window shares the existing 连按判断间隔 setting.

## 1.7.0

- Added a "转成磁盘路径" toggle button in the clipboard panel that converts mentions to full disk paths and back, mirroring the Obsidian URL toggle behavior.
- Added a "复制磁盘路径" button that copies the disk-path conversion to the system clipboard without changing the panel content.
- Renamed the "转成 ObsidianURL并复制" button to "复制 Obsidian URL"; it now copies directly when the panel already contains Obsidian URLs.
- Reorganized the clipboard panel buttons into a convert row and a copy/clear row to reduce clutter.
- Conversions now accept any of the three formats (mentions, Obsidian URLs, disk paths) as input.

## 1.6.0

- Added editable history records in the overwrite/append modal.
- Kept the overwrite/append modal as a singleton, so repeated `Alt+C` presses update one dialog instead of stacking dialogs.
- Added an editable internal clipboard panel with auto-hide, hover/focus pinning, manual clear, and synchronized modal embedding.
- Added Obsidian URL conversion, URL toggle-back behavior, and a separate "convert and copy" action that writes only to the system clipboard.
- Added paste handling that clears the plugin clipboard after the first paste outside the plugin clipboard editor.
- Added append-chain behavior for quick double presses and manual overwrite/append choice after an append chain.

## 1.0.0

- Initial local version for copying the selected Obsidian file or folder name with `Alt+C`.
