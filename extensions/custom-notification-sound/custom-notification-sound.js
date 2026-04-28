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
  // per ping. If the extension is disabled or no sound has been uploaded,
  // the patch falls through to the original implementation, so the default
  // ping plays unchanged.

  var KEY_ENABLED = "marinara-cns-enabled";
  var KEY_SOUND = "marinara-cns-sound";
  var KEY_NAME = "marinara-cns-name";
  var KEY_VOLUME = "marinara-cns-volume";

  var DEFAULT_VOLUME = 0.7;
  var PING_FREQS = [880, 1320];
  var DEDUPE_MS = 100;

  var lastPlayed = 0;
  var panel = null;
  var panelLoad = null;

  function readEnabled() {
    var v = localStorage.getItem(KEY_ENABLED);
    return v === null ? true : v === "true";
  }
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
        if (PING_FREQS.indexOf(lastFreq) !== -1 && readEnabled() && readSound()) {
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

  function buildPanel() {
    if (panel) return;
    panel = marinara.addElement("body", "div", { class: "cns-panel is-hidden" });
    if (!panel) return;
    panel.innerHTML =
      '<h3>Custom Notification Sound</h3>' +
      '<label class="cns-checkbox-row"><input type="checkbox" data-cns-field="enabled"> <span>Enabled</span></label>' +
      '<div class="cns-stack">' +
        '<span class="cns-label-text">Sound file</span>' +
        '<div class="cns-file-row">' +
          '<label class="cns-file-label">' +
            '<input type="file" accept="audio/*" data-cns-field="file">' +
            '<span>Upload audio…</span>' +
          '</label>' +
          '<button data-cns-action="test" type="button">Test</button>' +
        '</div>' +
        '<p class="cns-current" data-cns-display="current">No sound uploaded.</p>' +
      '</div>' +
      '<label><span class="cns-label-text">Volume: <span data-cns-display="volume"></span></span>' +
      '<input type="range" data-cns-field="volume" min="0" max="1" step="0.01"></label>' +
      '<div class="cns-row">' +
        '<button data-cns-action="clear" type="button">Clear sound</button>' +
        '<button data-cns-action="close" type="button">Close</button>' +
      '</div>' +
      '<p class="cns-help">Press Ctrl+Shift+M anytime to reopen this panel. ' +
        'Files are stored in your browser; keep them under ~1 MB.</p>';

    var qs = function (sel) { return panel.querySelector(sel); };
    var enabledEl = qs('[data-cns-field="enabled"]');
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
    panelLoad = function () {
      enabledEl.checked = readEnabled();
      volumeEl.value = readVolume();
      refreshDisplays();
    };

    marinara.on(enabledEl, "change", function () {
      localStorage.setItem(KEY_ENABLED, enabledEl.checked ? "true" : "false");
    });
    marinara.on(volumeEl, "input", function () {
      localStorage.setItem(KEY_VOLUME, volumeEl.value);
      refreshDisplays();
    });
    marinara.on(fileEl, "change", function () {
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
    marinara.on(qs('[data-cns-action="test"]'), "click", function () {
      lastPlayed = 0;
      playCustomSound();
    });
    marinara.on(qs('[data-cns-action="clear"]'), "click", function () {
      localStorage.removeItem(KEY_SOUND);
      localStorage.removeItem(KEY_NAME);
      refreshDisplays();
    });
    marinara.on(qs('[data-cns-action="close"]'), "click", hidePanel);
  }

  function showPanel() {
    if (!panel) buildPanel();
    if (!panel || !panelLoad) return;
    panelLoad();
    panel.classList.remove("is-hidden");
  }
  function hidePanel() { if (panel) panel.classList.add("is-hidden"); }
  function togglePanel() {
    if (!panel || panel.classList.contains("is-hidden")) showPanel();
    else hidePanel();
  }

  function onKeydown(e) {
    if (e.key === "Escape" && panel && !panel.classList.contains("is-hidden")) {
      hidePanel();
      return;
    }
    var key = e.key && e.key.toLowerCase();
    if (key === "m" && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      togglePanel();
    }
  }

  function checkHashTrigger() {
    // Mobile-friendly opener: typing #cns into the address bar opens the
    // panel. Clear the hash afterwards so the same hash can re-trigger on
    // subsequent edits (hashchange only fires when the value changes).
    if (location.hash === "#cns") {
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch (e) { /* fall through, the trigger still works */ }
      showPanel();
    }
  }

  marinara.on(window, "keydown", onKeydown);
  marinara.on(window, "hashchange", checkHashTrigger);
  marinara.onCleanup(function () {
    unpatchAudioContext();
    if (panel) panel.classList.add("is-hidden");
  });

  patchAudioContext();
  checkHashTrigger();
})();
