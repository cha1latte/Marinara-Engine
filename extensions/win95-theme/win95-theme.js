(function () {
  // Win95 Theme — wraps major surfaces in decorative window chrome,
  // adds a status bar to the chat surface, and observes the send/stop
  // button to mirror generation state. CSS does the heavy lifting; this
  // file only adds the elements CSS can't conjure on its own.
  //
  // Settings panel: Ctrl+Shift+9 or visit #win95.

  var CHAT_SURFACES = [
    { selector: '[data-component="ChatArea.Conversation"]', title: "Marinara — Conversation", statusbar: true },
    { selector: '[data-component="ChatArea.Roleplay"]',     title: "Marinara — Roleplay",     statusbar: true },
  ];
  var PANEL_SURFACES = [
    // The right panel renders its own header with a close button per
    // active section (Settings, Characters, etc.) — wrapping it in a
    // Win95 titlebar produced a double header. Skinning is CSS-only.
    { selector: '[data-component="ChatSidebar"]', title: "Chats" },
  ];
  var SEND_BTN_SELECTOR = ".mari-chat-send-btn";
  var POLL_MS = 1000;

  var KEY_CHROME = "marinara-win95-chrome";
  var KEY_STATUSBAR = "marinara-win95-statusbar";

  function readBool(key, def) {
    var v = localStorage.getItem(key);
    return v === null ? def : v === "true";
  }
  function writeBool(key, val) { localStorage.setItem(key, val ? "true" : "false"); }

  var statusEl = null, sendObserver = null, lastStatus = null;
  var panel = null, panelLoad = null;

  // ── Window chrome ────────────────────────────────────────────────
  function makeTitlebar(title) {
    var bar = document.createElement("div");
    bar.className = "win95-titlebar";
    bar.setAttribute("data-win95-chrome", "titlebar");
    bar.setAttribute("aria-hidden", "true");
    bar.innerHTML =
      '<span class="win95-titlebar-title"></span>' +
      '<div class="win95-titlebar-buttons">' +
        '<button class="win95-titlebar-btn win95-skip" data-act="min" aria-label="Minimize">_</button>' +
        '<button class="win95-titlebar-btn win95-skip" data-act="max" aria-label="Maximize">□</button>' +
        '<button class="win95-titlebar-btn win95-skip" data-act="close" aria-label="Close">×</button>' +
      '</div>';
    bar.querySelector(".win95-titlebar-title").textContent = title;
    // Buttons are decorative — clicks do nothing destructive.
    bar.querySelectorAll(".win95-titlebar-btn").forEach(function (btn) {
      marinara.on(btn, "click", function (e) { e.preventDefault(); e.stopPropagation(); });
    });
    return bar;
  }

  function ensureChrome(surface, title, withStatusbar) {
    if (!surface) return;
    if (!readBool(KEY_CHROME, true)) {
      removeChrome(surface);
      return;
    }
    surface.classList.add("win95-window");
    if (withStatusbar) surface.classList.add("has-statusbar");

    if (!surface.querySelector(':scope > [data-win95-chrome="titlebar"]')) {
      var bar = makeTitlebar(title);
      // Prepend our element alongside React's children — never touch them.
      surface.insertBefore(bar, surface.firstChild);
      // Ensure cleanup removes the node when the extension unloads.
      marinara.onCleanup(function () { try { bar.remove(); } catch (e) {} });
    }

    if (withStatusbar && !surface.querySelector(':scope > [data-win95-chrome="statusbar"]')) {
      var sb = document.createElement("div");
      sb.className = "win95-statusbar";
      sb.setAttribute("data-win95-chrome", "statusbar");
      sb.setAttribute("aria-hidden", "true");
      sb.innerHTML =
        '<div class="win95-statusbar-cell" data-win95-status="state">Ready</div>' +
        '<div class="win95-statusbar-cell is-fixed" data-win95-status="hint">Marinara Engine</div>';
      surface.appendChild(sb);
      statusEl = sb.querySelector('[data-win95-status="state"]');
      marinara.onCleanup(function () { try { sb.remove(); } catch (e) {} });
    } else if (withStatusbar) {
      statusEl = surface.querySelector('[data-win95-status="state"]');
    }
  }

  function removeChrome(surface) {
    if (!surface) return;
    surface.classList.remove("win95-window", "has-statusbar");
    surface.querySelectorAll(':scope > [data-win95-chrome]').forEach(function (n) { n.remove(); });
  }

  function refreshAllChrome() {
    CHAT_SURFACES.forEach(function (cfg) {
      ensureChrome(document.querySelector(cfg.selector), cfg.title, cfg.statusbar);
    });
    PANEL_SURFACES.forEach(function (cfg) {
      ensureChrome(document.querySelector(cfg.selector), cfg.title, false);
    });
  }

  // ── Status bar ───────────────────────────────────────────────────
  function detectStreaming() {
    // Fallback — streaming state lives in Zustand, not the DOM. OR
    // several stable DOM signatures so any one hit flips us to
    // "Generating…":
    //   1. Tailwind arbitrary-value `[animation-delay:0ms]` — used in
    //      the three places the engine renders typing dots, all of
    //      which only mount while streaming. Most reliable signal.
    //   2. `.mari-message-typing` class wrapper (older path).
    //   3. `.rpg-streaming` class on a roleplay bubble.
    //   4. Stop-* icon under the send button (Lucide).
    //   5. `hover:opacity-80` on the send button — streaming branch only.
    // (a) The send button's `title` attribute flips between "Send"
    // and "Stop" based on streaming state — most reliable signal.
    // Confirmed via DevTools: the button carries `title="Stop"` only
    // while a generation is in flight.
    if (document.querySelector('button[title="Stop"]')) return true;
    // (b) The streaming message bubble mounts with id "__streaming__"
    // once content starts arriving. Misses the pre-content typing
    // phase but covers everything after the first token.
    if (document.querySelector('[data-message-id="__streaming__"]')) return true;
    // (b) Pre-content typing indicator: the engine renders "<X> is
    // typing..." in an italic span with no class hook (wrapper is a
    // generic div, dots use inline-style animation delays). Scan
    // spans inside the chat surface for that literal text — short
    // length filter so a real message containing the words doesn't
    // false-positive.
    var area = document.querySelector(".mari-chat-area, .rpg-chat-area");
    if (area) {
      var spans = area.querySelectorAll("span");
      for (var i = 0; i < spans.length; i++) {
        var t = spans[i].textContent;
        if (t && t.length < 80 && t.indexOf(" is typing") !== -1) return true;
      }
    }
    // (c) ChatMessage's typing-dot spans use the Tailwind class
    // `[animation-delay:0ms]`. ConversationView's dots use an inline
    // style instead, which is why (b) above exists.
    if (document.querySelector('[class*="animation-delay:0ms"]')) return true;
    if (document.querySelector(".mari-message-typing")) return true;
    if (document.querySelector(".rpg-streaming")) return true;
    var btn = document.querySelector(SEND_BTN_SELECTOR);
    if (btn) {
      if (btn.querySelector('[class*="stop"]')) return true;
      var cls = btn.className || "";
      if (typeof cls === "string" && cls.indexOf("hover:opacity-80") !== -1) return true;
    }
    return false;
  }

  function updateStatus() {
    if (!readBool(KEY_STATUSBAR, true)) return;
    if (!statusEl) return;
    var streaming = detectStreaming();
    var next = streaming ? "Generating…" : "Ready";
    if (next === lastStatus) return;
    lastStatus = next;
    statusEl.textContent = next;
  }

  function attachSendObserver() {
    if (sendObserver) return;
    var btn = document.querySelector(SEND_BTN_SELECTOR);
    if (!btn) return;
    sendObserver = marinara.observe(btn, updateStatus, { childList: true, subtree: true, attributes: true });
    updateStatus();
  }

  function reattachSendObserver() {
    if (sendObserver) {
      try { sendObserver.disconnect(); } catch (e) {}
      sendObserver = null;
    }
    attachSendObserver();
  }

  // ── Settings panel ───────────────────────────────────────────────
  function buildPanel() {
    if (panel) return;
    panel = marinara.addElement("body", "div", { class: "win95-settings is-hidden" });
    if (!panel) return;
    panel.innerHTML =
      '<div class="win95-settings-titlebar">' +
        '<span class="win95-settings-titlebar-title">Win95 Theme — Settings</span>' +
        '<button class="win95-titlebar-btn win95-skip" data-w95="close" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="win95-settings-body">' +
        '<div class="win95-settings-row">' +
          '<input type="checkbox" id="w95-chrome" data-w95="chrome">' +
          '<label for="w95-chrome">Show window chrome (titlebars)</label>' +
        '</div>' +
        '<div class="win95-settings-row">' +
          '<input type="checkbox" id="w95-statusbar" data-w95="statusbar">' +
          '<label for="w95-statusbar">Show chat status bar</label>' +
        '</div>' +
        '<p class="win95-settings-help">Press <b>Ctrl+Shift+9</b> or visit <b>#win95</b> to reopen this panel. Settings persist in your browser.</p>' +
        '<div class="win95-settings-actions">' +
          '<button class="win95-skip" data-w95="reset">Reset</button>' +
          '<button class="win95-skip" data-w95="ok">OK</button>' +
        '</div>' +
      '</div>';

    var qs = function (sel) { return panel.querySelector(sel); };
    var chromeEl = qs('[data-w95="chrome"]');
    var statusEl2 = qs('[data-w95="statusbar"]');

    panelLoad = function () {
      chromeEl.checked = readBool(KEY_CHROME, true);
      statusEl2.checked = readBool(KEY_STATUSBAR, true);
    };

    marinara.on(chromeEl, "change", function () {
      writeBool(KEY_CHROME, chromeEl.checked);
      refreshAllChrome();
    });
    marinara.on(statusEl2, "change", function () {
      writeBool(KEY_STATUSBAR, statusEl2.checked);
      refreshAllChrome();
      updateStatus();
    });
    marinara.on(qs('[data-w95="reset"]'), "click", function () {
      localStorage.removeItem(KEY_CHROME);
      localStorage.removeItem(KEY_STATUSBAR);
      panelLoad();
      refreshAllChrome();
    });
    marinara.on(qs('[data-w95="ok"]'), "click", hidePanel);
    marinara.on(qs('[data-w95="close"]'), "click", hidePanel);
  }

  function showPanel() { if (!panel) buildPanel(); if (!panel) return; panelLoad(); panel.classList.remove("is-hidden"); }
  function hidePanel() { if (panel) panel.classList.add("is-hidden"); }
  function togglePanel() {
    if (!panel || panel.classList.contains("is-hidden")) showPanel();
    else hidePanel();
  }

  function checkHash() {
    var h = (location.hash || "").toLowerCase();
    if (h === "#win95" || h === "#win95-settings") {
      showPanel();
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch (e) { location.hash = ""; }
    }
  }

  function onKeydown(e) {
    if (e.key === "Escape" && panel && !panel.classList.contains("is-hidden")) {
      hidePanel();
      return;
    }
    if (e.key === "9" && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      togglePanel();
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────
  marinara.on(window, "keydown", onKeydown);
  marinara.on(window, "hashchange", checkHash);
  checkHash();

  // Periodically reconcile chrome + the send-button observer so chat
  // mode switches and surface remounts pick up automatically. 1Hz is
  // cheap and avoids a body-wide MutationObserver.
  marinara.setInterval(function () {
    refreshAllChrome();
    if (!document.querySelector(SEND_BTN_SELECTOR + " *")) {
      // Send button gone (e.g. no active chat) — drop the observer; it
      // will reattach next tick once the button reappears.
      if (sendObserver) { try { sendObserver.disconnect(); } catch (e) {} sendObserver = null; }
    } else if (!sendObserver) {
      attachSendObserver();
    }
    updateStatus();
  }, POLL_MS);

  refreshAllChrome();
  attachSendObserver();
  updateStatus();
})();
