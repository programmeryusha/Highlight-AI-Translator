import type { Message } from "../types";

let widget: HTMLElement | null = null;
let skipNextMouseup = false;

// Floating camera button
let cameraBtn: HTMLElement | null = null;

function createCameraButton() {
  if (cameraBtn) return;
  cameraBtn = document.createElement("div");
  cameraBtn.title = "Screenshot to explain";
  cameraBtn.textContent = "📷";
  cameraBtn.setAttribute("style", `
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 44px;
    height: 44px;
    background: #1a1a2e;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 50%;
    font-size: 20px;
    line-height: 44px;
    text-align: center;
    cursor: pointer;
    z-index: 2147483646;
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    user-select: none;
    transition: transform 0.1s;
  `);
  cameraBtn.addEventListener("mouseenter", () => { cameraBtn!.style.transform = "scale(1.1)"; });
  cameraBtn.addEventListener("mouseleave", () => { cameraBtn!.style.transform = "scale(1)"; });
  cameraBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TAKE_SCREENSHOT" } as Message);
  });
  document.body.appendChild(cameraBtn);
}

function removeCameraButton() {
  if (cameraBtn) { cameraBtn.remove(); cameraBtn = null; }
}

// Show/hide camera button based on settings
function syncCameraButton() {
  chrome.storage.local.get("screenshot_triggers", (result) => {
    const triggers = result.screenshot_triggers ?? { floatingButton: true, shortcut: true };
    if (triggers.floatingButton) createCameraButton();
    else removeCameraButton();
  });
}

syncCameraButton();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.screenshot_triggers) syncCameraButton();
});

function removeWidget() {
  if (widget) {
    widget.remove();
    widget = null;
  }
}

function showSaveBubble(x: number, y: number, selectedText: string) {
  removeWidget();

  widget = document.createElement("div");
  widget.textContent = "Save";
  widget.setAttribute(
    "style",
    `
    position: fixed;
    left: ${x}px;
    top: ${y - 40}px;
    background: #1a1a2e;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 5px 14px;
    border-radius: 999px;
    cursor: pointer;
    z-index: 2147483647;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    user-select: none;
    border: 1px solid rgba(255,255,255,0.1);
  `
  );

  widget.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    skipNextMouseup = true;
    showContextInput(x, y, selectedText);
  });

  document.body.appendChild(widget);
}

function showContextInput(x: number, y: number, selectedText: string) {
  removeWidget();

  const left = Math.min(Math.max(x - 175, 8), window.innerWidth - 368);
  const top = Math.max(y - 110, 8);

  widget = document.createElement("div");
  widget.setAttribute(
    "style",
    `
    position: fixed;
    left: ${left}px;
    top: ${top}px;
    background: #1a1a2e;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    z-index: 2147483647;
    width: 360px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    overflow: hidden;
  `
  );

  const preview = document.createElement("div");
  const previewText = selectedText.length > 60 ? selectedText.slice(0, 60) + "…" : selectedText;
  preview.textContent = `"${previewText}"`;
  preview.setAttribute(
    "style",
    `
    font-size: 11px;
    color: #6366f1;
    padding: 8px 12px 6px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `
  );

  const input = document.createElement("input");
  input.type = "text";
  input.dir = "auto";
  input.placeholder = "Any specific part of the text you don't understand?";
  input.setAttribute(
    "style",
    `
    display: block;
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: #e2e8f0;
    font-size: 13px;
    padding: 10px 14px;
    box-sizing: border-box;
  `
  );

  function doSave() {
    const message: Message = {
      type: "SAVE_HIGHLIGHT",
      text: selectedText,
      url: location.href,
      title: document.title,
      context: input.value.trim(),
    };
    chrome.runtime.sendMessage(message);
    removeWidget();
    window.getSelection()?.removeAllRanges();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSave();
    if (e.key === "Escape") removeWidget();
    e.stopPropagation();
  });

  widget.appendChild(preview);
  widget.appendChild(input);
  document.body.appendChild(widget);

  setTimeout(() => input.focus(), 50);
}

// Crop overlay state
let cropOverlay: HTMLElement | null = null;

function removeCropOverlay() {
  if (cropOverlay) { cropOverlay.remove(); cropOverlay = null; }
  if (cameraBtn) cameraBtn.style.display = "";
}

