(function() {
  var ws;
  var statusEl = document.getElementById("status-pill");
  var batteryEl = document.getElementById("battery-indicator");
  var refreshBtn = document.getElementById("refresh-button");
  var voiceBtn = document.getElementById("voice-button");

  var audioActive = false;
  var reconnectDelay = 3000;
  var refreshInterval = null;

  function setStatus(text, emoji) {
    if (!statusEl) return;
    statusEl.textContent = (emoji || "") + " " + text;
  }

  function setBattery(level) {
    if (!batteryEl) return;
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
    if (voiceBtn) {
      voiceBtn.classList.toggle("active", state);
      var textEl = voiceBtn.querySelector(".voice-text");
      if (textEl) {
        textEl.textContent = state ? "TAP TO STOP" : "TAP TO TALK";
      }
    }
  }

  function setVoiceEnabled(enabled) {
    if (!voiceBtn) return;
    voiceBtn.classList.toggle("disabled", !enabled);
    if (!enabled) {
      voiceBtn.classList.remove("active");
    }
  }

  function renderHealthData(data) {
    console.log("Health data received:", data);

    // System info
    if (data.system) {
      var naoqiEl = document.getElementById("naoqi-version");
      if (naoqiEl) naoqiEl.textContent = data.system.naoqi_version || "Unknown";
    }

    // Battery
    if (data.battery && typeof data.battery.charge !== "undefined") {
      setBattery(data.battery.charge);
    }

    // Temperatures
    var tempContainer = document.getElementById("temp-container");
    if (tempContainer && data.temperatures) {
      tempContainer.innerHTML = "";
      if (data.temperatures.length === 0) {
        tempContainer.innerHTML = '<p class="health-loading">No temperature sensors available</p>';
      } else {
        data.temperatures.forEach(function(temp) {
          var card = document.createElement("div");
          card.className = "health-status-item";
          if (temp.status === "HOT") {
            card.classList.add("health-status-warning");
          }
          card.innerHTML =
            '<div class="health-status-label">' + temp.location + '</div>' +
            '<div class="health-status-value">' + temp.value + '°C</div>' +
            '<div class="health-status-badge ' + (temp.status === "HOT" ? "health-badge-warning" : "health-badge-ok") + '">' +
            temp.status +
            '</div>';
          tempContainer.appendChild(card);
        });
      }
    }

    // Joints table
    var tbody = document.getElementById("joints-tbody");
    if (tbody && data.joints) {
      tbody.innerHTML = "";
      if (data.joints.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="health-loading">No joint data available</td></tr>';
      } else {
        data.joints.forEach(function(joint) {
          var row = document.createElement("tr");
          if (joint.status === "HOT") {
            row.classList.add("health-row-warning");
          }

          row.innerHTML =
            '<td class="health-cell-name">' + joint.name + '</td>' +
            '<td class="health-cell-temp">' + joint.temperature.toFixed(1) + '</td>' +
            '<td>' + joint.position.toFixed(2) + '</td>' +
            '<td>' + (joint.stiffness * 100).toFixed(0) + '%</td>' +
            '<td><span class="health-badge ' +
            (joint.status === "HOT" ? "health-badge-warning" : "health-badge-ok") + '">' +
            joint.status + '</span></td>';
          tbody.appendChild(row);
        });
      }
    }

    setStatus("Data loaded", "[OK]");
  }

  function requestHealthData() {
    if (!ws || ws.readyState !== 1) {
      console.log("WebSocket not connected, cannot request health data");
      return;
    }

    try {
      var command = JSON.stringify({
        command: "get_health_data"
      });
      ws.send(command);
      setStatus("Loading health data...", "[>>]");
    } catch (err) {
      console.log("Failed to request health data:", err);
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
      setStatus("Connected", "[OK]");
      setVoiceEnabled(true);
      // Request health data immediately on connect
      setTimeout(requestHealthData, 500);

      // Auto-refresh every 5 seconds
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(requestHealthData, 5000);
    };

    ws.onclose = function() {
      setStatus("Connection closed", "[!!]");
      setVoiceEnabled(false);
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
      retry();
    };

    ws.onerror = function(e) {
      console.log("WebSocket error:", e);
      setStatus("Connection error", "[!!]");
      setVoiceEnabled(false);
    };

    ws.onmessage = function(evt) {
      if (!evt.data) return;

      var payload;
      try {
        payload = JSON.parse(evt.data);
      } catch (err) {
        console.log("JSON parse error:", err);
        return;
      }
      if (!payload) return;

      console.log("WS message received:", payload.type || "unknown");

      // Handle battery updates
      if (payload.type === "battery_update" || payload.type === "hello") {
        if (typeof payload.battery !== "undefined") {
          setBattery(payload.battery);
        }
      }

      // Handle health data response
      if (payload.type === "ack" && payload.command === "get_health_data") {
        if (payload.ok && payload.battery) {
          renderHealthData(payload);
        } else if (!payload.ok) {
          console.error("Health data request failed:", payload.error);
          setStatus("Failed to load data", "[!!]");
        }
      }

      // Handle audio_state broadcasts
      if (payload.type === "audio_state") {
        setVoiceState(!!payload.audio_enabled);
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
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(eventName);
    } catch (err) {
      console.log("send error:", err);
    }
  }

  function toggleVoice() {
    if (voiceBtn.classList.contains("disabled")) return;
    if (!audioActive) {
      send("start_audio");
    } else {
      send("stop_audio");
    }
  }

  // Event listeners
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

  if (refreshBtn) {
    refreshBtn.addEventListener("click", function() {
      if (refreshBtn.disabled) return;
      requestHealthData();
    });
  }

  // Initialize
  setVoiceEnabled(false);
  setStatus("Connecting...", "[--]");
  connect();
})();
