(function() {
  var ws;
  var statusEl = document.getElementById("status-pill");
  var pageTitle = document.getElementById("page-title");
  var voiceBtn = document.getElementById("voice-button");
  var homeGrid = document.getElementById("home-grid");
  var motionPanel = document.getElementById("motion-panel");
  var motionApp = document.getElementById("motion-app");
  var motionBack = document.getElementById("motion-back");
  var motionButtons = document.querySelectorAll("[data-motion]");
  var motionHint = document.getElementById("motion-hint");
  var motionHintDefault = motionHint ? motionHint.textContent : "";
  var audioActive = false;
  var pressing = false;
  var reconnectDelay = 3000;
  var motionEnabled = false;

  function prettifyLabel(name) {
    if (!name) {
      return "";
    }
    return name.replace(/_/g, " ").replace(/\b\w/g, function(ch) {
      return ch.toUpperCase();
    });
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
      // Update button text based on state
      var voiceText = voiceBtn.querySelector(".voice-text");
      if (voiceText) {
        voiceText.textContent = state ? "SEND AUDIO" : "TAP TO TALK";
      }
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

  function setMotionEnabled(enabled) {
    if (motionEnabled === enabled) {
      return;
    }
    motionEnabled = enabled;
    for (var i = 0; i < motionButtons.length; i++) {
      motionButtons[i].disabled = !enabled;
      motionButtons[i].classList.toggle("disabled", !enabled);
    }
    if (!enabled) {
      updateMotionHint(null);
    }
  }

  function showMotionPanel() {
    if (motionPanel) {
      motionPanel.classList.add("active");
    }
    if (homeGrid) {
      homeGrid.classList.add("hidden");
    }
    if (pageTitle) {
      pageTitle.textContent = "Motion Library";
    }
  }

  function showHomePanel() {
    if (motionPanel) {
      motionPanel.classList.remove("active");
    }
    if (homeGrid) {
      homeGrid.classList.remove("hidden");
    }
    if (pageTitle) {
      pageTitle.textContent = "Pepper Dashboard";
    }
  }

  function updateMotionHint(names) {
    if (!motionHint) {
      return;
    }
    if (!names || !names.length) {
      motionHint.textContent = motionHintDefault || "Tap an action to choreograph Pepper in real time.";
      return;
    }
    var maxItems = 12;
    var trimmed = names.slice(0, maxItems);
    var listText = trimmed.join(", ");
    if (names.length > maxItems) {
      listText += ", ...";
    }
    var base = motionHintDefault || "Tap an action to choreograph Pepper in real time.";
    motionHint.textContent = base + " Available: " + listText + ".";
  }

  function handleAck(payload) {
    if (typeof payload.audio_enabled !== "undefined") {
      setVoiceState(!!payload.audio_enabled);
    }

    var cmd = payload.command || "";

    if (payload.ok) {
      if (!cmd || cmd === "start_audio" || cmd === "stop_audio") {
        return;
      }

      var label = payload.name ? prettifyLabel(payload.name) : prettifyLabel(cmd);
      setStatus("Action '" + label + "' running.", "[OK]");
    } else {
      var labelText = payload.name ? prettifyLabel(payload.name) : (cmd ? prettifyLabel(cmd) : "command");
      var errorText = payload.error || "failed";
      setStatus(labelText + " failed: " + errorText, "[!!]");
    }
  }

  if (motionApp) {
    motionApp.addEventListener("click", function(event) {
      event.preventDefault();
      showMotionPanel();
      if (!motionEnabled) {
        setStatus("Connect to Pepper to run motions.", "[!!]");
      }
    });
  }

  if (motionBack) {
    motionBack.addEventListener("click", function() {
      showHomePanel();
    });
  }

  // Motion button click handler
  for (var i = 0; i < motionButtons.length; i++) {
    motionButtons[i].addEventListener("click", function() {
      var command = this.getAttribute("data-motion");
      if (!command) {
        return;
      }
      var label = this.getAttribute("data-label");
      if (!label) {
        var strongEl = this.querySelector("strong");
        label = strongEl ? strongEl.textContent.trim() : prettifyLabel(command);
      }

      // Send command to Pepper
      send(command);
      setStatus("Running " + label, "[>>]");

      // Visual feedback on button
      var button = this;
      button.classList.add("triggered");
      setTimeout(function() {
        button.classList.remove("triggered");
      }, 220);
    });
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
      setMotionEnabled(true);
    };

    ws.onclose = function() {
      setStatus("Connection closed", "[!!]");
      setVoiceEnabled(false);
      setMotionEnabled(false);
      retry();
    };

    ws.onerror = function(e) {
      console.log("WebSocket error:", e);
      setStatus("Connection error", "[!!]");
      setVoiceEnabled(false);
      setMotionEnabled(false);
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
      if (payload.type === "hello") {
        if (payload.gestures) {
          updateMotionHint(payload.gestures);
        }
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

  function toggleVoice() {
    // Toggle between listening and sending
    if (audioActive) {
      // Currently listening -> stop and send audio
      send("stop_audio");
      if (voiceBtn) {
        voiceBtn.classList.remove("active");
      }
    } else {
      // Not listening -> start listening
      send("start_audio");
      if (voiceBtn) {
        voiceBtn.classList.add("active");
      }
    }
  }

  if (voiceBtn) {
    // Use click event for tap-to-talk toggle
    voiceBtn.addEventListener("click", function(e) {
      if (voiceBtn.classList.contains("disabled")) return;
      e.preventDefault();
      toggleVoice();
    });
  }

  setVoiceEnabled(false);
  setMotionEnabled(false);
  setStatus("Connecting...", "[--]");
  connect();
})();
