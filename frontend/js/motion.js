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

  // Dance button click handler
  var danceButtons = document.querySelectorAll("[data-dance]");
  for (var j = 0; j < danceButtons.length; j++) {
    danceButtons[j].addEventListener("click", function() {
      var dance = this.getAttribute("data-dance");
      if (!dance) {
        return;
      }

      var button = this;

      if (dance === "christmas") {
        // Disable button during dance
        button.disabled = true;
        button.classList.add("disabled");

        var originalHTML = button.innerHTML;
        button.innerHTML = '<div class="dance-icon"><svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" d="M12 2L5 12h3l-2 4h3l-2 4h12l-2-4h3l-2-4h3L12 2zm0 3.5L15.5 10h-2l1.5 3h-2l1.5 3h-5l1.5-3h-2l1.5-3h-2L12 5.5zM11 20v2h2v-2h-2z"/></svg></div><strong>Dancing...</strong><small>Please wait ~20 seconds</small><div class="dance-duration">~20s</div>';

        // Send christmas dance command
        send("christmas_dance");
        setStatus("Performing Christmas Dance!", "[OK]");

        // Re-enable after 25 seconds (dance is ~20s + buffer)
        setTimeout(function() {
          button.disabled = false;
          button.classList.remove("disabled");
          button.innerHTML = originalHTML;
          setStatus("Dance complete!", "[✓]");
        }, 25000);
      } else if (dance === "birthday") {
        // Disable button during dance
        button.disabled = true;
        button.classList.add("disabled");

        var originalHTML = button.innerHTML;
        button.innerHTML = '<div class="dance-icon"><svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" d="M12 6c1.1 0 2-.9 2-2 0-.4-.1-.7-.3-1L12 0l-1.7 3c-.2.3-.3.6-.3 1 0 1.1.9 2 2 2zm4.6 9.6L15 14.2V13c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v1.2l-1.6 1.4c-.3.2-.4.6-.4.9V22h10v-5.5c0-.3-.1-.7-.4-.9zM18 9h-2V7h-1v2h-2V7h-2v2H9V7H8v2H6c-1.1 0-2 .9-2 2v2h16v-2c0-1.1-.9-2-2-2z"/></svg></div><strong>Dancing...</strong><small>Please wait ~30 seconds</small><div class="dance-duration">~30s</div>';

        // Send birthday dance command
        send("birthday_dance");
        setStatus("Performing Birthday Dance!", "[OK]");

        // Re-enable after 35 seconds (dance is ~30s + buffer)
        setTimeout(function() {
          button.disabled = false;
          button.classList.remove("disabled");
          button.innerHTML = originalHTML;
          setStatus("Dance complete!", "[✓]");
        }, 35000);
      } else if (dance === "kungfu") {
        // Disable button during dance
        button.disabled = true;
        button.classList.add("disabled");

        var originalHTML = button.innerHTML;
        button.innerHTML = '<div class="dance-icon"><svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" d="M12 2C9.24 2 7 4.24 7 7s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3zm-1 4H8l-4 8h4l2-4 2 4h4l-4-8h-1zm6.5-2l1.5 3 2-1-2.5-3-1 1zm-11 0l-1 1-2.5 3 2 1 1.5-3z"/></svg></div><strong>Dancing...</strong><small>Please wait ~1 minute</small><div class="dance-duration">~60s</div>';

        // Send kung fu dance command
        send("kungfu_dance");
        setStatus("Performing Kung Fu Dance!", "[OK]");

        // Re-enable after 65 seconds (dance is ~60s + buffer)
        setTimeout(function() {
          button.disabled = false;
          button.classList.remove("disabled");
          button.innerHTML = originalHTML;
          setStatus("Dance complete!", "[✓]");
        }, 65000);
      } else if (dance === "robot") {
        // Disable button during dance
        button.disabled = true;
        button.classList.add("disabled");

        var originalHTML = button.innerHTML;
        button.innerHTML = '<div class="dance-icon">⚙</div><strong>Dancing...</strong><small>Please wait ~30 seconds</small><div class="dance-duration">~30s</div>';

        // Send robot dance command
        send("robot_dance");
        setStatus("Performing Robot Dance!", "[⚙]");

        // Re-enable after 35 seconds (dance is ~30s + buffer)
        setTimeout(function() {
          button.disabled = false;
          button.classList.remove("disabled");
          button.innerHTML = originalHTML;
          setStatus("Dance complete!", "[✓]");
        }, 35000);
      } else if (dance === "gangnam") {
        // Disable button during dance
        button.disabled = true;
        button.classList.add("disabled");

        var originalHTML = button.innerHTML;
        button.innerHTML = '<div class="dance-icon">♪</div><strong>Dancing...</strong><small>Please wait ~40 seconds</small><div class="dance-duration">~40s</div>';

        // Send gangnam dance command
        send("gangnam_dance");
        setStatus("Performing Gangnam Style!", "[♪]");

        // Re-enable after 45 seconds (dance is ~40s + buffer)
        setTimeout(function() {
          button.disabled = false;
          button.classList.remove("disabled");
          button.innerHTML = originalHTML;
          setStatus("Dance complete!", "[✓]");
        }, 45000);
      } else if (dance === "chacha") {
        // Disable button during dance
        button.disabled = true;
        button.classList.add("disabled");

        var originalHTML = button.innerHTML;
        button.innerHTML = '<div class="dance-icon">~</div><strong>Dancing...</strong><small>Please wait ~55 seconds</small><div class="dance-duration">~55s</div>';

        // Send chacha dance command
        send("chacha_dance");
        setStatus("Performing Cha Cha Slide!", "[~]");

        // Re-enable after 60 seconds (dance is ~55s + buffer)
        setTimeout(function() {
          button.disabled = false;
          button.classList.remove("disabled");
          button.innerHTML = originalHTML;
          setStatus("Dance complete!", "[✓]");
        }, 60000);
      }
    });
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
    console.log("Attempting to send command:", eventName);
    if (!ws || ws.readyState !== 1) {
      console.error("WebSocket not ready. State:", ws ? ws.readyState : "no ws");
      return;
    }
    try {
      ws.send(eventName);
      console.log("Command sent successfully:", eventName);
    } catch (err) {
      console.error("send error:", err);
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
  setMotionEnabled(false);
  setStatus("Connecting...", "[--]");
  connect();
})();
