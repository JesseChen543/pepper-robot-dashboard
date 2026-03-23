(function() {
  var ws;
  var statusEl = document.getElementById("status-pill");
  var batteryEl = document.getElementById("battery-indicator");
  var voiceBtn = document.getElementById("voice-button");
  var audioActive = false;
  var pepperSpeaking = false;
  var realtimeActive = false;
  var currentMode = localStorage.getItem("voiceMode") || "manual"; // load from settings or default
  var reconnectDelay = 3000;

  function setStatus(text, emoji) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = (emoji || "") + " " + text;
  }

  function setBattery(level) {
    if (!batteryEl) {
      return;
    }
    if (level === null || level === undefined) {
      batteryEl.style.display = "none";
      return;
    }
    batteryEl.style.display = "flex";
    var percentage = batteryEl.querySelector(".battery-percentage");
    var fill = batteryEl.querySelector(".battery-fill");
    if (percentage) {
      percentage.textContent = level + "%";
    }
    if (fill) {
      fill.style.width = level + "%";
      // Change color based on battery level
      if (level <= 20) {
        fill.style.background = "#ff4444";
      } else if (level <= 50) {
        fill.style.background = "#ffaa00";
      } else {
        fill.style.background = "#00cc66";
      }
    }
  }

  function setVoiceState(state) {
    audioActive = state;
    if (voiceBtn && currentMode === "manual") {
      voiceBtn.classList.toggle("active", state);
      var textEl = voiceBtn.querySelector(".voice-text");
      if (textEl) {
        textEl.textContent = state ? "SEND AUDIO" : "TAP TO TALK";
      }
    }
  }

  function setVoiceEnabled(enabled) {
    if (!voiceBtn) {
      return;
    }
    voiceBtn.classList.toggle("disabled", !enabled);
    if (!enabled) {
      voiceBtn.classList.remove("active");
    }
  }

  function updateButtonForMode() {
    if (!voiceBtn) return;

    // Update button appearance based on mode
    if (currentMode === "manual") {
      voiceBtn.className = "voice-button";
      var textEl = voiceBtn.querySelector(".voice-text");
      if (textEl) {
        textEl.textContent = audioActive ? "SEND AUDIO" : "TAP TO TALK";
      }
      if (audioActive) {
        voiceBtn.classList.add("active");
      }
    } else if (currentMode === "realtime") {
      voiceBtn.className = "voice-button realtime-button";
      var textEl = voiceBtn.querySelector(".voice-text");
      if (textEl) {
        textEl.textContent = realtimeActive ? "STOP REALTIME" : "REALTIME MODE";
      }
      if (realtimeActive) {
        voiceBtn.classList.add("active");
      }
    }
  }

  function switchMode(newMode) {
    if (currentMode === newMode) return;

    console.log("Switching mode from", currentMode, "to", newMode);

    // Stop current mode activities
    if (currentMode === "manual" && audioActive) {
      send("stop_audio");
      audioActive = false;
    } else if (currentMode === "realtime" && realtimeActive) {
      send("stop_realtime");
      realtimeActive = false;
    }

    currentMode = newMode;
    updateButtonForMode();
  }

  function handleAck(payload) {
    // Update UI state based on server's audio_enabled status
    if (typeof payload.audio_enabled !== "undefined") {
      var newState = !!payload.audio_enabled;
      setVoiceState(newState);
      console.log("Audio state updated:", newState ? "ENABLED" : "DISABLED");
    }

    var cmd = payload.command || "";

    if (payload.ok) {
      if (!cmd || cmd === "start_audio" || cmd === "stop_audio") {
        return;
      }
    }
  }

  function wsUrl() {
    var host = window.location.hostname || "198.18.0.1";
    return "ws://" + host + ":9001";
  }

  function connect() {
    try {
      ws = new WebSocket(wsUrl());
      // Expose WebSocket globally for dance-popup.js
      window.ws = ws;
    } catch (err) {
      console.log("WebSocket init error:", err);
      retry();
      return;
    }

    ws.onopen = function() {
      setStatus("Connected to Pepper", "[OK]");
      setVoiceEnabled(true);
    };

    ws.onclose = function() {
      setStatus("Connection closed", "[!!]");
      setVoiceEnabled(false);
      retry();
    };

    ws.onerror = function(e) {
      console.log("WebSocket error:", e);
      setStatus("Connection error", "[!!]");
      setVoiceEnabled(false);
    };

    ws.onmessage = function(evt) {
      if (!evt.data) {
        return;
      }
      var payload;
      try {
        payload = JSON.parse(evt.data);
      } catch (err) {
        console.log("JSON parse error:", err);
        return;
      }
      if (!payload) {
        return;
      }

      console.log("WS message received:", payload.type || "unknown", payload);

      // Handle battery updates
      if (payload.type === "battery_update" || payload.type === "hello") {
        if (typeof payload.battery !== "undefined") {
          setBattery(payload.battery);
        }
      }

      if (payload.type === "ack") {
        handleAck(payload);
        return;
      }
      // Handle audio_state broadcasts from server (e.g., auto-disable on response)
      if (payload.type === "audio_state") {
        var newState = !!payload.audio_enabled;
        setVoiceState(newState);
        console.log("Audio state broadcast received:", payload.status);
        return;
      }
      // Track when Pepper is speaking
      if (payload.type === "playback_state") {
        pepperSpeaking = !!payload.playing;
        console.log("Pepper speaking:", pepperSpeaking);
        // Update button text when Pepper is speaking (manual mode only)
        if (voiceBtn && pepperSpeaking && currentMode === "manual") {
          var textEl = voiceBtn.querySelector(".voice-text");
          if (textEl) {
            textEl.textContent = "TAP TO TALK";
          }
        }
        return;
      }
      // Fallback: Handle audio state updates from server
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
    if (voiceBtn.classList.contains("disabled")) return;

    if (currentMode === "manual") {
      // Manual mode (tap-to-talk)
      // If Pepper is speaking, interrupt and start new listening session
      if (pepperSpeaking) {
        console.log("Interrupting Pepper's speech, starting new session");
        send("cancel_response");
        pepperSpeaking = false;
        // Delay to let cancellation complete and clear all audio chunks
        setTimeout(function() {
          send("start_audio");
        }, 300);
        return;
      }

      // Toggle between listening and sending
      if (audioActive) {
        // Currently listening -> stop and send audio
        console.log("Stopping audio and sending to OpenAI");
        send("stop_audio");
      } else {
        // Not listening -> start listening
        console.log("Starting audio capture");
        send("start_audio");
      }
    } else if (currentMode === "realtime") {
      // Realtime mode
      if (realtimeActive) {
        // Stop realtime mode
        console.log("Stopping realtime mode");
        send("stop_realtime");
        realtimeActive = false;
        updateButtonForMode();
      } else {
        // Start realtime mode
        console.log("Starting realtime mode");
        send("start_realtime");
        realtimeActive = true;
        updateButtonForMode();
      }
    }
  }

  if (voiceBtn) {
    voiceBtn.addEventListener("click", function(e) {
      e.preventDefault();
      toggleVoice();
    });
    voiceBtn.addEventListener("touchend", function(e) {
      e.preventDefault();
      toggleVoice();
    });
  }

  setVoiceEnabled(false);
  setStatus("Connecting...", "[--]");
  updateButtonForMode(); // Set initial button appearance
  connect();
})();
