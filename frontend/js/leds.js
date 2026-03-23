(function() {
  var ws;
  var statusEl = document.getElementById("status-pill");
  var voiceBtn = document.getElementById("voice-button");
  var ledCards = document.querySelectorAll("[data-led-card]");
  var reconnectDelay = 3000;
  var pressing = false;
  var audioActive = false;
  var availableTargets = {};

  function setStatus(text, emoji) {
    if (!statusEl) return;
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

  function prettify(text) {
    if (!text) return "";
    return text.replace(/_/g, " ").replace(/\b\w/g, function(ch) { return ch.toUpperCase(); });
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

  function applyAvailability(groups) {
    availableTargets = {};
    if (groups && groups.length) {
      for (var i = 0; i < groups.length; i++) {
        availableTargets[groups[i]] = true;
      }
    }
    for (var c = 0; c < ledCards.length; c++) {
      var card = ledCards[c];
      var statusLabel = card.querySelector("[data-led-status]");
      var groupAttr = card.getAttribute("data-groups") || "";
      var groupsForCard = groupAttr.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
      var anyAvailable = false;
      for (var g = 0; g < groupsForCard.length; g++) {
        if (availableTargets[groupsForCard[g]]) {
          anyAvailable = true;
          break;
        }
      }
      card.classList.toggle("disabled", !anyAvailable);
      if (statusLabel) {
        statusLabel.textContent = anyAvailable ? "Ready" : "Not available";
      }
    }
  }

  function handleAck(payload) {
    if (typeof payload.audio_enabled !== "undefined") {
      setVoiceState(!!payload.audio_enabled);
    }
    var cmd = payload.command || "";
    if (cmd === "led_list" && payload.ok) {
      applyAvailability(payload.groups || []);
      if (payload.leds && payload.leds.length) {
        // merge individual LEDs as valid targets
        for (var i = 0; i < payload.leds.length; i++) {
          availableTargets[payload.leds[i]] = true;
        }
      }
      return;
    }
    if (!cmd) return;
    var label = payload.group ? prettify(payload.group) : prettify(cmd);
    if (payload.ok) {
      setStatus(label + " updated.", "[OK]");
    } else {
      setStatus(label + " failed: " + (payload.error || "error"), "[!!]");
    }
  }

  function colorToPayload(value) {
    if (!value) return null;
    if (value.indexOf("#") === 0) {
      return value;
    }
    return "#" + value;
  }

  function handleLedButtonClick(event) {
    var button = event.currentTarget;
    var card = button.closest("[data-led-card]");
    if (!card || card.classList.contains("disabled")) {
      return;
    }
    var action = button.getAttribute("data-led-action");
    if (!action) return;

    var groups = (card.getAttribute("data-groups") || "").split(",").map(function(s) { return s.trim(); }).filter(Boolean);
    if (!groups.length) return;
    var target = null;
    for (var i = 0; i < groups.length; i++) {
      if (availableTargets[groups[i]]) {
        target = groups[i];
        break;
      }
    }
    if (!target) {
      setStatus("Selected LEDs are unavailable.", "[!!]");
      return;
    }

    var label = card.getAttribute("data-label") || target;
    var duration = parseFloat(button.getAttribute("data-duration") || "0.8");
    var intensity = parseFloat(button.getAttribute("data-intensity") || "1.0");
    var color = button.getAttribute("data-color");

    switch (action) {
      case "on":
        sendCommand("led_on", {group: target});
        setStatus("Turning on " + prettify(label) + ".", "[>>]");
        break;
      case "off":
        sendCommand("led_off", {group: target});
        setStatus("Turning off " + prettify(label) + ".", "[>>]");
        break;
      case "fade":
        sendCommand("led_fade", {group: target, intensity: intensity, duration: duration});
        setStatus("Fading " + prettify(label) + " to " + Math.round(intensity * 100) + "%.", "[>>]");
        break;
      case "color":
        var hex = colorToPayload(color);
        sendCommand("led_color", {group: target, color: hex, duration: duration});
        setStatus("Setting " + prettify(label) + " color.", "[>>]");
        break;
      case "rotate":
        var rotateColor = colorToPayload(color) || "#00aaff";
        sendCommand("led_rotate", {color: rotateColor, duration: duration, speed: 1.0});
        setStatus("Spinning " + prettify(label) + ".", "[>>]");
        break;
      case "rainbow":
        sendCommand("led_rainbow", {group: target});
        setStatus("Rainbow sweep on " + prettify(label) + ".", "[>>]");
        break;
      case "rasta":
        sendCommand("led_rasta", {duration: duration});
        setStatus("Tri-color pulse on " + prettify(label) + ".", "[>>]");
        break;
      case "random":
        var randomColor = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
        sendCommand("led_color", {group: target, color: randomColor, duration: 0.6});
        setStatus("Random color selected for " + prettify(label) + ".", "[>>]");
        break;
      default:
        console.log("Unknown LED action:", action);
    }

    button.classList.add("triggered");
    setTimeout(function() {
      button.classList.remove("triggered");
    }, 220);
  }

  function attachButtonListeners() {
    for (var i = 0; i < ledCards.length; i++) {
      var buttons = ledCards[i].querySelectorAll("[data-led-action]");
      for (var b = 0; b < buttons.length; b++) {
        buttons[b].addEventListener("click", handleLedButtonClick);
      }
    }
  }

  function requestLedList() {
    sendCommand("led_list", {});
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
      if (window.PepperUtils && PepperUtils.init) {
        PepperUtils.init(ws);
      }
      requestLedList();
    };

    ws.onclose = function() {
      setStatus("Connection closed", "[!!]");
      setVoiceEnabled(false);
      retry();
    };

    ws.onerror = function() {
      setStatus("Connection error", "[!!]");
      setVoiceEnabled(false);
    };

    ws.onmessage = function(evt) {
      if (!evt.data) return;
      var payload;
      try {
        payload = JSON.parse(evt.data);
      } catch (err) {
        return;
      }
      if (!payload) return;

      if (payload.type === "ack") {
        handleAck(payload);
      } else if (payload.type === "hello") {
        requestLedList();
      } else if (typeof payload.audio_enabled !== "undefined") {
        setVoiceState(!!payload.audio_enabled);
      }
    };
  }

  function retry() {
    setTimeout(connect, reconnectDelay);
  }

  function startHold() {
    if (pressing) return;
    pressing = true;
    if (voiceBtn) {
      voiceBtn.classList.add("active");
    }
    if (ws && ws.readyState === 1) {
      ws.send("start_audio");
    }
  }

  function endHold() {
    if (!pressing) return;
    pressing = false;
    if (voiceBtn) {
      voiceBtn.classList.remove("active");
    }
    if (ws && ws.readyState === 1) {
      ws.send("stop_audio");
    }
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
    voiceBtn.addEventListener("mouseup", endHold);
    voiceBtn.addEventListener("mouseleave", endHold);
    voiceBtn.addEventListener("touchstart", function(event) {
      if (voiceBtn.classList.contains("disabled")) return;
      event.preventDefault();
      startHold();
    });
    voiceBtn.addEventListener("touchend", function(event) {
      event.preventDefault();
      endHold();
    });
    voiceBtn.addEventListener("touchcancel", endHold);
  }

  attachButtonListeners();
  setVoiceEnabled(false);
  setStatus("Connecting...", "[--]");
  connect();
})();