function showCropOverlay(screenshotDataUrl: string) {
  removeCropOverlay();
  if (cameraBtn) cameraBtn.style.display = "none";

  cropOverlay = document.createElement("div");
  cropOverlay.setAttribute("style", `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0,0,0,0.6);
    cursor: crosshair;
    user-select: none;
  `);

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  cropOverlay.appendChild(canvas);

  const hint = document.createElement("div");
  hint.textContent = "Drag to select a region · Esc to cancel";
  hint.setAttribute("style", `
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.75);
    color: #fff;
    padding: 8px 20px;
    border-radius: 999px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: none;
  `);
  cropOverlay.appendChild(hint);

  document.body.appendChild(cropOverlay);

  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    let dragStart: { x: number; y: number } | null = null;
    let selection: { x: number; y: number; w: number; h: number } | null = null;
    let contextPanel: HTMLElement | null = null;

    function getPos(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    }

    function redraw() {
      ctx.drawImage(img, 0, 0);
      if (selection) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.clearRect(selection.x, selection.y, selection.w, selection.h);
        ctx.drawImage(img, selection.x, selection.y, selection.w, selection.h, selection.x, selection.y, selection.w, selection.h);
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 2;
        ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      }
    }

    function showContextPanel(sel: { x: number; y: number; w: number; h: number }) {
      if (contextPanel) contextPanel.remove();
      hint.style.display = "none";

      contextPanel = document.createElement("div");
      contextPanel.setAttribute("style", `
        position: fixed;
        bottom: 32px;
        left: 50%;
        transform: translateX(-50%);
        background: #1a1a2e;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 12px;
        padding: 16px 20px;
        width: 400px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        z-index: 2147483647;
        cursor: default;
      `);

      const label = document.createElement("p");
      label.textContent = "Region selected";
      label.style.cssText = "color:#6366f1;font-size:12px;margin:0 0 8px;";
      contextPanel.appendChild(label);

      const input = document.createElement("input");
      input.type = "text";
      input.dir = "auto";
      input.placeholder = "Any specific part you don't understand? (optional)";
      input.setAttribute("style", `
        width: 100%;
        background: transparent;
        border: none;
        border-bottom: 1px solid rgba(255,255,255,0.15);
        color: #e2e8f0;
        font-size: 14px;
        padding: 6px 0;
        outline: none;
        margin-bottom: 12px;
        box-sizing: border-box;
      `);
      contextPanel.appendChild(input);

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:8px;";

      const saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      saveBtn.setAttribute("style", `
        flex: 1;
        background: #6366f1;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 8px 0;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      `);

      const reselectBtn = document.createElement("button");
      reselectBtn.textContent = "Reselect";
      reselectBtn.setAttribute("style", `
        flex: 1;
        background: rgba(255,255,255,0.08);
        color: #94a3b8;
        border: none;
        border-radius: 6px;
        padding: 8px 0;
        font-size: 13px;
        cursor: pointer;
      `);

      async function doSave() {
        const offscreen = document.createElement("canvas");
        offscreen.width = sel.w;
        offscreen.height = sel.h;
        const offCtx = offscreen.getContext("2d")!;
        offCtx.drawImage(img, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
        const croppedDataUrl = offscreen.toDataURL("image/png");
        chrome.runtime.sendMessage({ type: "SAVE_SCREENSHOT", imageData: croppedDataUrl, context: input.value.trim() } as Message);
        removeCropOverlay();
      }

      saveBtn.addEventListener("click", doSave);
      reselectBtn.addEventListener("click", () => {
        if (contextPanel) { contextPanel.remove(); contextPanel = null; }
        selection = null;
        redraw();
        hint.style.display = "";
        canvas.style.cursor = "crosshair";
        cropOverlay!.style.cursor = "crosshair";
      });

      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") doSave();
        if (e.key === "Escape") {
          contextPanel?.remove(); contextPanel = null;
          selection = null; redraw();
          hint.style.display = "";
          canvas.style.cursor = "crosshair";
          cropOverlay!.style.cursor = "crosshair";
        }
      });

      btnRow.appendChild(saveBtn);
      btnRow.appendChild(reselectBtn);
      contextPanel.appendChild(btnRow);
      cropOverlay!.appendChild(contextPanel);

      setTimeout(() => input.focus(), 50);
    }

    canvas.addEventListener("mousedown", (e) => {
      if (contextPanel) return;
      e.preventDefault();
      dragStart = getPos(e);
      selection = null;
      redraw();
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!dragStart || contextPanel) return;
      const pos = getPos(e);
      selection = {
        x: Math.min(dragStart.x, pos.x),
        y: Math.min(dragStart.y, pos.y),
        w: Math.abs(pos.x - dragStart.x),
        h: Math.abs(pos.y - dragStart.y),
      };
      redraw();
    });

    canvas.addEventListener("mouseup", () => {
      if (!selection || selection.w < 10 || selection.h < 10) { dragStart = null; selection = null; removeCropOverlay(); return; }
      dragStart = null;
      canvas.style.cursor = "default";
      cropOverlay!.style.cursor = "default";
      showContextPanel(selection);
    });
  };
  img.src = screenshotDataUrl;
}

// Listen for context menu trigger from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SHOW_CONTEXT_INPUT") {
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    showContextInput(x, y, message.text);
  }
  if (message.type === "SHOW_CROP_OVERLAY") {
    showCropOverlay(message.imageData);
  }
});

// Show Save bubble (or immediate context input) on text selection
document.addEventListener("mouseup", (e) => {
  if (skipNextMouseup) { skipNextMouseup = false; return; }
  setTimeout(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";

    if (text.length > 0 && selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top;

      chrome.storage.local.get("save_triggers", (result) => {
        const triggers = result.save_triggers ?? { bubble: true, contextMenu: true };
        if (triggers.bubble) {
          showSaveBubble(x, y, text);
        }
      });
    } else {
      const target = e.target as HTMLElement;
      if (widget && !widget.contains(target)) {
        removeWidget();
      }
    }
  }, 10);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { removeWidget(); removeCropOverlay(); }
});
