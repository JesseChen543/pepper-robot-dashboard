(function() {
  var ws;
  var statusEl = document.getElementById("status-pill");
  var voiceBtn = document.getElementById("voice-button");
  var takePictureBtn = document.getElementById("take-picture-btn");
  var staticHeadBtn = document.getElementById("static-head-btn");
  var cameraCanvas = document.getElementById("camera-canvas");
  var cameraStatus = document.getElementById("camera-status");
  var statusMessage = document.getElementById("status-message");
  var cameraCountdown = document.getElementById("camera-countdown");
  var audioActive = false;
  var pressing = false;
  var reconnectDelay = 3000;
  var cameraEnabled = false;
  var streamActive = false;
  var streamInterval = null;
  var canvasContext = null;
  var headTrackingWasEnabled = false;
  var headTrackingStatusChecked = false;
  var staticHeadEnabled = false;
  var staticHeadWasEnabled = false;
  var staticHeadStatusChecked = false;
  var staticHeadBusy = false;
  var pendingHeadTrackingEnable = false;
  var defaultTakePictureLabel = "📷";
  var CAMERA_CLIENT_VERSION = "countdown-v2";
  var COUNTDOWN_SECONDS = 5;
  var countdownTimer = null;
  var countdownRemaining = 0;
  var countdownActive = false;
  var countdownDeadline = 0;
  var countdownStartedAt = 0;
  var countdownTargetTime = 0;
  var clientVersionAnnounced = false;

  if (cameraCanvas) {
    canvasContext = cameraCanvas.getContext("2d");
  }

  if (takePictureBtn) {
    takePictureBtn.textContent = defaultTakePictureLabel;
  }

  function setStatus(text, emoji) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = (emoji || "") + " " + text;
  }

  function setCameraStatus(text, active) {
    if (!cameraStatus) {
      return;
    }
    cameraStatus.textContent = text;
    if (active) {
      cameraStatus.classList.add("active");
    } else {
      cameraStatus.classList.remove("active");
    }
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

  function setCameraEnabled(enabled) {
    cameraEnabled = enabled;
    if (takePictureBtn) {
      takePictureBtn.disabled = !enabled;
      if (enabled && !countdownActive && !countdownTimer) {
        resetTakePictureLabel();
      }
    }
    if (!enabled && !countdownActive) {
      hideCountdownOverlay();
    }
    refreshStaticHeadButton();
  }

  function showStatusMessage(message, type) {
    if (!statusMessage) {
      return;
    }
    statusMessage.textContent = message;
    statusMessage.className = "status-message show " + type;
    setTimeout(function() {
      statusMessage.className = "status-message";
    }, 5000);
  }

  function refreshStaticHeadButton() {
    if (!staticHeadBtn) {
      return;
    }
    var emoji = staticHeadEnabled ? "🔓" : "🔒";
    var label = staticHeadEnabled ? "Disable Static Head" : "Enable Static Head";
    staticHeadBtn.textContent = emoji + " " + label;
    staticHeadBtn.classList.toggle("active", staticHeadEnabled);
    staticHeadBtn.disabled = staticHeadBusy || !cameraEnabled;
  }

  function resetTakePictureLabel() {
    if (!takePictureBtn) {
      return;
    }
    takePictureBtn.textContent = defaultTakePictureLabel;
  }

  function showCountdownOverlay(value) {
    if (!cameraCountdown) {
      return;
    }
    cameraCountdown.textContent = value;
    cameraCountdown.classList.add("show");
  }

  function hideCountdownOverlay() {
    if (!cameraCountdown) {
      return;
    }
    cameraCountdown.textContent = "";
    cameraCountdown.classList.remove("show");
  }

  function updateCountdownDisplay() {
    showCountdownOverlay(countdownRemaining);
    setStatus("Taking picture in " + countdownRemaining + "s...", "[>>]");
    setCameraStatus("Countdown: " + countdownRemaining, true);
  }

  function notifyCountdownEvent(phase, remaining, extra) {
    if (!phase) {
      phase = "unknown";
    }
    var payload = {
      command: "camera_countdown_event",
      phase: phase,
      remaining: typeof remaining === "number" ? remaining : null,
      timestamp: Date.now(),
      duration: COUNTDOWN_SECONDS
    };
    if (extra && typeof extra === "object") {
      for (var key in extra) {
        if (!Object.prototype.hasOwnProperty.call(extra, key)) continue;
        payload[key] = extra[key];
      }
    }
    sendJson(payload);
  }

  function announceClientVersion() {
    if (clientVersionAnnounced) {
      return;
    }
    clientVersionAnnounced = true;
    sendJson({
      command: "camera_client_version",
      version: CAMERA_CLIENT_VERSION,
      timestamp: Date.now()
    });
  }

  function scheduleCountdownTick() {
    if (!countdownActive) {
      return;
    }
    if (countdownTimer) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
    }
    var remainingMs = countdownDeadline - Date.now();
    if (remainingMs <= 0) {
      if (countdownRemaining !== 0) {
        countdownRemaining = 0;
        updateCountdownDisplay();
      }
      console.log("Countdown tick: 0");
      notifyCountdownEvent("tick", 0, {
        target: countdownTargetTime ? countdownTargetTime / 1000 : null
      });
      completeCountdown();
      return;
    }

    var nextRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
    if (nextRemaining !== countdownRemaining) {
      countdownRemaining = nextRemaining;
      console.log("Countdown tick:", countdownRemaining);
      updateCountdownDisplay();
      notifyCountdownEvent("tick", countdownRemaining, {
        target: countdownTargetTime ? countdownTargetTime / 1000 : null
      });
    }

    countdownTimer = setTimeout(scheduleCountdownTick, Math.min(Math.max(remainingMs, 100), 250));
  }

  function startCaptureCountdown() {
    if (!cameraEnabled || countdownActive || countdownTimer) {
      return;
    }
    console.log("Capture countdown started for", COUNTDOWN_SECONDS, "seconds");
    countdownActive = true;
    countdownRemaining = COUNTDOWN_SECONDS;
    countdownStartedAt = Date.now();
    countdownDeadline = countdownStartedAt + COUNTDOWN_SECONDS * 1000;
    countdownTargetTime = countdownDeadline;
    setCameraEnabled(false);
    updateCountdownDisplay();
    notifyCountdownEvent("start", countdownRemaining, {
      target: countdownTargetTime ? countdownTargetTime / 1000 : null
    });

    scheduleCountdownTick();
  }

  function completeCountdown() {
    console.log("Countdown complete, triggering photo capture");
    if (countdownTimer) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
    }
    var scheduledTarget = countdownTargetTime;
    countdownActive = false;
    countdownDeadline = 0;
    countdownStartedAt = 0;
    countdownTargetTime = 0;
    countdownRemaining = 0;
    hideCountdownOverlay();
    notifyCountdownEvent("complete", countdownRemaining, {
      target: scheduledTarget ? scheduledTarget / 1000 : null
    });
    sendCaptureRequest(scheduledTarget);
  }

  function abortCountdown() {
    if (countdownTimer) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
    }
    if (countdownActive || countdownRemaining > 0) {
      console.log("Countdown aborted");
      notifyCountdownEvent("abort", countdownRemaining, {
        target: countdownTargetTime ? countdownTargetTime / 1000 : null
      });
    }
    countdownActive = false;
    countdownRemaining = 0;
    countdownDeadline = 0;
    countdownStartedAt = 0;
    countdownTargetTime = 0;
    hideCountdownOverlay();
    resetTakePictureLabel();
  }

  function startCameraStream() {
    if (streamActive) {
      return;
    }
    streamActive = true;
    setCameraStatus("Live", true);
    requestFrame();

    streamInterval = setInterval(function() {
      if (streamActive) {
        requestFrame();
      }
    }, 200);
  }

  function stopCameraStream() {
    streamActive = false;
    if (streamInterval) {
      clearInterval(streamInterval);
      streamInterval = null;
    }
    setCameraStatus("Stopped", false);
  }

  function requestFrame() {
    if (!ws || ws.readyState !== 1) {
      return;
    }
    send("get_camera_frame");
  }

  function displayFrame(base64Data) {
    if (!canvasContext || !cameraCanvas) {
      return;
    }

    var img = new Image();
    img.onload = function() {
      canvasContext.drawImage(img, 0, 0, cameraCanvas.width, cameraCanvas.height);
    };
    img.src = "data:image/jpeg;base64," + base64Data;
  }

  function handleAck(payload) {
    if (typeof payload.audio_enabled !== "undefined") {
      setVoiceState(!!payload.audio_enabled);
    }

    var cmd = payload.command || "";

    if (cmd === "camera_countdown_event" || cmd === "camera_client_version") {
      return;
    }

    if (payload.ok) {
      if (!cmd || cmd === "start_audio" || cmd === "stop_audio") {
        return;
      }

      if (cmd === "get_camera_frame") {
        if (payload.frame) {
          displayFrame(payload.frame);
        }
        return;
      }

      if (cmd === "get_head_tracking_status") {
        console.log("Head tracking status:", payload);
        headTrackingWasEnabled = !!payload.head_tracking_enabled;
        headTrackingStatusChecked = true;

        if (!headTrackingWasEnabled) {
          if (staticHeadStatusChecked) {
            if (!staticHeadEnabled) {
              console.log("Head tracking was disabled, enabling it for camera page");
              send("start_head_tracking");
            } else {
              console.log("Static head active; skipping head tracking enable");
            }
          } else {
            pendingHeadTrackingEnable = true;
          }
        } else {
          console.log("Head tracking was already enabled");
        }
        return;
      }

      if (cmd === "get_static_head_status") {
        staticHeadEnabled = !!payload.static_head_enabled;
        if (!staticHeadStatusChecked) {
          staticHeadWasEnabled = staticHeadEnabled;
        }
        staticHeadStatusChecked = true;
        staticHeadBusy = false;
        if (pendingHeadTrackingEnable) {
          if (!staticHeadEnabled) {
            console.log("Head tracking auto-enable pending; enabling now");
            send("start_head_tracking");
          } else {
            console.log("Static head active; pending head tracking enable cancelled");
          }
          pendingHeadTrackingEnable = false;
        }
        refreshStaticHeadButton();
        updateHeadControlButtons();
        return;
      }

      if (cmd === "enable_static_head" || cmd === "disable_static_head") {
        staticHeadEnabled = !!payload.static_head_enabled;
        staticHeadBusy = false;
        refreshStaticHeadButton();
        updateHeadControlButtons();
        return;
      }

      if (cmd === "start_head_tracking") {
        console.log("Head tracking enabled for camera page");
        return;
      }

      if (cmd === "stop_head_tracking") {
        console.log("Head tracking disabled");
        return;
      }

      if (cmd === "capture_photo") {
        console.log("Photo captured successfully:", payload);
        showStatusMessage("Photo saved to gallery!", "success");
        if (streamActive) {
          setCameraStatus("Live", true);
        }
        setCameraEnabled(true);
      }
    } else {
      if (cmd === "get_camera_frame") {
        return;
      }

      if (cmd === "capture_photo") {
        var errorMsg = payload.error || "Failed to take picture";
        console.error("Photo capture failed:", errorMsg);
        showStatusMessage("Error: " + errorMsg, "error");
        if (streamActive) {
          setCameraStatus("Live", true);
        }
        setCameraEnabled(true);
        return;
      }

      if (cmd === "enable_static_head" || cmd === "disable_static_head") {
        staticHeadBusy = false;
        refreshStaticHeadButton();
        var err = payload.error || "Failed to update static head mode";
        showStatusMessage("Error: " + err, "error");
        return;
      }
    }
  }

  function handleStateChange(payload) {
    var cmd = payload.command || "";
    console.log("State change broadcast:", cmd);

    // Handle static head state changes from other clients
    if (cmd === "enable_static_head" || cmd === "disable_static_head") {
      var enabled = !!payload.static_head_enabled;
      staticHeadEnabled = enabled;
      refreshStaticHeadButton();
      updateHeadControlButtons();
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
      setCameraEnabled(true);
      startCameraStream();

      send("get_head_tracking_status");
      send("get_static_head_status");
      announceClientVersion();
    };

    ws.onclose = function() {
      setStatus("Connection closed", "[!!]");
      setVoiceEnabled(false);
      abortCountdown();
      setCameraEnabled(false);
      stopCameraStream();
      clientVersionAnnounced = false;
      retry();
    };

    ws.onerror = function(e) {
      console.log("WebSocket error:", e);
      setStatus("Connection error", "[!!]");
      setVoiceEnabled(false);
      abortCountdown();
      setCameraEnabled(false);
      stopCameraStream();
      clientVersionAnnounced = false;
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
    };
  }

  function retry() {
    setTimeout(connect, reconnectDelay);
  }

  function send(eventName, payload) {
    if (!ws || ws.readyState !== 1) {
      return;
    }
    try {
      var message = eventName;
      if (payload) {
        // Merge payload with command
        var data = { command: eventName };
        for (var key in payload) {
          if (payload.hasOwnProperty(key)) {
            data[key] = payload[key];
          }
        }
        message = JSON.stringify(data);
      }
      ws.send(message);
    } catch (err) {
      console.log("send error:", err);
    }
  }

  function sendJson(payload) {
    if (!ws || ws.readyState !== 1) {
      return false;
    }
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.log("send error:", err);
      return false;
    }
  }

  function sendCaptureRequest(targetTimestampMs) {
    setStatus("Taking picture...", "[>>]");
    setCameraStatus("Capturing...", true);

    var payload = {
      command: "capture_photo",
      countdown: COUNTDOWN_SECONDS,
      not_before: targetTimestampMs ? targetTimestampMs / 1000 : null,
      requested_at: Date.now() / 1000
    };

    if (!sendJson(payload)) {
      send("capture_photo");
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

  function toggleStaticHead() {
    if (staticHeadBusy || !cameraEnabled) {
      return;
    }
    staticHeadBusy = true;
    refreshStaticHeadButton();
    if (staticHeadEnabled) {
      send("disable_static_head");
    } else {
      send("enable_static_head");
    }
  }

  if (takePictureBtn) {
    takePictureBtn.addEventListener("click", function() {
      startCaptureCountdown();
    });
  }

  if (staticHeadBtn) {
    staticHeadBtn.addEventListener("click", function() {
      toggleStaticHead();
    });
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
    });
    voiceBtn.addEventListener("touchend", function(e) {
      e.preventDefault();
      endHold();
    });
    voiceBtn.addEventListener("touchcancel", function() {
      endHold();
    });
  }

  window.addEventListener("beforeunload", function() {
    if (headTrackingStatusChecked && !headTrackingWasEnabled) {
      console.log("Restoring head tracking to previous state (disabled)");
      if (ws && ws.readyState === 1) {
        send("stop_head_tracking");
      }
    }
    if (staticHeadStatusChecked && staticHeadEnabled !== staticHeadWasEnabled) {
      if (ws && ws.readyState === 1) {
        send(staticHeadWasEnabled ? "enable_static_head" : "disable_static_head");
      }
    }
  });

  // Reset camera button
  var resetCameraBtn = document.getElementById("reset-camera-btn");
  if (resetCameraBtn) {
    resetCameraBtn.addEventListener("click", function() {
      if (!staticHeadEnabled) return;
      send("move_head", { yaw: 0, pitch: 0 });
    });
  }

  // Head control - hold to move (ES5 compatible)
  var headControlBtns = document.querySelectorAll(".head-control-btn");
  var cameraControlHint = document.getElementById("camera-control-hint");
  var headMoveInterval = null;

  function updateHeadControlButtons() {
    for (var i = 0; i < headControlBtns.length; i++) {
      headControlBtns[i].disabled = !staticHeadEnabled;
      if (staticHeadEnabled) {
        headControlBtns[i].style.opacity = "1";
        headControlBtns[i].style.cursor = "pointer";
      } else {
        headControlBtns[i].style.opacity = "0.5";
        headControlBtns[i].style.cursor = "not-allowed";
      }
    }

    // Update reset camera button
    if (resetCameraBtn) {
      resetCameraBtn.disabled = !staticHeadEnabled;
      if (staticHeadEnabled) {
        resetCameraBtn.style.opacity = "1";
      } else {
        resetCameraBtn.style.opacity = "0.5";
      }
    }

    // Show/hide hint message
    if (cameraControlHint) {
      if (staticHeadEnabled) {
        cameraControlHint.classList.add("hidden");
      } else {
        cameraControlHint.classList.remove("hidden");
      }
    }
  }

  for (var i = 0; i < headControlBtns.length; i++) {
    (function(btn) {
      var direction = btn.getAttribute("data-direction");

      // Center button - single click
      if (direction === "center") {
        btn.addEventListener("click", function() {
          if (!staticHeadEnabled) return;
          send("move_head", { yaw: 0, pitch: 0 });
        });
        return;
      }

      // Start moving function
      var startMove = function() {
        if (!staticHeadEnabled) return;
        sendHeadMoveCommand(direction);

        // Continue sending commands while held (every 100ms)
        headMoveInterval = setInterval(function() {
          sendHeadMoveCommand(direction);
        }, 100);
      };

      // Stop moving function
      var stopMove = function() {
        if (headMoveInterval) {
          clearInterval(headMoveInterval);
          headMoveInterval = null;
        }
      };

      // Desktop events
      btn.addEventListener("mousedown", startMove);
      btn.addEventListener("mouseup", stopMove);
      btn.addEventListener("mouseleave", stopMove);

      // Touch events
      btn.addEventListener("touchstart", function(e) {
        e.preventDefault();
        startMove();
      });
      btn.addEventListener("touchend", function(e) {
        e.preventDefault();
        stopMove();
      });
    })(headControlBtns[i]);
  }

  updateHeadControlButtons();

  function sendHeadMoveCommand(direction) {
    // Swapped left/right since we're controlling from opposite side (facing Pepper)
    var commands = {
      "up": { yaw: 0, pitch: -0.05 },
      "down": { yaw: 0, pitch: 0.05 },
      "left": { yaw: -0.08, pitch: 0 },   // Pepper's right (our left)
      "right": { yaw: 0.08, pitch: 0 }    // Pepper's left (our right)
    };

    var cmd = commands[direction];
    if (cmd) {
      send("move_head", { yaw: cmd.yaw, pitch: cmd.pitch });
    }
  }

  setVoiceEnabled(false);
  setCameraEnabled(false);
  setCameraStatus("Connecting...", false);
  setStatus("Connecting...", "[--]");
  refreshStaticHeadButton();
  connect();
})();
