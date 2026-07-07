const { Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } = require("obsidian");

const FILE_EXPLORER_SELECTOR = '.workspace-leaf-content[data-type="file-explorer"]';
const EXPLORER_ITEM_SELECTOR = ".nav-file-title, .nav-folder-title, .tree-item-self";
const CLAUDIAN_INPUT_SELECTOR = "textarea.claudian-input";
const DEFAULT_PRESS_WINDOW_MS = 1000;
const PANEL_HIDE_MS = 3000;
const PANEL_BASE_TEXTAREA_HEIGHT = 108;
const PANEL_MAX_TEXTAREA_HEIGHT = PANEL_BASE_TEXTAREA_HEIGHT * 2.5;
const POINTER_SELECTION_FRESH_MS = 5000;
const CLIPBOARD_PASTE_ARM_MS = 15000;
const MAX_HISTORY_ENTRIES = 1000;
const DISK_PATH_LINE_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const DEFAULT_SETTINGS = {
  shortcuts: {
    mention: {
      windows: {
        code: "KeyC",
        key: "c",
        alt: true,
        ctrl: false,
        meta: false,
        shift: false,
        label: "Alt+C"
      },
      mac: {
        code: "KeyC",
        key: "c",
        alt: true,
        ctrl: false,
        meta: false,
        shift: false,
        label: "Option+C"
      }
    },
    diskPath: {
      windows: {
        code: "KeyX",
        key: "x",
        alt: true,
        ctrl: false,
        meta: false,
        shift: false,
        label: "Alt+X"
      },
      mac: {
        code: "KeyX",
        key: "x",
        alt: true,
        ctrl: false,
        meta: false,
        shift: false,
        label: "Option+X"
      }
    }
  },
  pressWindowMs: DEFAULT_PRESS_WINDOW_MS,
  pressActions: {
    single: "smart-overwrite",
    double: "append",
    triple: "modal"
  }
};
const PRESS_ACTION_LABELS = {
  "smart-overwrite": "智能覆盖（追加链后询问）",
  overwrite: "覆盖剪贴板",
  append: "追加到剪贴板",
  modal: "弹出覆盖/追加选择框",
  none: "不执行操作"
};
const SELECTED_ITEM_SELECTORS = [
  ".nav-file-title.is-selected",
  ".nav-folder-title.is-selected",
  ".tree-item-self.is-selected[data-path]",
  ".nav-file-title.mod-selected",
  ".nav-folder-title.mod-selected",
  ".tree-item-self.mod-selected[data-path]",
  ".nav-file-title[aria-selected='true']",
  ".nav-folder-title[aria-selected='true']",
  ".tree-item-self[aria-selected='true'][data-path]"
];
const ACTIVE_ITEM_SELECTORS = [
  ".nav-file-title.is-active",
  ".nav-folder-title.is-active",
  ".tree-item-self.is-active[data-path]"
];

