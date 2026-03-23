(function() {
  var ws;
  var statusEl = document.getElementById("status-pill");
  var voiceBtn = document.getElementById("voice-button");
  var audioActive = false;
  var pressing = false;
  var reconnectDelay = 3000;

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

  function handleAck(payload) {
    if (typeof payload.audio_enabled !== "undefined") {
      setVoiceState(!!payload.audio_enabled);
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
        return;
      }
      if (!payload) {
        return;
      }
      if (payload.type === "ack") {
        handleAck(payload);
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

  setVoiceEnabled(false);
  setStatus("Connecting...", "[--]");
  connect();
})();
