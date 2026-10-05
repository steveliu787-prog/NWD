# New World Recruitment UX Prototype

This repository hosts a single-page recruitment site prototype for the UX/UI academic redesign project.

- Live site: https://steveliu787-prog.github.io/NWD/
- Main page: `index.html`
- Images: `assets/images/`
- Published content edits: `edits.json`
- Editor code: `assets/editor/`

## Open the in-page editor

Use one of these methods while viewing the site:

- Press `Ctrl + Shift + E` on Windows/Linux, or `Cmd + Shift + E` on macOS.
- Add `#editor` to the end of the site URL.

While editing is enabled:

- Click any outlined text to edit it in place. Changes save to the browser instantly — click elsewhere (or press `Ctrl + Enter`) to confirm, `Esc` to cancel.
- Click any outlined image to open the crop panel. Drag to reposition, adjust the zoom slider, then apply — the exported image keeps the page slot's ratio, so the layout never shifts.
- The toolbar language tabs (简 / 繁 / EN) switch which language layer you are editing; each language keeps its own edits.
- 撤销 / 重做 step back and forward through recent edits — `Ctrl + Z` to undo, `Ctrl + Shift + Z` (or `Ctrl + Y`) to redo. Every text, image, and layout change is recorded (up to 40 steps), including 放弃全部修改. Inside a text field or inline text editing the browser's native undo applies instead.
- 放弃全部修改 drops all unpublished changes at once and restores the last published content (still recoverable via 撤销).
- The status area always shows how many changes are waiting to be published.

## Free layout editing

The editor can also move, resize, hide, and add page elements:

- **Move**: drag any outlined element (dashed outline on hover). Text still opens for editing on a plain click — drag more than a few pixels to move it instead. Moves are visual offsets; the page does not reflow.
- **Snap guides**: while dragging or resizing, the element automatically snaps to the content column's left edge, vertical center, and right edge (and the matching horizontal lines), as well as to the edges and centers of other overlay elements. A dashed guide line shows what it snapped to.
- **Select**: click a non-text element (card, icon, arrow, badge) or right-click anything to select it. A floating toolbar appears with 重置 (undo move/resize) and 删除.
- **Resize**: drag the small handle at the element's bottom-right corner.
- **Delete/restore**: 删除 hides an existing element; the toolbar button 已删除 (N) lists hidden elements for one-click 恢复. `Delete`/`Backspace` also removes the current selection.
- **Add**: the 添加 ▾ menu inserts a new overlay element — 文字 / 图片 / 气泡 / 箭头 / 矩形 / 线条 — into the section at the center of the screen.
- **Overlay elements**: drag to move, handle to resize, double-click text/bubbles to edit (per language), and use the floating toolbar for color presets, rotation, layer order (上移层 / 下移层), 复制, and 删除. Overlay images reuse the crop panel via 换图.

All of the above counts toward the same "N 处修改待发布" counter and publishes with the same 发布 button. Layout state is stored as a `layout` key in `edits.json`; overlay images are committed to `assets/edits/` like other images. Visitors see the final layout but cannot interact with or move overlay elements.

## Connect GitHub (one-time setup)

Publishing needs a fine-grained personal access token scoped to this repository only:

1. In the editor toolbar select 连接 GitHub, then 打开令牌创建页 — the form is pre-filled (name, 90-day expiry, Contents: Read and write).
2. Under Repository access choose **Only select repositories** and check `steveliu787-prog/NWD`.
3. Select **Generate token** and copy the token.
4. Paste it into the panel and select 连接.

The token is stored only in this browser's local storage. Revoke it anytime at github.com/settings/personal-access-tokens; 断开连接 removes it from the browser.

## Publish changes

Select 发布 in the toolbar:

1. Cropped images are committed to `assets/edits/` as real image files, keeping `edits.json` small.
2. All pending text and image changes are merged into `edits.json` on `main`.
3. GitHub Pages redeploys automatically — the toolbar shows 已上线 ✓ once the live site is updated (usually within a minute).

If the token has expired, the editor reopens the connection panel — paste a fresh token to continue.

## Local preview

Open `index.html` directly in a browser. Editing and local saving work, and publishing works too. On `file://` the remote `edits.json` is not loaded, and cropping an image already loaded from disk is blocked by browser security — re-select it with 从电脑选择图片 to crop it.