module.exports = class CopySelectedNamePlugin extends Plugin {
  async onload() {
    this.lastSelectedItem = null;
    this.lastSelectedItems = [];
    this.lastPointerSelectedItem = null;
    this.lastPointerAt = 0;
    this.lastPointerUsedModifier = false;
    this.lastPressAt = 0;
    this.lastPressText = "";
    this.lastPressKey = "";
    this.lastSingleSnapshotText = "";
    this.lastSingleSnapshotLastKey = "";
    this.lastSingleSnapshotForKey = "";
    this.pendingSingleTimer = null;
    this.pendingSingleRequest = null;
    this.chainActive = false;
    this.chainText = "";
    this.chainLastKey = "";
    this.pressCount = 0;
    this.diskPressCount = 0;
    this.lastDiskPressAt = 0;
    this.lastDiskPressKey = "";
    this.diskChainText = "";
    this.diskSingleSnapshotText = "";
    this.diskSingleSnapshotForKey = "";
    this.currentClipboardText = "";
    this.clipboardArmedAt = 0;
    this.clipboardPanelEl = null;
    this.clipboardPanelTextarea = null;
    this.clipboardPanelHideTimer = null;
    this.clipboardPanelHovered = false;
    this.clipboardPanelFocused = false;
    this.copyModeModal = null;
    const data = await this.loadData();
    this.data = data || {};
    this.history = Array.isArray(data?.history) ? data.history : [];
    this.settings = this.normalizeSettings(data?.settings);

    this.registerDomEvent(
      document,
      "pointerdown",
      (event) => this.rememberExplorerSelection(event),
      true
    );

    this.registerDomEvent(
      document,
      "keydown",
      (event) => this.handleKeyboardShortcut(event),
      true
    );

    this.registerDomEvent(
      document,
      "paste",
      (event) => this.handlePaste(event),
      true
    );

    this.addCommand({
      id: "copy-selected-file-or-folder-name",
      name: "Copy selected file or folder mentions",
      checkCallback: (checking) => {
        const selectedItems = this.getSelectedExplorerItems();
        if (selectedItems.length === 0) {
          return false;
        }

        if (!checking) {
          const text = this.buildMentionTextFromItems(selectedItems);
          const selectionKey = this.buildSelectionKey(selectedItems);
          void this.handleMentionHotkey(text, selectionKey);
        }

        return true;
      }
    });

    this.addCommand({
      id: "copy-selected-file-or-folder-disk-path",
      name: "Copy selected file or folder disk path",
      checkCallback: (checking) => {
        const selectedItems = this.getSelectedExplorerItems();
        if (selectedItems.length === 0) {
          return false;
        }

        if (!checking) {
          void this.handleDiskPathHotkey(selectedItems);
        }

        return true;
      }
    });

    this.addSettingTab(new CopySelectedNameSettingTab(this.app, this));
  }

  normalizeSettings(settings = {}) {
    const legacyShortcut = settings.shortcut || null;
    const shortcuts = settings.shortcuts || {};
    const mentionShortcuts = shortcuts.mention || {};
    const diskPathShortcuts = shortcuts.diskPath || settings.diskPathShortcuts || {};
    const pressActions = settings.pressActions || {};
    return {
      shortcuts: {
        mention: {
          windows: this.normalizeShortcut(
            mentionShortcuts.windows || shortcuts.windows || legacyShortcut || {},
            DEFAULT_SETTINGS.shortcuts.mention.windows,
            "windows"
          ),
          mac: this.normalizeShortcut(
            mentionShortcuts.mac || shortcuts.mac || legacyShortcut || {},
            DEFAULT_SETTINGS.shortcuts.mention.mac,
            "mac"
          )
        },
        diskPath: {
          windows: this.normalizeShortcut(
            diskPathShortcuts.windows || {},
            DEFAULT_SETTINGS.shortcuts.diskPath.windows,
            "windows"
          ),
          mac: this.normalizeShortcut(
            diskPathShortcuts.mac || {},
            DEFAULT_SETTINGS.shortcuts.diskPath.mac,
            "mac"
          )
        }
      },
      pressWindowMs: this.normalizePressWindowMs(settings.pressWindowMs),
      pressActions: {
        single: this.normalizePressAction(pressActions.single, DEFAULT_SETTINGS.pressActions.single),
        double: this.normalizePressAction(pressActions.double, DEFAULT_SETTINGS.pressActions.double),
        triple: this.normalizePressAction(pressActions.triple, DEFAULT_SETTINGS.pressActions.triple)
      }
    };
  }

  normalizeShortcut(shortcut = {}, fallback = DEFAULT_SETTINGS.shortcuts.mention.windows, platformKey = "windows") {
    const normalized = {
      code: typeof shortcut.code === "string" && shortcut.code ? shortcut.code : fallback.code,
      key: typeof shortcut.key === "string" && shortcut.key ? shortcut.key : fallback.key,
      alt: typeof shortcut.alt === "boolean" ? shortcut.alt : fallback.alt,
      ctrl: typeof shortcut.ctrl === "boolean" ? shortcut.ctrl : fallback.ctrl,
      meta: typeof shortcut.meta === "boolean" ? shortcut.meta : fallback.meta,
      shift: typeof shortcut.shift === "boolean" ? shortcut.shift : fallback.shift,
      label: ""
    };
    normalized.label = this.formatShortcut(normalized, platformKey);
    return normalized;
  }

  normalizePressWindowMs(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return DEFAULT_SETTINGS.pressWindowMs;
    }

    return Math.min(Math.max(Math.round(numberValue), 200), 3000);
  }

  async savePluginData() {
    this.data = {
      ...(this.data || {}),
      settings: this.settings,
      history: this.history
    };
    await this.saveData(this.data);
  }

  async saveSettings() {
    await this.savePluginData();
  }

  onunload() {
    this.clearPendingSingle();
    this.closeCopyModeModal();
    this.hideClipboardPanel();
  }

  handlePaste(event) {
    const target = event.target;
    if (this.isInsideClipboardEditor(target) || !this.isEditablePasteTarget(target)) {
      return;
    }

    if (!this.isClipboardArmed()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    this.insertTextIntoEditableTarget(target, this.currentClipboardText);
    void this.resetClipboardState({ showNotice: true });
  }

  isClipboardArmed() {
    if (!this.currentClipboardText) {
      return false;
    }

    // 面板仍然可见时内容视为活跃（hover/focus 会保持它常驻），始终允许粘贴。
    if (this.clipboardPanelEl) {
      return true;
    }

    // 面板隐藏后给一个有限的时效，避免很久以前的一次 Alt+C 静默劫持用户真正想要
    // 的系统剪贴板粘贴。
    if (!this.clipboardArmedAt) {
      return false;
    }

    return Date.now() - this.clipboardArmedAt <= CLIPBOARD_PASTE_ARM_MS;
  }

  handleKeyboardShortcut(event) {
    if (this.isConfiguredHotkey(event, "mention")) {
      this.handleMentionShortcut(event);
      return;
    }

    if (this.isConfiguredHotkey(event, "diskPath")) {
      this.handleDiskPathShortcut(event);
    }
  }

  handleMentionShortcut(event) {
    const selectedItems = this.getSelectedExplorerItems();
    if (selectedItems.length === 0) {
      return;
    }

    this.stopHotkeyEvent(event);

    const text = this.buildMentionTextFromItems(selectedItems);
    const selectionKey = this.buildSelectionKey(selectedItems);
    void this.handleMentionHotkey(text, selectionKey);
  }

  handleDiskPathShortcut(event) {
    const selectedItems = this.getSelectedExplorerItems();
    if (selectedItems.length === 0) {
      return;
    }

    this.stopHotkeyEvent(event);
    void this.handleDiskPathHotkey(selectedItems);
  }

  stopHotkeyEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  isConfiguredHotkey(event, shortcutGroup = "mention") {
    const shortcut = this.getActiveShortcut(shortcutGroup);
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    const shortcutKey = typeof shortcut.key === "string" ? shortcut.key.toLowerCase() : "";
    const codeMatches = Boolean(shortcut.code) && event.code === shortcut.code;
    const keyMatches = Boolean(shortcutKey) && key === shortcutKey;
    return (codeMatches || keyMatches) &&
      Boolean(event.altKey) === Boolean(shortcut.alt) &&
      Boolean(event.ctrlKey) === Boolean(shortcut.ctrl) &&
      Boolean(event.metaKey) === Boolean(shortcut.meta) &&
      Boolean(event.shiftKey) === Boolean(shortcut.shift) &&
      !event.isComposing;
  }

  getActiveShortcut(shortcutGroup = "mention") {
    return this.getShortcutForPlatform(shortcutGroup, this.getCurrentPlatformKey());
  }

  getShortcutForPlatform(shortcutGroup = "mention", platformKey) {
    if (platformKey === undefined) {
      platformKey = this.getCurrentPlatformKey();
    }

    if ((shortcutGroup === "mac" || shortcutGroup === "windows") && arguments.length === 1) {
      platformKey = shortcutGroup;
      shortcutGroup = "mention";
    }

    const normalizedGroup = shortcutGroup === "diskPath" ? "diskPath" : "mention";
    const normalizedPlatform = platformKey === "mac" ? "mac" : "windows";
    const groupShortcuts = this.settings?.shortcuts?.[normalizedGroup] || DEFAULT_SETTINGS.shortcuts[normalizedGroup];
    return groupShortcuts?.[normalizedPlatform] || DEFAULT_SETTINGS.shortcuts[normalizedGroup][normalizedPlatform];
  }

  setShortcutForPlatform(shortcutGroup, platformKey, shortcut) {
    const normalizedGroup = shortcutGroup === "diskPath" ? "diskPath" : "mention";
    const normalizedPlatform = platformKey === "mac" ? "mac" : "windows";

    if (!this.settings.shortcuts) {
      this.settings.shortcuts = {};
    }
    if (!this.settings.shortcuts[normalizedGroup]) {
      this.settings.shortcuts[normalizedGroup] = {};
    }

    this.settings.shortcuts[normalizedGroup][normalizedPlatform] = shortcut;
  }

  getCurrentPlatformKey() {
    const platform = typeof navigator !== "undefined" && navigator.platform
      ? navigator.platform
      : "";
    const userAgent = typeof navigator !== "undefined" && navigator.userAgent
      ? navigator.userAgent
      : "";
    return /Mac|iPhone|iPad|iPod/i.test(`${platform} ${userAgent}`) ? "mac" : "windows";
  }

  async handleMentionHotkey(text, selectionKey = text) {
    if (!text) {
      return;
    }

    const pressKey = selectionKey || text;
    this.showClipboardPanel(this.chainActive && this.chainText ? this.chainText : text);
    const now = Date.now();
    const pressWindowMs = this.getPressWindowMs();
    const isSameSelectionPress = pressKey === this.lastPressKey;
    const isQuickPress = isSameSelectionPress && this.lastPressAt > 0 && now - this.lastPressAt < pressWindowMs;
    this.pressCount = isQuickPress ? this.pressCount + 1 : 1;
    const pressCount = this.pressCount;
    const isDoublePress = pressCount === 2;
    const isTriplePress = pressCount >= 3;
    const pressAction = this.getPressAction(pressCount);

    // 连按判断依赖的状态必须在任何 await 之前同步写入。executePressAction 内部会
    // await 磁盘写入（addHistory → saveData），若把这些赋值留到 await 之后，快速的
    // 第二次按键（keydown 是新的宏任务）会在第一次写入完成前读到旧值，导致双击/
    // 三击被误判成单击。
    this.lastPressAt = now;
    this.lastPressText = text;
    this.lastPressKey = pressKey;
    if (isTriplePress) {
      // 三击后归零，让下一次快速按键重新从单击开始计数。
      this.pressCount = 0;
    }

    if (this.pendingSingleTimer) {
      this.clearPendingSingle();
    }

    if (isTriplePress) {
      await this.executePressAction(pressAction, text, pressKey, { pressCount: 3 });
    } else if (isDoublePress) {
      const hasSnapshotForPress = this.lastSingleSnapshotForKey === pressKey;
      await this.executePressAction(pressAction, text, pressKey, {
        pressCount: 2,
        baseText: hasSnapshotForPress ? this.lastSingleSnapshotText : "",
        baseLastKey: hasSnapshotForPress ? this.lastSingleSnapshotLastKey : "",
        duplicateStartsChainOnly: true
      });
    } else if (this.chainActive && pressAction === "smart-overwrite") {
      this.pendingSingleRequest = { text, selectionKey: pressKey };
      this.showClipboardPanel(this.chainText || text);
      this.pendingSingleTimer = window.setTimeout(() => {
        const request = this.pendingSingleRequest;
        this.clearPendingSingle();
        if (request) {
          this.openCopyModeModal(request.text, request.selectionKey);
        }
      }, pressWindowMs);
    } else {
      this.lastSingleSnapshotText = this.chainText || this.currentClipboardText || "";
      this.lastSingleSnapshotLastKey = this.chainLastKey || "";
      this.lastSingleSnapshotForKey = pressKey;
      await this.executePressAction(pressAction, text, pressKey, { pressCount: 1 });
    }
  }

  getPressWindowMs() {
    const value = Number(this.settings?.pressWindowMs);
    if (!Number.isFinite(value)) {
      return DEFAULT_PRESS_WINDOW_MS;
    }

    return Math.min(Math.max(Math.round(value), 200), 3000);
  }

  getPressAction(pressCount) {
    const actions = this.settings?.pressActions || DEFAULT_SETTINGS.pressActions;
    if (pressCount >= 3) {
      return this.normalizePressAction(actions.triple, DEFAULT_SETTINGS.pressActions.triple);
    }

    if (pressCount === 2) {
      return this.normalizePressAction(actions.double, DEFAULT_SETTINGS.pressActions.double);
    }

    return this.normalizePressAction(actions.single, DEFAULT_SETTINGS.pressActions.single);
  }

  normalizePressAction(action, fallback) {
    return Object.prototype.hasOwnProperty.call(PRESS_ACTION_LABELS, action) ? action : fallback;
  }

  async executePressAction(action, text, selectionKey, options = {}) {
    switch (this.normalizePressAction(action, DEFAULT_SETTINGS.pressActions.single)) {
      case "overwrite":
      case "smart-overwrite":
        await this.performOverwrite(text, selectionKey);
        break;
      case "append":
        await this.performAppend(text, {
          baseText: options.baseText || "",
          baseLastKey: options.baseLastKey || "",
          selectionKey,
          duplicateStartsChainOnly: Boolean(options.duplicateStartsChainOnly)
        });
        break;
      case "modal":
        this.openCopyModeModal(text, selectionKey);
        break;
      case "none":
        new Notice("Copy Selected Name: no action configured for this press");
        break;
      default:
        await this.performOverwrite(text, selectionKey);
    }
  }

  shortcutFromEvent(event, platformKey = this.getCurrentPlatformKey()) {
    if (this.isModifierOnlyKey(event.code)) {
      return null;
    }

    const shortcut = {
      code: event.code || "",
      key: typeof event.key === "string" ? event.key.toLowerCase() : "",
      alt: Boolean(event.altKey),
      ctrl: Boolean(event.ctrlKey),
      meta: Boolean(event.metaKey),
      shift: Boolean(event.shiftKey),
      label: ""
    };
    shortcut.label = this.formatShortcut(shortcut, platformKey);
    return shortcut;
  }

  isModifierOnlyKey(code) {
    return [
      "AltLeft",
      "AltRight",
      "ControlLeft",
      "ControlRight",
      "MetaLeft",
      "MetaRight",
      "ShiftLeft",
      "ShiftRight"
    ].includes(code);
  }

  formatShortcut(shortcut = this.getActiveShortcut(), platformKey = this.getCurrentPlatformKey()) {
    const parts = [];
    if (shortcut.ctrl) {
      parts.push("Ctrl");
    }
    if (shortcut.meta) {
      parts.push("Cmd");
    }
    if (shortcut.alt) {
      parts.push(platformKey === "mac" ? "Option" : "Alt");
    }
    if (shortcut.shift) {
      parts.push("Shift");
    }

    parts.push(this.formatShortcutKey(shortcut));
    return parts.filter(Boolean).join("+");
  }

  formatShortcutKey(shortcut) {
    const code = shortcut?.code || "";
    const key = shortcut?.key || "";
    if (code.startsWith("Key") && code.length === 4) {
      return code.slice(3).toUpperCase();
    }
    if (code.startsWith("Digit") && code.length === 6) {
      return code.slice(5);
    }

    const specialCodes = {
      Space: "Space",
      Escape: "Esc",
      Enter: "Enter",
      Tab: "Tab",
      Backspace: "Backspace",
      Delete: "Delete",
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight"
    };
    if (specialCodes[code]) {
      return specialCodes[code];
    }

    if (/^F\d{1,2}$/.test(code)) {
      return code;
    }

    if (key && key.length === 1) {
      return key.toUpperCase();
    }

    return code || key;
  }

  clearPendingSingle() {
    if (this.pendingSingleTimer) {
      window.clearTimeout(this.pendingSingleTimer);
      this.pendingSingleTimer = null;
    }

    this.pendingSingleRequest = null;
  }

  openCopyModeModal(text, selectionKey = "") {
    if (this.copyModeModal) {
      this.copyModeModal.updateText(text, selectionKey);
      return;
    }

    const modal = new CopyModeModal(this.app, this, text, selectionKey);
    this.copyModeModal = modal;
    modal.open();
  }

  closeCopyModeModal(modal = this.copyModeModal) {
    if (!modal) {
      return;
    }

    if (this.copyModeModal === modal) {
      this.copyModeModal = null;
    }

    modal.close();
  }

  handleCopyModeModalClosed(modal) {
    if (this.copyModeModal === modal) {
      this.copyModeModal = null;
    }
  }

  rememberExplorerSelection(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const item = target.closest(`${FILE_EXPLORER_SELECTOR} ${EXPLORER_ITEM_SELECTOR}`);
    if (!item) {
      return;
    }

    const selected = this.resolveExplorerItem(item);
    if (selected) {
      this.lastSelectedItem = selected;
      this.lastSelectedItems = [selected];
      this.lastPointerSelectedItem = selected;
      this.lastPointerAt = Date.now();
      this.lastPointerUsedModifier = event.ctrlKey || event.metaKey || event.shiftKey;
    }

    window.setTimeout(() => this.refreshLastSelectedItems(), 0);
  }

  getSelectedExplorerItems() {
    const selectedItems = this.resolveExplorerItems(this.findSelectedExplorerItems());
    const pointerItem = this.getFreshPointerSelectedItem();
    if (pointerItem && !this.selectionContainsItem(selectedItems, pointerItem)) {
      this.lastSelectedItem = pointerItem;
      this.lastSelectedItems = [pointerItem];
      return [pointerItem];
    }

    if (selectedItems.length > 0) {
      this.lastSelectedItem = selectedItems[selectedItems.length - 1];
      this.lastSelectedItems = selectedItems;
      return selectedItems;
    }

    const activeItem = this.findActiveExplorerItem();
    if (activeItem) {
      const selected = this.resolveExplorerItem(activeItem);
      if (selected) {
        this.lastSelectedItem = selected;
        this.lastSelectedItems = [selected];
        return [selected];
      }
    }

    const existingLastItems = this.lastSelectedItems.filter((item) => this.itemStillExists(item));
    if (existingLastItems.length > 0) {
      this.lastSelectedItems = existingLastItems;
      this.lastSelectedItem = existingLastItems[existingLastItems.length - 1];
      return existingLastItems;
    }

    return [];
  }

  getFreshPointerSelectedItem() {
    if (this.lastPointerUsedModifier || !this.lastPointerSelectedItem || this.lastPointerAt <= 0) {
      return null;
    }

    if (Date.now() - this.lastPointerAt > POINTER_SELECTION_FRESH_MS) {
      return null;
    }

    return this.itemStillExists(this.lastPointerSelectedItem) ? this.lastPointerSelectedItem : null;
  }

  selectionContainsItem(items, targetItem) {
    const targetKey = targetItem.path || targetItem.name;
    if (!targetKey) {
      return false;
    }

    return items.some((item) => (item.path || item.name) === targetKey);
  }

  refreshLastSelectedItems() {
    const selectedItems = this.resolveExplorerItems(this.findSelectedExplorerItems());
    if (selectedItems.length === 0) {
      return;
    }

    this.lastSelectedItems = selectedItems;
    this.lastSelectedItem = selectedItems[selectedItems.length - 1];
  }

  findSelectedExplorerItems() {
    const explorer = document.querySelector(FILE_EXPLORER_SELECTOR);
    if (!explorer) {
      return [];
    }

    return Array.from(explorer.querySelectorAll(SELECTED_ITEM_SELECTORS.join(", ")));
  }

  findActiveExplorerItem() {
    const explorer = document.querySelector(FILE_EXPLORER_SELECTOR);
    if (!explorer) {
      return null;
    }

    for (const selector of ACTIVE_ITEM_SELECTORS) {
      const item = explorer.querySelector(selector);
      if (item) {
        return item;
      }
    }

    return null;
  }

  resolveExplorerItems(items) {
    const selectedItems = [];
    const seen = new Set();

    for (const item of items) {
      const selected = this.resolveExplorerItem(item);
      if (!selected || !selected.name) {
        continue;
      }

      const key = selected.path || selected.name;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      selectedItems.push(selected);
    }

    return selectedItems;
  }

  resolveExplorerItem(item) {
    const path = this.getItemPath(item);
    const vaultItem = path ? this.app.vault.getAbstractFileByPath(path) : null;
    const fallbackName = this.getItemLabel(item, path);

    if (vaultItem instanceof TFile) {
      return {
        path: vaultItem.path,
        name: vaultItem.name
      };
    }

    if (vaultItem instanceof TFolder) {
      return {
        path: vaultItem.path,
        name: vaultItem.name
      };
    }

    if (path || fallbackName) {
      return {
        path: path || "",
        name: fallbackName
      };
    }

    return null;
  }

  getItemPath(item) {
    const pathElement = item.closest("[data-path]");
    return pathElement ? pathElement.getAttribute("data-path") || "" : "";
  }

  getItemLabel(item, path) {
    const labelElement = item.querySelector(
      ".nav-file-title-content, .nav-folder-title-content, .tree-item-inner"
    );
    const text = labelElement ? labelElement.textContent.trim() : item.textContent.trim();
    if (text) {
      return text;
    }

    const basename = path.split("/").filter(Boolean).pop() || "";
    return basename;
  }

  itemStillExists(item) {
    return item.path ? Boolean(this.app.vault.getAbstractFileByPath(item.path)) : Boolean(item.name);
  }

  buildMentionText(names) {
    const cleanNames = names.filter(Boolean);
    if (cleanNames.length === 0) {
      return "";
    }

    return cleanNames.map((name) => `@${name} `).join("\n");
  }

  buildMentionTextFromItems(items) {
    return this.buildMentionText(items.map((item) => item.path || item.name));
  }

  buildSelectionKey(items) {
    return items
      .map((item) => item.path || item.name)
      .filter(Boolean)
      .sort()
      .join("\u001f");
  }

  async handleDiskPathHotkey(items) {
    if (!this.getVaultBasePath()) {
      new Notice("Cannot resolve vault disk path");
      return;
    }

    const text = this.buildDiskPathTextFromItems(items);
    if (!text) {
      new Notice("No matching files found");
      return;
    }

    // 与 Alt+C 相同的连按判定；状态必须在任何 await 之前同步写入，否则快速的
    // 第二次按键会读到旧值而被误判成单击。
    const pressKey = this.buildSelectionKey(items);
    const now = Date.now();
    const isQuickPress = pressKey === this.lastDiskPressKey &&
      this.lastDiskPressAt > 0 &&
      now - this.lastDiskPressAt < this.getPressWindowMs();
    this.diskPressCount = isQuickPress ? this.diskPressCount + 1 : 1;
    const isMultiPress = this.diskPressCount >= 2;
    this.lastDiskPressAt = now;
    this.lastDiskPressKey = pressKey;

    if (isMultiPress) {
      // 双击追加：以单击覆盖之前的快照为基础，把这次的路径接到后面，
      // 效果上等于撤销刚才那次单击覆盖再追加（对齐 Alt+C 的双击行为）。
      const hasSnapshotForPress = this.diskSingleSnapshotForKey === pressKey;
      const baseText = hasSnapshotForPress ? this.diskSingleSnapshotText : this.diskChainText;
      this.diskChainText = this.appendDiskPathText(baseText, text);
      await this.writeDiskPathsToClipboard(this.diskChainText, { appended: true });
      return;
    }

    this.diskSingleSnapshotText = this.diskChainText;
    this.diskSingleSnapshotForKey = pressKey;
    this.diskChainText = text;
    await this.writeDiskPathsToClipboard(text, { appended: false });
  }

  appendDiskPathText(baseText, text) {
    const lines = String(baseText || "").split(/\r?\n/).filter(Boolean);
    const seen = new Set(lines);
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      if (!seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
    }
    return lines.join("\n");
  }

  async writeDiskPathsToClipboard(text, options = {}) {
    if (!(await this.writeSystemClipboard(text))) {
      return;
    }

    const pathCount = text.split(/\r?\n/).filter(Boolean).length;
    if (options.appended) {
      new Notice(`Appended disk path (${pathCount} in system clipboard)`);
      return;
    }

    new Notice(pathCount === 1
      ? "Copied disk path to system clipboard"
      : `Copied ${pathCount} disk paths to system clipboard`);
  }

  buildDiskPathTextFromItems(items) {
    const paths = items
      .map((item) => {
        if (item.path) {
          return item.path;
        }

        const vaultItem = item.name ? this.resolveMentionToVaultItem(item.name) : null;
        return vaultItem ? vaultItem.path : "";
      })
      .map((path) => this.buildDiskPath(path))
      .filter(Boolean);

    return paths.length === 0 ? "" : paths.join("\n");
  }

  async performOverwrite(text, selectionKey = "") {
    if (!text) {
      return;
    }

    this.chainText = text;
    this.chainLastKey = selectionKey || text;
    this.chainActive = false;
    await this.outputText(text, { mode: "overwrite" });
  }

  async performAppend(text, options = {}) {
    if (!text) {
      return;
    }

    this.chainActive = true;
    if (options.baseText) {
      this.chainText = options.baseText;
      this.chainLastKey = options.baseLastKey || "";
    }

    if (!this.chainText) {
      this.chainText = text;
      this.chainLastKey = options.selectionKey || text;
      await this.outputText(text, { mode: "append" });
      return;
    }

    const wouldDuplicateTail = this.textEndsWithMentionText(this.chainText, text);
    const isSameTailSelection = options.selectionKey && this.chainLastKey
      ? options.selectionKey === this.chainLastKey
      : wouldDuplicateTail;
    if (wouldDuplicateTail && isSameTailSelection && options.duplicateStartsChainOnly) {
      new Notice("Append mode started");
      return;
    }

    if (!wouldDuplicateTail) {
      this.chainText = this.appendMentionText(this.chainText, text);
    } else if (!isSameTailSelection) {
      this.chainText = this.appendMentionText(this.chainText, text);
    }
    this.chainLastKey = options.selectionKey || text;

    await this.outputText(text, { mode: "append", chainText: this.chainText });
  }

  textEndsWithMentionText(baseText, text) {
    return baseText.trimEnd().endsWith(text.trimEnd());
  }

  appendMentionText(baseText, text) {
    if (!baseText) {
      return text;
    }

    return `${baseText.trimEnd()}\n${text.trimStart()}`;
  }

  async outputText(text, options = {}) {
    const clipboardText = options.chainText || text;
    this.setPluginClipboard(clipboardText);

    const claudianInput = this.getFocusedClaudianInput();
    if (claudianInput) {
      this.insertTextAtCursor(claudianInput, text);
      new Notice(`Inserted: ${text}`);
      await this.addHistory(clipboardText, options.mode || "insert");
      return;
    }

    new Notice(`Plugin clipboard: ${clipboardText}`);
    await this.addHistory(clipboardText, options.mode || "copy");
  }

  setPluginClipboard(text, options = {}) {
    this.currentClipboardText = text || "";
    if (options.updateChain) {
      this.chainText = this.currentClipboardText;
      this.chainActive = Boolean(this.currentClipboardText);
    }
    this.showClipboardPanel(this.currentClipboardText);
    this.updateConversionToggleButtons();
  }

  async clearClipboardFromEditor() {
    await this.resetClipboardState({ showNotice: true });
    this.refreshClipboardPanelTimer();
  }

  async resetClipboardState(options = {}) {
    this.currentClipboardText = "";
    this.clipboardArmedAt = 0;
    this.chainText = "";
    this.chainActive = false;
    this.chainLastKey = "";
    this.pressCount = 0;
    this.lastPressAt = 0;
    this.lastPressText = "";
    this.lastPressKey = "";
    this.lastSingleSnapshotText = "";
    this.lastSingleSnapshotLastKey = "";
    this.lastSingleSnapshotForKey = "";
    this.syncClipboardEditors("");
    this.updateConversionToggleButtons();
    if (options.showNotice) {
      new Notice("Plugin clipboard cleared");
    }
  }

  async addHistory(text, mode) {
    if (!text) {
      return;
    }

    this.history.push({
      text,
      mode,
      createdAt: Date.now()
    });
    if (this.history.length > MAX_HISTORY_ENTRIES) {
      this.history.splice(0, this.history.length - MAX_HISTORY_ENTRIES);
    }
    await this.savePluginData();
  }

  showClipboardPanel(text) {
    this.currentClipboardText = text;
    this.clipboardArmedAt = Date.now();
    const panel = this.ensureClipboardPanel();
    this.syncClipboardEditors(text);

    panel.style.display = "block";
    this.refreshClipboardPanelTimer();
  }

  ensureClipboardPanel() {
    if (this.clipboardPanelEl && this.clipboardPanelTextarea) {
      return this.clipboardPanelEl;
    }

    const panel = document.body.createDiv({
      cls: "copy-selected-name-popover copy-selected-name-editor-shell"
    });
    this.clipboardPanelEl = panel;
    panel.style.position = "fixed";
    panel.style.top = "72px";
    panel.style.right = "24px";
    panel.style.zIndex = "10000";
    panel.style.width = "560px";
    panel.style.maxWidth = "calc(100vw - 48px)";
    panel.style.padding = "12px";
    panel.style.border = "1px solid var(--background-modifier-border)";
    panel.style.borderRadius = "8px";
    panel.style.background = "var(--background-primary)";
    panel.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.25)";

    this.renderClipboardEditor(panel, { primary: true, showClose: true });

    panel.addEventListener("mouseenter", () => {
      this.clipboardPanelHovered = true;
      this.clearClipboardPanelTimer();
    });
    panel.addEventListener("mouseleave", () => {
      this.clipboardPanelHovered = false;
      this.refreshClipboardPanelTimer();
    });
    panel.addEventListener("focusin", () => {
      this.clipboardPanelFocused = true;
      this.clearClipboardPanelTimer();
    });
    panel.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!panel.contains(document.activeElement)) {
          this.clipboardPanelFocused = false;
          this.refreshClipboardPanelTimer();
        }
      }, 0);
    });

    return panel;
  }

  renderClipboardEditor(container, options = {}) {
    container.addClass("copy-selected-name-editor-shell");

    const header = container.createDiv();
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.gap = "8px";
    header.style.marginBottom = "8px";

    const title = header.createDiv({ text: "剪贴板内容" });
    title.style.fontWeight = "600";

    if (options.showClose) {
      const closeButton = header.createEl("button", { text: "×" });
      closeButton.setAttribute("aria-label", "Close clipboard panel");
      closeButton.style.padding = "0 8px";
      closeButton.addEventListener("click", () => this.hideClipboardPanel());
    }

    const convertRow = container.createDiv();
    convertRow.style.display = "flex";
    convertRow.style.flexWrap = "wrap";
    convertRow.style.gap = "8px";
    convertRow.style.alignItems = "center";
    convertRow.style.marginBottom = "6px";

    const urlButton = convertRow.createEl("button", {
      text: this.getObsidianUrlToggleLabel(this.currentClipboardText)
    });
    urlButton.addClass("copy-selected-name-url-toggle");
    urlButton.addEventListener("click", () => {
      const textarea = container.querySelector("textarea.copy-selected-name-editor");
      if (textarea instanceof HTMLTextAreaElement) {
        void this.toggleEditorObsidianUrl(textarea);
      }
    });

    const diskButton = convertRow.createEl("button", {
      text: this.getDiskPathToggleLabel(this.currentClipboardText)
    });
    diskButton.addClass("copy-selected-name-disk-toggle");
    diskButton.addEventListener("click", () => {
      const textarea = container.querySelector("textarea.copy-selected-name-editor");
      if (textarea instanceof HTMLTextAreaElement) {
        void this.toggleEditorDiskPath(textarea);
      }
    });

    const actionRow = container.createDiv();
    actionRow.style.display = "flex";
    actionRow.style.flexWrap = "wrap";
    actionRow.style.gap = "8px";
    actionRow.style.alignItems = "center";
    actionRow.style.marginBottom = "8px";

    const copyUrlButton = actionRow.createEl("button", { text: "复制 Obsidian URL" });
    copyUrlButton.addEventListener("click", () => {
      const textarea = container.querySelector("textarea.copy-selected-name-editor");
      if (textarea instanceof HTMLTextAreaElement) {
        void this.copyEditorAsObsidianUrls(textarea);
      }
    });

    const copyDiskButton = actionRow.createEl("button", { text: "复制磁盘路径" });
    copyDiskButton.addEventListener("click", () => {
      const textarea = container.querySelector("textarea.copy-selected-name-editor");
      if (textarea instanceof HTMLTextAreaElement) {
        void this.copyEditorAsDiskPaths(textarea);
      }
    });

    const clearButton = actionRow.createEl("button", { text: "清空" });
    clearButton.style.marginLeft = "auto";
    clearButton.addEventListener("click", () => {
      void this.clearClipboardFromEditor();
    });

    const textarea = container.createEl("textarea");
    textarea.addClass("copy-selected-name-editor");
    if (options.primary) {
      this.clipboardPanelTextarea = textarea;
    }

    textarea.value = this.currentClipboardText;
    textarea.style.width = "100%";
    textarea.style.height = `${PANEL_BASE_TEXTAREA_HEIGHT}px`;
    textarea.style.minHeight = `${PANEL_BASE_TEXTAREA_HEIGHT}px`;
    textarea.style.maxHeight = `${PANEL_MAX_TEXTAREA_HEIGHT}px`;
    textarea.style.resize = "vertical";
    textarea.style.overflowY = "hidden";
    textarea.style.boxSizing = "border-box";
    textarea.style.borderRadius = "6px";
    textarea.style.padding = "8px";
    textarea.style.fontFamily = "var(--font-interface)";
    textarea.style.fontSize = "13px";
    textarea.style.lineHeight = "1.45";

    textarea.addEventListener("input", () => {
      this.currentClipboardText = textarea.value;
      this.clipboardArmedAt = Date.now();
      this.chainText = textarea.value;
      this.chainActive = Boolean(textarea.value);
      urlButton.setText(this.getObsidianUrlToggleLabel(textarea.value));
      diskButton.setText(this.getDiskPathToggleLabel(textarea.value));
      this.resizeClipboardPanelTextarea(textarea);
      this.syncClipboardEditors(textarea.value, textarea);
      this.refreshClipboardPanelTimer();
    });

    window.setTimeout(() => this.resizeClipboardPanelTextarea(textarea), 0);
    return textarea;
  }

  getObsidianUrlToggleLabel(text) {
    return this.isObsidianUrlText(text) ? "转回普通格式" : "转成 ObsidianURL";
  }

  getDiskPathToggleLabel(text) {
    return this.isDiskPathText(text) ? "转回普通格式" : "转成磁盘路径";
  }

  updateConversionToggleButtons() {
    for (const button of document.querySelectorAll(".copy-selected-name-url-toggle")) {
      button.setText(this.getObsidianUrlToggleLabel(this.currentClipboardText));
    }
    for (const button of document.querySelectorAll(".copy-selected-name-disk-toggle")) {
      button.setText(this.getDiskPathToggleLabel(this.currentClipboardText));
    }
  }

  resizeClipboardPanelTextarea(textarea = this.clipboardPanelTextarea) {
    if (!textarea) {
      return;
    }

    textarea.style.height = `${PANEL_BASE_TEXTAREA_HEIGHT}px`;
    const nextHeight = Math.min(textarea.scrollHeight, PANEL_MAX_TEXTAREA_HEIGHT);
    textarea.style.height = `${Math.max(PANEL_BASE_TEXTAREA_HEIGHT, nextHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > PANEL_MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  }

  syncClipboardEditors(text, source = null) {
    for (const editor of document.querySelectorAll("textarea.copy-selected-name-editor")) {
      if (!(editor instanceof HTMLTextAreaElement) || editor === source) {
        continue;
      }

      if (editor.value !== text) {
        editor.value = text;
      }
      this.resizeClipboardPanelTextarea(editor);
    }
  }

  refreshClipboardPanelTimer() {
    this.clearClipboardPanelTimer();
    if (this.clipboardPanelHovered || this.clipboardPanelFocused) {
      return;
    }

    this.clipboardPanelHideTimer = window.setTimeout(() => this.hideClipboardPanel(), PANEL_HIDE_MS);
  }

  clearClipboardPanelTimer() {
    if (this.clipboardPanelHideTimer) {
      window.clearTimeout(this.clipboardPanelHideTimer);
      this.clipboardPanelHideTimer = null;
    }
  }

  hideClipboardPanel() {
    this.clearClipboardPanelTimer();
    if (this.clipboardPanelEl) {
      this.clipboardPanelEl.remove();
    }

    this.clipboardPanelEl = null;
    this.clipboardPanelTextarea = null;
    this.clipboardPanelHovered = false;
    this.clipboardPanelFocused = false;
  }

  isInsideClipboardEditor(target) {
    return target instanceof Element &&
      Boolean(target.closest(".copy-selected-name-editor-shell"));
  }

  isEditablePasteTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      return true;
    }

    return Boolean(target.closest("[contenteditable='true'], .cm-content"));
  }

  insertTextIntoEditableTarget(target, text) {
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      target.focus();
      target.setRangeText(text, start, end, "end");
      this.dispatchInputEvent(target, text);
      return;
    }

    const editable = target instanceof Element
      ? target.closest("[contenteditable='true'], .cm-content")
      : null;
    if (editable instanceof HTMLElement) {
      editable.focus();
      document.execCommand("insertText", false, text);
    }
  }

  async toggleEditorObsidianUrl(textarea) {
    const nextText = this.isObsidianUrlText(textarea.value)
      ? this.getMentionTextFromObsidianUrls(textarea.value)
      : this.getObsidianUrlTextFromMentions(textarea.value);

    if (!nextText) {
      new Notice("No matching files found");
      return;
    }

    this.applyEditorConversion(textarea, nextText);
  }

  async toggleEditorDiskPath(textarea) {
    const nextText = this.isDiskPathText(textarea.value)
      ? this.getMentionTextFromDiskPaths(textarea.value)
      : this.getDiskPathTextFromText(textarea.value);

    if (!nextText) {
      new Notice("No matching files found");
      return;
    }

    this.applyEditorConversion(textarea, nextText);
  }

  applyEditorConversion(textarea, nextText) {
    textarea.value = nextText;
    this.currentClipboardText = nextText;
    this.clipboardArmedAt = Date.now();
    this.chainText = nextText;
    this.chainActive = Boolean(nextText);
    this.syncClipboardEditors(nextText, textarea);
    this.resizeClipboardPanelTextarea(textarea);
    this.updateConversionToggleButtons();
    this.refreshClipboardPanelTimer();
    new Notice("Converted");
  }

  async copyEditorAsObsidianUrls(textarea) {
    const text = this.isObsidianUrlText(textarea.value)
      ? textarea.value.trim()
      : this.getObsidianUrlTextFromMentions(textarea.value);
    if (!text) {
      new Notice("No matching files found");
      return;
    }

    if (await this.writeSystemClipboard(text)) {
      new Notice("Copied Obsidian URL");
    }
  }

  async copyEditorAsDiskPaths(textarea) {
    const text = this.isDiskPathText(textarea.value)
      ? textarea.value.trim()
      : this.getDiskPathTextFromText(textarea.value);
    if (!text) {
      new Notice("No matching files found");
      return;
    }

    if (await this.writeSystemClipboard(text)) {
      new Notice("Copied disk path");
    }
  }

  getObsidianUrlTextFromMentions(text) {
    const urls = this.getObsidianUrlsFromText(text);
    return urls.length === 0 ? "" : urls.join("\n");
  }

  isObsidianUrlText(text) {
    return this.extractObsidianUrls(text).length > 0 && this.extractMentionNames(text).length === 0;
  }

  getMentionTextFromObsidianUrls(text) {
    const names = this.extractObsidianUrls(text)
      .map((url) => this.resolveObsidianUrlToName(url))
      .filter(Boolean);
    return names.length === 0 ? "" : this.buildMentionText(names);
  }

  getObsidianUrlsFromText(text) {
    return this.extractNamesFromAnyFormat(text)
      .map((name) => this.resolveMentionToVaultItem(name))
      .filter(Boolean)
      .map((item) => this.buildObsidianUrl(item));
  }

  getDiskPathTextFromText(text) {
    if (!this.getVaultBasePath()) {
      new Notice("Cannot resolve vault disk path");
      return "";
    }

    const paths = this.extractNamesFromAnyFormat(text)
      .map((name) => this.resolveMentionToVaultItem(name))
      .filter(Boolean)
      .map((item) => this.buildDiskPath(item.path))
      .filter(Boolean);
    return paths.length === 0 ? "" : paths.join("\n");
  }

  getMentionTextFromDiskPaths(text) {
    const names = this.extractDiskPaths(text)
      .map((diskPath) => this.getVaultRelativePath(diskPath))
      .filter(Boolean)
      .map((relPath) => {
        const item = this.app.vault.getAbstractFileByPath(relPath);
        return item ? item.path : relPath;
      });
    return names.length === 0 ? "" : this.buildMentionText(names);
  }

  isDiskPathText(text) {
    return this.extractDiskPaths(text).length > 0 && this.extractMentionNames(text).length === 0;
  }

  extractDiskPaths(text) {
    return text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => DISK_PATH_LINE_PATTERN.test(line));
  }

  extractNamesFromAnyFormat(text) {
    // 逐行解析，允许三种格式（磁盘路径 / Obsidian URL / @mention）混在一起而不丢行。
    const names = [];

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      if (DISK_PATH_LINE_PATTERN.test(line)) {
        const relPath = this.getVaultRelativePath(line);
        if (relPath) {
          names.push(relPath);
        }
        continue;
      }

      const urlTokens = line.split(/\s+/).filter((part) => part.startsWith("obsidian://"));
      if (urlTokens.length > 0) {
        for (const url of urlTokens) {
          const name = this.resolveObsidianUrlToName(url);
          if (name) {
            names.push(name);
          }
        }
        continue;
      }

      for (const name of this.extractMentionNames(line)) {
        names.push(name);
      }
    }

    return names;
  }

  getVaultBasePath() {
    const adapter = this.app.vault.adapter;
    if (adapter && typeof adapter.getBasePath === "function") {
      return adapter.getBasePath() || "";
    }

    return "";
  }

  buildDiskPath(relPath) {
    const basePath = this.getVaultBasePath();
    if (!basePath || !relPath) {
      return "";
    }

    const separator = basePath.includes("\\") || /^[A-Za-z]:/.test(basePath) ? "\\" : "/";
    const trimmedBase = basePath.replace(/[\\/]+$/, "");
    return `${trimmedBase}${separator}${relPath.split("/").join(separator)}`;
  }

  getVaultRelativePath(diskPath) {
    const basePath = this.getVaultBasePath();
    if (!basePath) {
      return "";
    }

    const normalizedBase = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedPath = diskPath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalizedPath.toLowerCase().startsWith(`${normalizedBase.toLowerCase()}/`)) {
      return "";
    }

    return normalizedPath.slice(normalizedBase.length + 1);
  }

  extractObsidianUrls(text) {
    return text.split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.startsWith("obsidian://"));
  }

  extractMentionNames(text) {
    const names = [];
    for (const rawLine of text.split(/\r?\n/)) {
      // 一行内允许多个以空白分隔的 @mention；只在“空白 + @”处切分，这样文件名内部
      // 出现的 @（前面没有空白）以及名字里的空格都会被保留。
      for (const chunk of rawLine.split(/\s+(?=@)/)) {
        const trimmed = chunk.trim();
        if (!trimmed.startsWith("@")) {
          continue;
        }

        const name = trimmed.slice(1).trim();
        if (name) {
          names.push(name);
        }
      }
    }
    return names;
  }

  resolveMentionToVaultItem(name) {
    const direct = this.app.vault.getAbstractFileByPath(name);
    if (direct) {
      return direct;
    }

    const exactMatch = this.getAllVaultItems().find((item) =>
      item && (item.name === name || item.path === name)
    );
    if (exactMatch) {
      return exactMatch;
    }

    const normalized = name.toLowerCase();
    return this.getAllVaultItems().find((item) =>
      item && (item.name.toLowerCase() === normalized || item.path.toLowerCase() === normalized)
    ) || null;
  }

  getAllVaultItems() {
    if (typeof this.app.vault.getAllLoadedFiles === "function") {
      return this.app.vault.getAllLoadedFiles();
    }

    return this.app.vault.getFiles();
  }

  buildObsidianUrl(item) {
    const vault = encodeURIComponent(this.app.vault.getName());
    const file = encodeURIComponent(item.path);
    return `obsidian://open?vault=${vault}&file=${file}`;
  }

  resolveObsidianUrlToName(urlText) {
    try {
      const url = new URL(urlText);
      const filePath = url.searchParams.get("file");
      if (!filePath) {
        return "";
      }

      const item = this.app.vault.getAbstractFileByPath(filePath);
      if (item) {
        return item.path;
      }

      return filePath;
    } catch (error) {
      return "";
    }
  }

  async writeSystemClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      try {
        const { clipboard } = require("electron");
        clipboard.writeText(text);
        return true;
      } catch (fallbackError) {
        console.error("Copy Selected Name: failed to write system clipboard", fallbackError);
        new Notice("无法写入系统剪贴板");
        return false;
      }
    }
  }

  getFocusedClaudianInput() {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLTextAreaElement)) {
      return null;
    }

    return activeElement.matches(CLAUDIAN_INPUT_SELECTOR) ? activeElement : null;
  }

  insertTextAtCursor(inputEl, text) {
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end = inputEl.selectionEnd ?? start;
    inputEl.focus();
    inputEl.setRangeText(text, start, end, "end");
    this.dispatchInputEvent(inputEl, text);
  }

  dispatchInputEvent(inputEl, text) {
    let event;
    try {
      event = new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      });
    } catch (error) {
      event = new Event("input", { bubbles: true });
    }

    inputEl.dispatchEvent(event);
  }
};

