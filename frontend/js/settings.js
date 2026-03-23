(function() {
  var ws;
  var statusEl = document.getElementById("status-pill");
  var voiceBtn = document.getElementById("voice-button");
  var volumeSlider = document.getElementById("volume-slider");
  var speedSlider = document.getElementById("speed-slider");
  var pitchSlider = document.getElementById("pitch-slider");
  var volumeDisplay = document.getElementById("volume-display");
  var speedDisplay = document.getElementById("speed-display");
  var pitchDisplay = document.getElementById("pitch-display");
  var resetBtn = document.getElementById("voice-reset-button");
  var headTrackingToggle = document.getElementById("head-tracking-toggle");
  var restartBtn = document.getElementById("restart-button");
  var rebootBtn = document.getElementById("reboot-button");
  var modeManualRadio = document.getElementById("radio-manual");
  var modeRealtimeRadio = document.getElementById("radio-realtime");
  var modeManualOption = document.getElementById("mode-manual");
  var modeRealtimeOption = document.getElementById("mode-realtime");

  var audioActive = false;
  var pressing = false;
  var reconnectDelay = 3000;
  var currentMode = localStorage.getItem("voiceMode") || "manual";

  var volumeDebounce;
  var speedDebounce;
  var pitchDebounce;
  var volumeCommandSeq = 0;
  var pendingVolumePreview = null;
  var pendingVolumeRequestId = null;
  var speedCommandSeq = 0;
  var pitchCommandSeq = 0;
  var pendingSpeedPercent = null;
  var pendingSpeedRequestId = null;
  var pendingPitchMultiplier = null;
  var pendingPitchRequestId = null;
  var pendingHeadTrackingState = null;

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function formatPercent(value) {
    return clamp(Math.round(value), 0, 999) + "%";
  }

  function formatMultiplier(value) {
    var text = value.toFixed(2).replace(/\.?0+$/, "");
    return text + "\u00D7";
  }

  function formatMultiplierText(value) {
    return value.toFixed(2).replace(/\.?0+$/, "");
  }

  function announce(text) {
    if (!text) {
      return;
    }
    if (window.PepperUtils && PepperUtils.announce) {
      PepperUtils.announce(text);
      return;
    }
    sendCommand("speak", { text: text });
  }

  function setControlsEnabled(enabled) {
    var inputs = [volumeSlider, speedSlider, pitchSlider];
    for (var i = 0; i < inputs.length; i++) {
      if (!inputs[i]) continue;
      inputs[i].disabled = !enabled;
      inputs[i].classList.toggle("disabled", !enabled);
    }
    if (resetBtn) {
      resetBtn.disabled = !enabled;
      resetBtn.classList.toggle("disabled", !enabled);
    }
    if (headTrackingToggle) {
      headTrackingToggle.disabled = !enabled;
    }
  }

  function renderVolume(percent, updateSlider) {
    var clamped = clamp(percent, 0, 100);
    if (volumeDisplay) {
      volumeDisplay.textContent = formatPercent(clamped);
    }
    if (updateSlider && volumeSlider) {
      volumeSlider.value = clamped;
    }
  }

  function renderSpeed(percent, updateSlider) {
    var clamped = clamp(percent, 50, 200);
    if (speedDisplay) {
      speedDisplay.textContent = formatPercent(clamped);
    }
    if (updateSlider && speedSlider) {
      speedSlider.value = clamped;
    }
  }

  function renderPitch(percent, updateSlider) {
    var clamped = clamp(percent, 50, 400);
    var multiplier = clamped / 100;
    if (pitchDisplay) {
      pitchDisplay.textContent = formatMultiplier(multiplier);
    }
    if (updateSlider && pitchSlider) {
      pitchSlider.value = clamped;
    }
  }

  function setStatus(text, emoji) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = (emoji || "") + " " + text;
  }

  function setVoiceState(state) {
    audioActive = state;
    if (voiceBtn) {
      voiceBtn.classList.toggle("active", state);
    }
  }

  function setVoiceEnabled(enabled) {
    if (!voiceBtn) {
      return;
    }
    voiceBtn.classList.toggle("disabled", !enabled);
    if (!enabled) {
      pressing = false;
      voiceBtn.classList.remove("active");
    }
  }

  function sendCommand(command, data) {
    if (!ws || ws.readyState !== 1) {
      return;
    }
    var payload = data || {};
    payload.command = command;
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.log("sendCommand error:", err);
    }
  }

  function applyVoiceState(payload) {
    var volumePercent = null;
    if (typeof payload.output_volume_percent !== "undefined") {
      volumePercent = payload.output_volume_percent;
    } else if (typeof payload.volume_percent !== "undefined") {
      volumePercent = payload.volume_percent;
    }
    if (volumePercent === null && typeof payload.volume !== "undefined") {
      volumePercent = Math.round(payload.volume * 100);
    }
    if (volumePercent !== null) {
      renderVolume(volumePercent, true);
    }

    if (typeof payload.speed_percent !== "undefined") {
      renderSpeed(payload.speed_percent, true);
    } else if (typeof payload.speed !== "undefined") {
      renderSpeed(payload.speed, true);
    }

    if (typeof payload.pitch_percent !== "undefined") {
      renderPitch(payload.pitch_percent, true);
    } else if (typeof payload.pitch !== "undefined") {
      renderPitch(Math.round(payload.pitch * 100), true);
    } else if (typeof payload.pitch_multiplier !== "undefined") {
      renderPitch(Math.round(payload.pitch_multiplier * 100), true);
    }
  }

  function handleAck(payload) {
    if (typeof payload.audio_enabled !== "undefined") {
      setVoiceState(!!payload.audio_enabled);
    }

    var cmd = payload.command || "";
    var lowerCmd = cmd.toLowerCase();

    if (!payload.ok) {
      if (lowerCmd === "set_volume" || lowerCmd === "get_volume" || lowerCmd === "volume") {
        setStatus("Volume update failed: " + (payload.error || "unknown error"), "[!!]");
        if (payload.request_id !== undefined && payload.request_id === pendingVolumeRequestId) {
          pendingVolumePreview = null;
          pendingVolumeRequestId = null;
        }
        return;
      }
      if (lowerCmd === "set_speed" || lowerCmd === "get_speed" || lowerCmd === "speed") {
        setStatus("Speed update failed: " + (payload.error || "unknown error"), "[!!]");
        if (payload.request_id !== undefined && payload.request_id === pendingSpeedRequestId) {
          pendingSpeedPercent = null;
          pendingSpeedRequestId = null;
        }
        return;
      }
      if (lowerCmd === "set_pitch" || lowerCmd === "get_pitch" || lowerCmd === "pitch") {
        setStatus("Pitch update failed: " + (payload.error || "unknown error"), "[!!]");
        if (payload.request_id !== undefined && payload.request_id === pendingPitchRequestId) {
          pendingPitchMultiplier = null;
          pendingPitchRequestId = null;
        }
        return;
      }
      if (lowerCmd === "start_head_tracking" || lowerCmd === "stop_head_tracking") {
        setStatus("Head tracking failed: " + (payload.error || "unknown error"), "[!!]");
        if (pendingHeadTrackingState !== null && headTrackingToggle) {
          headTrackingToggle.checked = !pendingHeadTrackingState;
        }
        pendingHeadTrackingState = null;
        return;
      }
    }

    if (payload.ok) {
      if (!cmd || cmd === "start_audio" || cmd === "stop_audio") {
        return;
      }

      if (lowerCmd === "set_volume" || lowerCmd === "get_volume" || lowerCmd === "volume") {
        applyVoiceState(payload);
        var volumePercent = null;
        if (typeof payload.output_volume_percent !== "undefined") {
          volumePercent = payload.output_volume_percent;
        } else if (typeof payload.volume_percent !== "undefined") {
          volumePercent = payload.volume_percent;
        } else if (typeof payload.volume !== "undefined") {
          volumePercent = Math.round((payload.volume || 0) * 100);
        }
        var volumeLabel = volumePercent !== null ? volumePercent + "%" : "updated";
        setStatus("Volume set to " + volumeLabel, "[OK]");
        if (payload.request_id !== undefined && payload.request_id === pendingVolumeRequestId) {
          if (pendingVolumePreview !== null) {
            announce("Volume set to " + pendingVolumePreview + " percent.");
          }
          pendingVolumePreview = null;
          pendingVolumeRequestId = null;
        }
        return;
      }

      if (lowerCmd === "set_speed" || lowerCmd === "get_speed" || lowerCmd === "speed") {
        applyVoiceState(payload);
        var speedPercent = payload.speed_percent || payload.speed || 0;
        setStatus("Speed set to " + speedPercent + "%", "[OK]");
        if (payload.request_id !== undefined && payload.request_id === pendingSpeedRequestId) {
          if (pendingSpeedPercent !== null) {
            announce("Speech speed set to " + pendingSpeedPercent + " percent.");
          }
          pendingSpeedPercent = null;
          pendingSpeedRequestId = null;
        }
        return;
      }

      if (lowerCmd === "set_pitch" || lowerCmd === "get_pitch" || lowerCmd === "pitch") {
        applyVoiceState(payload);
        var pitchText = pitchDisplay ? pitchDisplay.textContent :
          formatMultiplier(payload.pitch_multiplier || payload.pitch || 1);
        setStatus("Pitch set to " + pitchText, "[OK]");
        if (payload.request_id !== undefined && payload.request_id === pendingPitchRequestId) {
          if (pendingPitchMultiplier !== null) {
            announce("Pitch set to " + formatMultiplierText(pendingPitchMultiplier) + " times.");
          }
          pendingPitchMultiplier = null;
          pendingPitchRequestId = null;
        }
        return;
      }

      if (lowerCmd === "start_head_tracking") {
        if (headTrackingToggle && !headTrackingToggle.checked) {
          headTrackingToggle.checked = true;
        }
        setStatus("Head tracking enabled", "[OK]");
        if (pendingHeadTrackingState === true) {
          announce("Head tracking enabled.");
        }
        pendingHeadTrackingState = null;
        return;
      }

      if (lowerCmd === "stop_head_tracking") {
        if (headTrackingToggle && headTrackingToggle.checked) {
          headTrackingToggle.checked = false;
        }
        setStatus("Head tracking disabled", "[OK]");
        if (pendingHeadTrackingState === false) {
          announce("Head tracking disabled.");
        }
        pendingHeadTrackingState = null;
        return;
      }
    }
  }

  function handleStateChange(payload) {
    var cmd = payload.command || "";
    console.log("State change broadcast:", cmd);

    // Handle head tracking state changes from other clients
    if (cmd === "start_head_tracking") {
      if (headTrackingToggle && !headTrackingToggle.checked) {
        headTrackingToggle.checked = true;
      }
      return;
    }

    if (cmd === "stop_head_tracking") {
      if (headTrackingToggle && headTrackingToggle.checked) {
        headTrackingToggle.checked = false;
      }
      return;
    }
  }

  function wsUrl() {
    var host = window.location.hostname || "198.18.0.1";
    return "ws://" + host + ":9001";
  }

  function connect() {
    try {
      ws = new WebSocket(wsUrl());
    } catch (err) {
      console.log("WebSocket init error:", err);
      retry();
      return;
    }

    ws.onopen = function() {
      setStatus("Connected to Pepper", "[OK]");
      setVoiceEnabled(true);
      setControlsEnabled(true);
      if (window.PepperUtils && PepperUtils.init) {
        PepperUtils.init(ws);
      }
      requestVoiceSnapshot();
    };

    ws.onclose = function() {
      setStatus("Connection closed", "[!!]");
      setVoiceEnabled(false);
      setControlsEnabled(false);
      pendingVolumePreview = null;
      pendingVolumeRequestId = null;
      pendingSpeedPercent = null;
      pendingSpeedRequestId = null;
      pendingPitchMultiplier = null;
      pendingPitchRequestId = null;
      pendingHeadTrackingState = null;
      retry();
    };

    ws.onerror = function(e) {
      console.log("WebSocket error:", e);
      setStatus("Connection error", "[!!]");
      setVoiceEnabled(false);
      setControlsEnabled(false);
      pendingVolumePreview = null;
      pendingVolumeRequestId = null;
      pendingSpeedPercent = null;
      pendingSpeedRequestId = null;
      pendingPitchMultiplier = null;
      pendingPitchRequestId = null;
      pendingHeadTrackingState = null;
    };

    ws.onmessage = function(evt) {
      if (!evt.data) {
        return;
      }
      var payload;
      try {
        payload = JSON.parse(evt.data);
      } catch (err) {
        return;
      }
      if (!payload) {
        return;
      }
      if (payload.type === "ack") {
        handleAck(payload);
        return;
      }
      if (payload.type === "state_change") {
        handleStateChange(payload);
        return;
      }
      if (typeof payload.audio_enabled !== "undefined") {
        setVoiceState(!!payload.audio_enabled);
      }
      if (payload.type === "voice_state") {
        applyVoiceState(payload);
      }
    };
  }

  function retry() {
    setTimeout(connect, reconnectDelay);
  }

  function requestVoiceSnapshot() {
    sendCommand("get_volume");
    sendCommand("get_speed");
    sendCommand("get_pitch");
  }

  function send(eventName) {
    if (!ws || ws.readyState !== 1) {
      return;
    }
    try {
      ws.send(eventName);
    } catch (err) {
      console.log("send error:", err);
    }
  }

  function startHold() {
    if (pressing) return;
    pressing = true;
    if (voiceBtn) {
      voiceBtn.classList.add("active");
    }
    send("start_audio");
  }

  function endHold() {
    if (!pressing) return;
    pressing = false;
    if (voiceBtn) {
      voiceBtn.classList.remove("active");
    }
    send("stop_audio");
    setTimeout(function() {
      if (!pressing && !audioActive && voiceBtn) {
        voiceBtn.classList.remove("active");
      }
    }, 200);
  }

  function scheduleVolumeUpdate(percent, immediate) {
    if (!ws || ws.readyState !== 1) {
      return;
    }
    if (volumeDebounce) {
      clearTimeout(volumeDebounce);
      volumeDebounce = null;
    }
    var clamped = clamp(Math.round(percent), 0, 100);
    var requestId = ++volumeCommandSeq;
    var payload = { volume_percent: clamped, request_id: requestId };
    pendingVolumePreview = clamped;
    pendingVolumeRequestId = requestId;
    if (immediate) {
      sendCommand("set_volume", payload);
      return;
    }
    volumeDebounce = setTimeout(function() {
      volumeDebounce = null;
      sendCommand("set_volume", payload);
    }, 120);
  }

  function scheduleSpeedUpdate(percent, immediate) {
    if (!ws || ws.readyState !== 1) {
      return;
    }
    if (speedDebounce) {
      clearTimeout(speedDebounce);
      speedDebounce = null;
    }
    var clamped = clamp(Math.round(percent), 50, 200);
    var requestId = ++speedCommandSeq;
    var payload = { speed: clamped, request_id: requestId };
    pendingSpeedPercent = clamped;
    pendingSpeedRequestId = requestId;
    if (immediate) {
      sendCommand("set_speed", payload);
      return;
    }
    speedDebounce = setTimeout(function() {
      speedDebounce = null;
      sendCommand("set_speed", payload);
    }, 120);
  }

  function schedulePitchUpdate(percent, immediate) {
    if (!ws || ws.readyState !== 1) {
      return;
    }
    if (pitchDebounce) {
      clearTimeout(pitchDebounce);
      pitchDebounce = null;
    }
    var clampedPercent = clamp(percent, 50, 400);
    var multiplier = clampedPercent / 100;
    var requestId = ++pitchCommandSeq;
    var payload = { pitch: multiplier, request_id: requestId };
    pendingPitchMultiplier = multiplier;
    pendingPitchRequestId = requestId;
    if (immediate) {
      sendCommand("set_pitch", payload);
      return;
    }
    pitchDebounce = setTimeout(function() {
      pitchDebounce = null;
      sendCommand("set_pitch", payload);
    }, 120);
  }

  if (voiceBtn) {
    voiceBtn.addEventListener("mousedown", function() {
      if (voiceBtn.classList.contains("disabled")) return;
      startHold();
    });
    voiceBtn.addEventListener("mouseup", function() {
      endHold();
    });
    voiceBtn.addEventListener("mouseleave", function() {
      endHold();
    });
    voiceBtn.addEventListener("touchstart", function(e) {
      if (voiceBtn.classList.contains("disabled")) return;
      e.preventDefault();
      startHold();
    }, { passive: false });
    voiceBtn.addEventListener("touchend", function(e) {
      e.preventDefault();
      endHold();
    }, { passive: false });
    voiceBtn.addEventListener("touchcancel", function() {
      endHold();
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener("input", function(e) {
      var percent = parseInt(e.target.value, 10);
      renderVolume(percent, false);
      scheduleVolumeUpdate(percent, false);
    });
    volumeSlider.addEventListener("change", function(e) {
      var percent = parseInt(e.target.value, 10);
      renderVolume(percent, false);
      scheduleVolumeUpdate(percent, true);
    });
  }

  if (speedSlider) {
    speedSlider.addEventListener("input", function(e) {
      var percent = parseInt(e.target.value, 10);
      renderSpeed(percent, false);
      scheduleSpeedUpdate(percent, false);
    });
    speedSlider.addEventListener("change", function(e) {
      var percent = parseInt(e.target.value, 10);
      renderSpeed(percent, false);
      scheduleSpeedUpdate(percent, true);
    });
  }

  if (pitchSlider) {
    pitchSlider.addEventListener("input", function(e) {
      var percent = parseInt(e.target.value, 10);
      renderPitch(percent, false);
      schedulePitchUpdate(percent, false);
    });
    pitchSlider.addEventListener("change", function(e) {
      var percent = parseInt(e.target.value, 10);
      renderPitch(percent, false);
      schedulePitchUpdate(percent, true);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function() {
      if (resetBtn.disabled) return;
      var defaults = { volume: 70, speed: 100, pitch: 100 };
      renderVolume(defaults.volume, true);
      renderSpeed(defaults.speed, true);
      renderPitch(defaults.pitch, true);
      scheduleVolumeUpdate(defaults.volume, true);
      scheduleSpeedUpdate(defaults.speed, true);
      schedulePitchUpdate(defaults.pitch, true);
      setStatus("Resetting voice to defaults...", "[--]");
    });
  }

  if (headTrackingToggle) {
    headTrackingToggle.addEventListener("change", function() {
      if (headTrackingToggle.disabled) return;
      var enabled = this.checked;
      var command = enabled ? "start_head_tracking" : "stop_head_tracking";
      pendingHeadTrackingState = enabled;
      sendCommand(command);
      setStatus(enabled ? "Enabling head tracking..." : "Disabling head tracking...", "[>>]");
    });
  }

  if (restartBtn) {
    restartBtn.addEventListener("click", function() {
      if (restartBtn.disabled) return;
      if (!confirm("Are you sure you want to restart the main application? Pepper will be unavailable for about 10-15 seconds.")) {
        return;
      }
      restartBtn.disabled = true;
      restartBtn.textContent = "Restarting...";
      sendCommand("restart_main");
      setStatus("Restarting application...", "[>>]");
      // Page will reload automatically when connection is restored
      setTimeout(function() {
        setStatus("Waiting for reconnection...", "[--]");
      }, 2000);
    });
  }

  var restBtn = document.getElementById("rest-button");
  var isInRestMode = false;

  if (restBtn) {
    restBtn.addEventListener("click", function() {
      if (restBtn.disabled) return;

      if (!isInRestMode) {
        // Entering rest mode
        if (!confirm("Are you sure you want to put Pepper into REST MODE?\n\nThis will:\n- Relax all motors\n- Put Pepper in a resting position\n- Reduce power consumption\n\nPepper will remain powered on but motors will be relaxed to conserve energy.\n\nContinue?")) {
          return;
        }
        restBtn.disabled = true;
        restBtn.textContent = "Entering Rest Mode...";
        send(JSON.stringify({
          command: "go_to_posture",
          posture: "rest"
        }));
        setStatus("Entering rest mode...", "[>>]");
        setTimeout(function() {
          restBtn.disabled = false;
          restBtn.textContent = "Wake Up (Stand)";
          isInRestMode = true;
          setStatus("Rest mode activated", "[OK]");
        }, 3000);
      } else {
        // Waking up to stand mode
        if (!confirm("Wake up Pepper and return to STAND position?\n\nThis will:\n- Activate all motors\n- Move to standing position\n\nContinue?")) {
          return;
        }
        restBtn.disabled = true;
        restBtn.textContent = "Waking Up...";
        send(JSON.stringify({
          command: "go_to_posture",
          posture: "stand"
        }));
        setStatus("Waking up...", "[>>]");
        setTimeout(function() {
          restBtn.disabled = false;
          restBtn.textContent = "Enter Rest Mode";
          isInRestMode = false;
          setStatus("Standing ready", "[OK]");
        }, 5000);
      }
    });
  }

  if (rebootBtn) {
    rebootBtn.addEventListener("click", function() {
      if (rebootBtn.disabled) return;
      if (!confirm("Are you sure you want to REBOOT Pepper? The entire robot will restart and be unavailable for about 60-90 seconds.\n\nThis will:\n- Shut down all systems\n- Restart the operating system\n- Restart all services\n\nContinue with reboot?")) {
        return;
      }
      rebootBtn.disabled = true;
      rebootBtn.textContent = "Rebooting...";
      sendCommand("reboot_robot");
      setStatus("Rebooting Pepper...", "[>>]");
      // Page will try to reconnect after reboot
      setTimeout(function() {
        setStatus("Robot rebooting, please wait...", "[--]");
      }, 3000);
    });
  }

  // Mode selection handlers
  function setVoiceMode(mode) {
    currentMode = mode;
    localStorage.setItem("voiceMode", mode);
    console.log("Voice mode changed to:", mode);
    setStatus("Voice mode set to " + (mode === "manual" ? "Tap to Talk" : "Realtime Mode"), "[OK]");
  }

  if (modeManualOption) {
    modeManualOption.addEventListener("click", function() {
      if (modeManualRadio && !modeManualRadio.checked) {
        modeManualRadio.checked = true;
        setVoiceMode("manual");
      }
    });
  }

  if (modeRealtimeOption) {
    modeRealtimeOption.addEventListener("click", function() {
      if (modeRealtimeRadio && !modeRealtimeRadio.checked) {
        modeRealtimeRadio.checked = true;
        setVoiceMode("realtime");
      }
    });
  }

  if (modeManualRadio) {
    modeManualRadio.addEventListener("change", function() {
      if (this.checked) {
        setVoiceMode("manual");
      }
    });
  }

  if (modeRealtimeRadio) {
    modeRealtimeRadio.addEventListener("change", function() {
      if (this.checked) {
        setVoiceMode("realtime");
      }
    });
  }

  // Load saved mode on page load
  if (currentMode === "realtime" && modeRealtimeRadio) {
    modeRealtimeRadio.checked = true;
  } else if (modeManualRadio) {
    modeManualRadio.checked = true;
  }

  setControlsEnabled(false);
  if (volumeSlider) {
    renderVolume(parseInt(volumeSlider.value, 10) || 0, true);
  }
  if (speedSlider) {
    renderSpeed(parseInt(speedSlider.value, 10) || 100, true);
  }
  if (pitchSlider) {
    renderPitch(parseInt(pitchSlider.value, 10) || 100, true);
  }
  setVoiceEnabled(false);
  setStatus("Connecting...", "[--]");
  connect();
})();
