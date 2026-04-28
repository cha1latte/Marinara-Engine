(function () {
  // Custom Notification Sound — replaces Marinara's synthesized message ping
  // with a user-uploaded audio file.
  //
  // The core ping is generated procedurally via Web Audio API in
  // packages/client/src/lib/notification-sound.ts (two layered sine
  // oscillators at 880 Hz and 1320 Hz). We monkey-patch
  // AudioContext.prototype.createOscillator so that any oscillator whose
  // initial scheduled frequency matches one of those signature values is
  // suppressed, and our user-uploaded sample is played in its place via a
  // transient <audio> element. The 880 Hz oscillator is the trigger; the
  // 1320 Hz shimmer is suppressed silently so only one custom sound fires
  // per ping. If no sound has been uploaded, the patch falls through to the
  // original implementation, so the default ping plays unchanged. The
  // extension card's own on/off handles enable/disable globally — turning
  // the extension off triggers cleanup, which restores the prototype.
  //
  // Settings UI: a bell icon is injected into this extension's card in
  // Settings → Extensions; clicking it opens a popover anchored to the
  // icon (pattern adapted from Decidetto's Accent Color Changer extension).

  var KEY_SOUND = "marinara-cns-sound";
  var KEY_NAME = "marinara-cns-name";
  var KEY_VOLUME = "marinara-cns-volume";

  var DEFAULT_VOLUME = 0.7;
  var PING_FREQS = [880, 1320];
  var DEDUPE_MS = 100;

  var EXTENSION_NAME = marinara.extensionName || "Custom Notification Sound";
  var TOGGLE_ID = "cns-toggle-" + (marinara.extensionId || "x");

  // Lucide bell icon (https://lucide.dev/icons/bell)
  var BELL_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="0.875rem" height="0.875rem" ' +
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path>' +
    '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>' +
    "</svg>";

  var lastPlayed = 0;
  var popover = null;

  function readSound() { return localStorage.getItem(KEY_SOUND) || ""; }
  function readName() { return localStorage.getItem(KEY_NAME) || ""; }
  function readVolume() {
    var v = parseFloat(localStorage.getItem(KEY_VOLUME));
    return isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME;
  }

  function playCustomSound() {
    var url = readSound();
    if (!url) return;
    var now = Date.now();
    if (now - lastPlayed < DEDUPE_MS) return;
    lastPlayed = now;
    try {
      var a = new Audio(url);
      a.volume = readVolume();
      var p = a.play();
      if (p && typeof p.catch === "function") p.catch(function () { /* autoplay blocked */ });
    } catch (e) { /* ignore */ }
  }

  function patchAudioContext() {
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor || Ctor.prototype.__cnsPatched) return;
    var origCreate = Ctor.prototype.createOscillator;
    Ctor.prototype.createOscillator = function () {
      var osc = origCreate.apply(this, arguments);
      var lastFreq = null;
      try {
        var freqParam = osc.frequency;
        var origSetVal = freqParam.setValueAtTime;
        freqParam.setValueAtTime = function (value, time) {
          lastFreq = value;
          return origSetVal.call(this, value, time);
        };
      } catch (e) { /* leave detection disabled for this osc */ }
      var origStart = osc.start;
      osc.start = function () {
        if (PING_FREQS.indexOf(lastFreq) !== -1 && readSound()) {
          if (lastFreq === 880) playCustomSound();
          return; // suppress the procedural oscillator
        }
        return origStart.apply(this, arguments);
      };
      return osc;
    };
    Ctor.prototype.__cnsPatched = true;
    Ctor.prototype.__cnsOrigCreateOscillator = origCreate;
  }

  function unpatchAudioContext() {
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor || !Ctor.prototype.__cnsPatched) return;
    if (Ctor.prototype.__cnsOrigCreateOscillator) {
      Ctor.prototype.createOscillator = Ctor.prototype.__cnsOrigCreateOscillator;
    }
    delete Ctor.prototype.__cnsPatched;
    delete Ctor.prototype.__cnsOrigCreateOscillator;
  }

  function readFileAsDataUrl(file, cb) {
    var reader = new FileReader();
    reader.onload = function () { cb(null, reader.result); };
    reader.onerror = function () { cb(reader.error || new Error("read failed")); };
    reader.readAsDataURL(file);
  }

  function closePopover() {
    document.removeEventListener("mousedown", outsideClickHandler);
    if (popover) {
      popover.remove();
      popover = null;
    }
  }

  function outsideClickHandler(e) {
    if (!popover) return;
    if (popover.contains(e.target)) return;
    if (e.target.closest && e.target.closest(".cns-toggle")) return;
    closePopover();
  }

  function openPopover(anchor) {
    if (popover) {
      closePopover();
      return;
    }

    popover = document.createElement("div");
    popover.className = "cns-popover";
    popover.innerHTML =
      '<h3>Custom Notification Sound</h3>' +
      '<div class="cns-stack">' +
        '<span class="cns-label-text">Sound file</span>' +
        '<div class="cns-file-row">' +
          '<label class="cns-file-label">' +
            '<input type="file" accept="audio/*" data-cns-field="file">' +
            '<span>Upload audio…</span>' +
          '</label>' +
          '<button class="cns-action" data-cns-act="test" type="button">Test</button>' +
        '</div>' +
        '<p class="cns-current" data-cns-display="current"></p>' +
      '</div>' +
      '<label class="cns-volume">' +
        '<span class="cns-label-text">Volume: <span data-cns-display="volume"></span></span>' +
        '<input type="range" data-cns-field="volume" min="0" max="1" step="0.01">' +
      '</label>' +
      '<div class="cns-actions">' +
        '<button class="cns-action" data-cns-act="clear" type="button">Clear sound</button>' +
        '<button class="cns-action" data-cns-act="close" type="button">Close</button>' +
      '</div>';

    document.body.appendChild(popover);

    var rect = anchor.getBoundingClientRect();
    var top = Math.min(rect.bottom + 6, window.innerHeight - popover.offsetHeight - 8);
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8));
    popover.style.top = top + "px";
    popover.style.left = left + "px";

    var qs = function (sel) { return popover.querySelector(sel); };
    var fileEl = qs('[data-cns-field="file"]');
    var volumeEl = qs('[data-cns-field="volume"]');
    var volumeDisp = qs('[data-cns-display="volume"]');
    var currentDisp = qs('[data-cns-display="current"]');

    function refreshDisplays() {
      volumeDisp.textContent = parseFloat(volumeEl.value).toFixed(2);
      var name = readName();
      currentDisp.textContent = readSound()
        ? "Loaded: " + (name || "custom sound")
        : "No sound uploaded.";
    }

    volumeEl.value = readVolume();
    refreshDisplays();

    volumeEl.addEventListener("input", function () {
      localStorage.setItem(KEY_VOLUME, volumeEl.value);
      refreshDisplays();
    });
    fileEl.addEventListener("change", function () {
      var file = fileEl.files && fileEl.files[0];
      if (!file) return;
      readFileAsDataUrl(file, function (err, dataUrl) {
        if (err || typeof dataUrl !== "string") {
          currentDisp.textContent = "Could not read file.";
          return;
        }
        try {
          localStorage.setItem(KEY_SOUND, dataUrl);
          localStorage.setItem(KEY_NAME, file.name);
          fileEl.value = "";
          refreshDisplays();
        } catch (e) {
          currentDisp.textContent = "File too large for browser storage. Try a shorter clip.";
        }
      });
    });
    qs('[data-cns-act="test"]').addEventListener("click", function () {
      lastPlayed = 0;
      playCustomSound();
    });
    qs('[data-cns-act="clear"]').addEventListener("click", function () {
      localStorage.removeItem(KEY_SOUND);
      localStorage.removeItem(KEY_NAME);
      refreshDisplays();
    });
    qs('[data-cns-act="close"]').addEventListener("click", closePopover);

    setTimeout(function () {
      document.addEventListener("mousedown", outsideClickHandler);
    }, 0);
  }

  function tryInjectToggle() {
    if (document.getElementById(TOGGLE_ID)) return;
    var candidates = document.querySelectorAll("span.font-medium.truncate");
    for (var i = 0; i < candidates.length; i++) {
      var span = candidates[i];
      if (!span.textContent || span.textContent.trim() !== EXTENSION_NAME) continue;
      var card = span.closest('[class*="rounded-lg"]');
      if (!card) continue;
      var trash = card.querySelector('button[title="Remove extension"]');
      if (!trash) continue;
      var toggle = document.createElement("button");
      toggle.id = TOGGLE_ID;
      toggle.className = "cns-toggle";
      toggle.title = "Notification sound settings";
      toggle.innerHTML = BELL_ICON_SVG;
      toggle.addEventListener("click", function (e) {
        e.stopPropagation();
        openPopover(toggle);
      });
      card.insertBefore(toggle, trash);
      return;
    }
  }

  marinara.setInterval(tryInjectToggle, 500);
  tryInjectToggle();

  marinara.onCleanup(function () {
    closePopover();
    unpatchAudioContext();
  });

  patchAudioContext();
})();