class CopyModeModal extends Modal {
  constructor(app, plugin, text, selectionKey = "") {
    super(app);
    this.plugin = plugin;
    this.text = text;
    this.selectionKey = selectionKey;
    this.historyVisible = false;
  }

  onOpen() {
    this.plugin.hideClipboardPanel();
    this.render();
  }

  onClose() {
    this.plugin.handleCopyModeModalClosed(this);
  }

  updateText(text, selectionKey = "") {
    this.text = text;
    this.selectionKey = selectionKey;
    if (this.modalEl?.isConnected) {
      this.render();
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.replaceChildren();
    contentEl.style.minWidth = "520px";

    const editorHost = contentEl.createDiv({
      cls: "copy-selected-name-modal-editor copy-selected-name-editor-shell"
    });
    editorHost.style.marginBottom = "14px";
    editorHost.style.padding = "10px";
    editorHost.style.border = "1px solid var(--background-modifier-border)";
    editorHost.style.borderRadius = "8px";
    editorHost.style.background = "var(--background-primary)";
    this.plugin.renderClipboardEditor(editorHost);

    const title = contentEl.createEl("h2", { text: "这次 Alt/Option+C 怎么处理？" });
    title.style.marginBottom = "12px";

    const preview = contentEl.createEl("div", { text: this.text });
    preview.style.padding = "10px";
    preview.style.border = "1px solid var(--background-modifier-border)";
    preview.style.borderRadius = "6px";
    preview.style.background = "var(--background-secondary)";
    preview.style.wordBreak = "break-all";

    const actionRow = contentEl.createDiv();
    actionRow.style.display = "flex";
    actionRow.style.gap = "8px";
    actionRow.style.marginTop = "16px";

    const overwriteButton = actionRow.createEl("button", { text: "覆盖" });
    overwriteButton.addClass("mod-cta");
    overwriteButton.addEventListener("click", async () => {
      await this.plugin.performOverwrite(this.text, this.selectionKey);
      this.close();
    });

    const appendButton = actionRow.createEl("button", { text: "追加" });
    appendButton.addEventListener("click", async () => {
      await this.plugin.performAppend(this.text, { selectionKey: this.selectionKey });
      this.close();
    });

    const footer = contentEl.createDiv();
    footer.style.display = "flex";
    footer.style.justifyContent = "space-between";
    footer.style.alignItems = "center";
    footer.style.marginTop = "18px";

    const cancelButton = footer.createEl("button", { text: "取消" });
    cancelButton.addEventListener("click", () => this.close());

    const historyButton = footer.createEl("button", {
      text: this.historyVisible ? "收起历史" : "历史记录"
    });
    historyButton.addEventListener("click", () => {
      this.historyVisible = !this.historyVisible;
      this.render();
    });

    if (this.historyVisible) {
      this.renderHistory(contentEl);
    }
  }

  renderHistory(contentEl) {
    const historyBox = contentEl.createDiv();
    historyBox.style.marginTop = "14px";
    historyBox.style.maxHeight = "280px";
    historyBox.style.overflowY = "auto";
    historyBox.style.borderTop = "1px solid var(--background-modifier-border)";
    historyBox.style.paddingTop = "10px";

    const records = this.plugin.history
      .map((record, index) => ({ record, index }))
      .reverse();
    if (records.length === 0) {
      historyBox.createDiv({ text: "暂无历史记录" });
      return;
    }

    for (const { record, index } of records) {
      const row = historyBox.createDiv();
      row.style.display = "grid";
      row.style.gridTemplateColumns = "1fr auto";
      row.style.gap = "8px";
      row.style.alignItems = "center";
      row.style.padding = "8px 0";
      row.style.borderBottom = "1px solid var(--background-modifier-border)";

      const textWrap = row.createDiv();
      this.renderHistoryText(textWrap, record);

      const buttonWrap = row.createDiv();
      buttonWrap.style.display = "flex";
      buttonWrap.style.gap = "6px";
      buttonWrap.style.alignItems = "center";

      const copyButton = buttonWrap.createEl("button", { text: "复制" });
      copyButton.addEventListener("click", () => {
        this.plugin.setPluginClipboard(record.text, { updateChain: true });
        new Notice("Copied to plugin clipboard");
      });

      const editButton = buttonWrap.createEl("button", { text: "编辑" });
      editButton.addEventListener("click", async () => {
        if (editButton.textContent === "保存") {
          const editor = textWrap.querySelector("textarea");
          if (!(editor instanceof HTMLTextAreaElement)) {
            return;
          }

          record.text = editor.value;
          if (this.plugin.history[index]) {
            this.plugin.history[index].text = editor.value;
          }
          await this.plugin.savePluginData();
          textWrap.empty();
          this.renderHistoryText(textWrap, record);
          editButton.setText("编辑");
          new Notice("History updated");
          return;
        }

        textWrap.empty();
        const meta = textWrap.createDiv({ text: this.formatTime(record.createdAt) });
        meta.style.color = "var(--text-muted)";
        meta.style.fontSize = "12px";
        const editor = textWrap.createEl("textarea");
        editor.value = record.text;
        editor.style.width = "100%";
        editor.style.minHeight = "72px";
        editor.style.boxSizing = "border-box";
        editor.style.resize = "vertical";
        editButton.setText("保存");
        editor.focus();
      });
    }
  }

  renderHistoryText(textWrap, record) {
    const meta = textWrap.createDiv({ text: this.formatTime(record.createdAt) });
    meta.style.color = "var(--text-muted)";
    meta.style.fontSize = "12px";
    const text = textWrap.createDiv({ text: record.text });
    text.style.wordBreak = "break-all";
  }

  formatTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleString();
    } catch (error) {
      return "";
    }
  }
}

class CopySelectedNameSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.captureCleanup = null;
  }

  hide() {
    this.stopShortcutCapture();
  }

  display() {
    this.stopShortcutCapture();
    const { containerEl } = this;
    containerEl.replaceChildren();

    containerEl.createEl("h2", { text: "Copy Selected Name" });
    containerEl.createEl("p", {
      text: "配置文件/文件夹引用复制和物理磁盘路径复制使用的快捷键。"
    });

    containerEl.createEl("h3", { text: "文件名引用复制" });
    containerEl.createEl("p", {
      text: "Alt+C / Option+C：生成 @文件名 或 @文件夹名，写入插件内部剪贴板，并支持单击、双击、三击动作。"
    });
    this.addShortcutSetting(
      containerEl,
      "mention",
      "windows",
      "Windows 快捷键（引用复制）",
      "Windows/Linux 下使用这一栏。默认 Alt+C。"
    );
    this.addShortcutSetting(
      containerEl,
      "mention",
      "mac",
      "Mac 快捷键（引用复制）",
      "macOS 下使用这一栏。默认 Option+C。"
    );

    new Setting(containerEl)
      .setName("连按判断间隔")
      .setDesc("两次或三次按键之间小于这个时间，就会被识别为双击或三击（引用复制和磁盘路径复制共用这个间隔）。范围 200-3000 毫秒。")
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.pressWindowMs))
          .setValue(String(this.plugin.getPressWindowMs()))
          .onChange(async (value) => {
            const nextValue = this.plugin.normalizePressWindowMs(value);
            this.plugin.settings.pressWindowMs = nextValue;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.min = "200";
        text.inputEl.max = "3000";
        text.inputEl.step = "100";
      });

    this.addActionSetting(containerEl, "single", "单击动作", "按一次快捷键时执行的动作。");
    this.addActionSetting(containerEl, "double", "双击动作", "在连按判断间隔内按两次快捷键时执行的动作。");
    this.addActionSetting(containerEl, "triple", "三击动作", "在连按判断间隔内按三次快捷键时执行的动作。");

    new Setting(containerEl)
      .setName("恢复默认引用复制动作")
      .setDesc("恢复为：单击智能覆盖、双击追加、三击弹窗。")
      .addButton((button) => {
        button
          .setButtonText("恢复默认")
          .onClick(async () => {
            this.plugin.settings.pressWindowMs = DEFAULT_SETTINGS.pressWindowMs;
            this.plugin.settings.pressActions = { ...DEFAULT_SETTINGS.pressActions };
            await this.plugin.saveSettings();
            this.display();
          });
      });

    containerEl.createEl("h3", { text: "物理磁盘路径复制" });
    containerEl.createEl("p", {
      text: "Alt+X / Option+X：复制选中文件或文件夹的真实磁盘路径，直接写入系统剪贴板。单击覆盖；和 Alt+C 一样，在连按判断间隔内双击会把这次的路径追加到上一次复制的路径后面，方便一次攒出多个路径。"
    });
    this.addShortcutSetting(
      containerEl,
      "diskPath",
      "windows",
      "Windows 快捷键（磁盘路径复制）",
      "Windows/Linux 下使用这一栏。默认 Alt+X。"
    );
    this.addShortcutSetting(
      containerEl,
      "diskPath",
      "mac",
      "Mac 快捷键（磁盘路径复制）",
      "macOS 下使用这一栏。默认 Option+X。"
    );

    const note = containerEl.createEl("p");
    note.style.color = "var(--text-muted)";
    note.style.fontSize = "12px";
    note.setText("补充：这两个功能也会在 Obsidian 的“快捷键/Hotkeys”列表里显示命令。你可以用 Obsidian 原生快捷键绑定触发；引用复制的单击/双击/三击动作仍以这里的设置为准。");
  }

  addActionSetting(containerEl, key, name, desc) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addDropdown((dropdown) => {
        for (const [action, label] of Object.entries(PRESS_ACTION_LABELS)) {
          dropdown.addOption(action, label);
        }
        dropdown
          .setValue(this.plugin.settings.pressActions[key])
          .onChange(async (value) => {
            this.plugin.settings.pressActions[key] = this.plugin.normalizePressAction(
              value,
              DEFAULT_SETTINGS.pressActions[key]
            );
            await this.plugin.saveSettings();
          });
      });
  }

  addShortcutSetting(containerEl, shortcutGroup, platformKey, name, desc) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addButton((button) => {
        button
          .setButtonText(this.plugin.formatShortcut(
            this.plugin.getShortcutForPlatform(shortcutGroup, platformKey),
            platformKey
          ))
          .setTooltip("当前快捷键")
          .setDisabled(true);
      })
      .addButton((button) => {
        button
          .setButtonText("录制快捷键")
          .setCta()
          .onClick(() => this.startShortcutCapture(button, shortcutGroup, platformKey));
      })
      .addButton((button) => {
        button
          .setButtonText("恢复默认")
          .onClick(async () => {
            this.plugin.setShortcutForPlatform(
              shortcutGroup,
              platformKey,
              { ...DEFAULT_SETTINGS.shortcuts[shortcutGroup][platformKey] }
            );
            await this.plugin.saveSettings();
            this.display();
          });
      });
  }

  startShortcutCapture(button, shortcutGroup, platformKey) {
    this.stopShortcutCapture();
    button.setButtonText("按下新的快捷键...");
    new Notice(`Press the new ${platformKey === "mac" ? "Mac" : "Windows"} shortcut. Press Esc to cancel.`);

    const handler = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      if (event.key === "Escape") {
        this.stopShortcutCapture();
        this.display();
        return;
      }

      const shortcut = this.plugin.shortcutFromEvent(event, platformKey);
      if (!shortcut) {
        new Notice("Please include a non-modifier key");
        return;
      }

      this.plugin.setShortcutForPlatform(shortcutGroup, platformKey, shortcut);
      await this.plugin.saveSettings();
      new Notice(`Shortcut set to ${shortcut.label}`);
      this.stopShortcutCapture();
      this.display();
    };

    document.addEventListener("keydown", handler, true);
    this.captureCleanup = () => {
      document.removeEventListener("keydown", handler, true);
      this.captureCleanup = null;
    };
  }

  stopShortcutCapture() {
    if (this.captureCleanup) {
      this.captureCleanup();
    }
  }
}
