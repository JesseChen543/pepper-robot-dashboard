(function() {
  // WebSocket connection
  var ws;
  var reconnectDelay = 3000;
  var host = window.location.hostname || "198.18.0.1";
  var wsPort = 9001;

  // UI Elements
  var statusEl = document.getElementById("status-pill");
  var pepperIpEl = document.getElementById("pepper-ip");
  var connectionStatusEl = document.getElementById("connection-status");
  var gestureModal = document.getElementById("gesture-modal");
  var gestureModalText = document.getElementById("gesture-modal-text");
  var toast = document.getElementById("toast");
  var toastText = document.getElementById("toast-text");

  // Current page tracking
  var currentPage = "motion";

  // Gesture tracking
  var currentGesture = null;
  var gestureTimeout = null;
  var toastTimeout = null;
  var movementState = {
    isHolding: false,
    action: null,
    pointerId: null,
    vector: null,
    repeatTimer: null
  };

  // Initialize
  function init() {
    console.log("Mobile app initializing...");
    try {
      setupNavigation();
      console.log("Navigation setup complete");
      setupMotionControls();
      console.log("Motion controls setup complete");
      setupCameraControls();
      console.log("Camera controls setup complete");
      setupPhotosControls();
      console.log("Photos controls setup complete");
      setupTTSControls();
      console.log("TTS controls setup complete");
      setupLEDControls();
      console.log("LED controls setup complete");
      setupSettings();
      console.log("Settings setup complete");
      setupVideoControls();
      console.log("Video controls setup complete");
      connect();
      console.log("WebSocket connecting...");
    } catch (err) {
      console.error("Initialization error:", err);
      alert("Error initializing app: " + err.message);
    }
  }

  // Navigation
  function setupNavigation() {
    var navBtns = document.querySelectorAll(".nav-btn");
    navBtns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        var page = this.getAttribute("data-page");
        switchPage(page);
      });
    });
  }

  function switchPage(pageName) {
    // Update nav buttons
    document.querySelectorAll(".nav-btn").forEach(function(btn) {
      btn.classList.remove("active");
    });
    document.querySelector('[data-page="' + pageName + '"]').classList.add("active");

    // Update pages
    document.querySelectorAll(".page").forEach(function(page) {
      page.classList.remove("active");
    });
    document.getElementById(pageName + "-page").classList.add("active");

    currentPage = pageName;

    // Manage page-specific features
    if (pageName === "motion") {
      startAnimationStatusPolling();
    } else {
      stopAnimationStatusPolling();
    }

    if (pageName === "camera") {
      startCameraStream();
      send("get_static_head_status");
    } else if (pageName === "photos") {
      loadPhotos();
    } else if (pageName === "settings") {
      send("get_head_tracking_status");
    }
  }

  // WebSocket
  function connect() {
    try {
      ws = new WebSocket("ws://" + host + ":" + wsPort);
      // Expose WebSocket globally for dance-popup.js
      window.ws = ws;
    } catch (err) {
      console.log("WebSocket init error:", err);
      retry();
      return;
    }

    ws.onopen = function() {
      setStatus("Connected", true);
      if (connectionStatusEl) {
        connectionStatusEl.textContent = "Connected";
        connectionStatusEl.style.color = "#4caf50";
      }
    };

    ws.onclose = function() {
      setStatus("Disconnected", false);
      if (connectionStatusEl) {
        connectionStatusEl.textContent = "Disconnected";
        connectionStatusEl.style.color = "#f44336";
      }
      retry();
    };

    ws.onerror = function(e) {
      console.log("WebSocket error:", e);
      setStatus("Error", false);
    };

    ws.onmessage = function(evt) {
      handleMessage(evt.data);
    };
  }

  function retry() {
    setTimeout(connect, reconnectDelay);
  }

  function send(command, payload) {
    if (!ws || ws.readyState !== 1) {
      console.log("WebSocket not ready");
      return;
    }
    try {
      var message = payload ? JSON.stringify(Object.assign({command: command}, payload)) : command;
      ws.send(message);
    } catch (err) {
      console.log("Send error:", err);
    }
  }

  function handleMessage(data) {
    try {
      var payload = JSON.parse(data);
      console.log("Received:", payload);

      // Handle ack messages
      if (payload.type === "ack") {
        handleAck(payload);
        return;
      }

      // Handle state change broadcasts
      if (payload.type === "state_change") {
        handleStateChange(payload);
        return;
      }

      // Handle video download progress
      if (payload.type === "video_download_progress") {
        handleVideoProgress(payload);
        return;
      }

      // Handle video download started
      if (payload.type === "video_download_started") {
        handleVideoDownloadStarted(payload);
        return;
      }

      // Handle video download failed
      if (payload.type === "video_download_failed") {
        handleVideoDownloadFailed(payload);
        return;
      }

      // Handle set_video (video ready to play)
      if (payload.type === "set_video") {
        handleVideoReady(payload);
        return;
      }
    } catch (err) {
      console.log("Parse error:", err);
    }
  }

  function handleAck(payload) {
    var cmd = payload.command || "";

    if (!payload.ok) {
      console.log("Command failed:", cmd, payload.error);

      if (cmd === "move") {
        var errorMsg = payload.error || "Movement failed";

        // Check if this is rotation-only movement (turn left/right)
        var isRotationOnly = movementState.vector &&
                             movementState.vector.x === 0 &&
                             movementState.vector.y === 0 &&
                             movementState.vector.theta !== 0;

        // Show obstacle warning for obstacle-related errors (but NOT for rotation)
        if (!isRotationOnly && errorMsg && (errorMsg.indexOf("obstacle") !== -1 || errorMsg.indexOf("blocked") !== -1)) {
          console.log("Obstacle detected - showing warning popup");
          showObstacleWarning(2000);
        } else {
          showToast(errorMsg, 3000);
        }

        cancelContinuousMovement();
        sendStopMovement();
      }

      if (cmd === "capture_photo") {
        alert("Failed to capture photo: " + (payload.error || "Unknown error"));
      }
      return;
    }

    // Handle camera frame
    if (cmd === "get_camera_frame" && payload.frame) {
      displayCameraFrame(payload.frame);
      return;
    }

    // Handle photo list
    if (cmd === "list_photos" && payload.photos) {
      displayPhotos(payload.photos);
      return;
    }

    // Handle photo capture success
    if (cmd === "capture_photo") {
      console.log("Photo captured successfully!");
      // Photo page will be shown after countdown completes
      return;
    }

    // Handle animation status
    if (cmd === "get_animation_status") {
      updateAnimationStatus(payload.animations_busy);
      return;
    }

    // Handle gesture response with busy indicator
    if (cmd === "gesture" || payload.name) {
      // Close the modal when gesture completes
      if (currentGesture && payload.name === currentGesture) {
        // Add a small delay so user sees the completion
        setTimeout(function() {
          hideGestureModal();
        }, 500);
      }

      if (payload.animations_busy || payload.queued) {
        updateAnimationStatus(true);
      }
      return;
    }

    // Handle static head status
    if (cmd === "get_static_head_status") {
      staticHeadEnabled = !!payload.static_head_enabled;
      staticHeadBusy = false;
      updateStaticHeadButton();
      return;
    }

    // Handle static head enable/disable
    if (cmd === "enable_static_head" || cmd === "disable_static_head") {
      staticHeadEnabled = !!payload.static_head_enabled;
      staticHeadBusy = false;
      updateStaticHeadButton();
      console.log("Static head " + (staticHeadEnabled ? "enabled" : "disabled"));
      return;
    }

    // Handle head tracking status query
    if (cmd === "get_head_tracking_status") {
      var headTrackingToggle = document.getElementById("head-tracking-toggle");
      if (headTrackingToggle) {
        headTrackingToggle.checked = !!payload.head_tracking_enabled;
      }
      console.log("Head tracking status:", payload.head_tracking_enabled ? "enabled" : "disabled");
      return;
    }

    // Handle head tracking start/stop
    if (cmd === "start_head_tracking" || cmd === "stop_head_tracking") {
      var headTrackingToggle = document.getElementById("head-tracking-toggle");
      if (headTrackingToggle) {
        headTrackingToggle.checked = (cmd === "start_head_tracking");
        headTrackingToggle.disabled = false;
      }
      console.log("Head tracking " + (cmd === "start_head_tracking" ? "started" : "stopped"));
      return;
    }

    // Handle navigation status
    if (cmd === "get_navigation_status") {
      handleNavigationStatusResponse(payload);
      return;
    }

    // Handle get position
    if (cmd === "get_robot_position") {
      handlePositionResponse(payload);
      return;
    }
  }

  function handleStateChange(payload) {
    var cmd = payload.command || "";
    console.log("State change broadcast:", cmd);

    // Handle head tracking state changes
    if (cmd === "start_head_tracking" || cmd === "stop_head_tracking") {
      var headTrackingToggle = document.getElementById("head-tracking-toggle");
      if (headTrackingToggle) {
        headTrackingToggle.checked = (cmd === "start_head_tracking");
      }
      return;
    }

    // Handle static head state changes
    if (cmd === "enable_static_head" || cmd === "disable_static_head") {
      staticHeadEnabled = !!payload.static_head_enabled;
      updateStaticHeadButton();
      return;
    }
  }

  function updateAnimationStatus(isBusy) {
    var statusEl = document.getElementById("animation-status");
    if (!statusEl) return;

    if (isBusy) {
      statusEl.textContent = "Animating...";
      statusEl.className = "animation-status busy";
    } else {
      statusEl.textContent = "";
      statusEl.className = "animation-status";
    }
  }

  function showGestureModal(gestureName) {
    if (!gestureModal || !gestureModalText) return;

    // Format gesture name for display
    var displayName = gestureName.replace(/_/g, " ");
    displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

    gestureModalText.textContent = 'Performing "' + displayName + '"';
    gestureModal.classList.add("active");
    currentGesture = gestureName;

    // Set a safety timeout to auto-close after 10 seconds
    if (gestureTimeout) {
      clearTimeout(gestureTimeout);
    }
    gestureTimeout = setTimeout(function() {
      hideGestureModal();
    }, 10000);
  }

  function hideGestureModal() {
    if (!gestureModal) return;

    gestureModal.classList.remove("active");
    currentGesture = null;

    if (gestureTimeout) {
      clearTimeout(gestureTimeout);
      gestureTimeout = null;
    }
  }

  // Obstacle warning elements
  var obstacleWarning = document.getElementById("obstacle-warning");
  var obstacleWarningTimeout = null;

  function showObstacleWarning(duration) {
    if (!obstacleWarning) {
      console.log("ERROR: Obstacle warning element not found!");
      return;
    }

    duration = duration || 2000;

    obstacleWarning.classList.add("show");

    // Clear existing timeout
    if (obstacleWarningTimeout) {
      clearTimeout(obstacleWarningTimeout);
    }

    // Auto-hide after duration
    obstacleWarningTimeout = setTimeout(function() {
      obstacleWarning.classList.remove("show");
    }, duration);
  }

  function showToast(message, duration) {
    if (!toast || !toastText) return;

    duration = duration || 3000;

    toastText.textContent = message;
    toast.classList.add("show");

    // Clear existing timeout
    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }

    // Auto-hide after duration
    toastTimeout = setTimeout(function() {
      toast.classList.remove("show");
    }, duration);
  }

  function cancelContinuousMovement() {
    if (movementState.repeatTimer) {
      clearInterval(movementState.repeatTimer);
      movementState.repeatTimer = null;
    }
    movementState.isHolding = false;
    movementState.action = null;
    movementState.pointerId = null;
    movementState.vector = null;
  }

  function displayCameraFrame(base64Data) {
    var img = document.getElementById("camera-feed");
    if (img) {
      img.src = "data:image/jpeg;base64," + base64Data;
    }
  }

  function buildAbsolutePhotoUrl(photo) {
    if (!photo) return "";

    var origin = window.location.origin || (window.location.protocol + "//" + window.location.host);
    if (!origin) return photo.url || "";

    if (photo.url && photo.url.indexOf("http") === 0) {
      return photo.url;
    }

    var url = origin.replace(/\/+$/, "") + "/" + (photo.url || "").replace(/^\/+/, "");

    // Replace tablet's internal IP with Pepper's real IP
    if (url.indexOf("198.18.0.1") !== -1) {
      var pepperIp = window.location.hostname;
      url = url.replace("198.18.0.1", pepperIp);
    }
    return url;
  }

  function displayPhotos(photos) {
    var grid = document.getElementById("photos-grid");
    if (!grid) return;

    if (!photos || photos.length === 0) {
      grid.innerHTML = '<p class="placeholder-text">No photos yet. Take some with the camera!</p>';
      return;
    }

    grid.innerHTML = "";
    photos.forEach(function(photo) {
      var absoluteUrl = buildAbsolutePhotoUrl(photo);
      var item = document.createElement("div");
      item.className = "photo-item";
      item.innerHTML = '<img src="' + absoluteUrl + '" alt="Photo">';
      item.addEventListener("click", function() {
        window.open(absoluteUrl, "_blank");
      });
      grid.appendChild(item);
    });
  }

  function setStatus(text, connected) {
    if (!statusEl) return;
    statusEl.textContent = connected ? "[OK] " + text : "[!!] " + text;
  }

  // Poll animation status periodically when on motion page
  var animationStatusInterval = null;

  function startAnimationStatusPolling() {
    if (animationStatusInterval) return;
    animationStatusInterval = setInterval(function() {
      if (currentPage === "motion") {
        send("get_animation_status");
      }
    }, 1000); // Check every second
  }

  function stopAnimationStatusPolling() {
    if (animationStatusInterval) {
      clearInterval(animationStatusInterval);
      animationStatusInterval = null;
    }
  }

  // Motion Controls
  function setupMotionControls() {
    // Posture buttons
    var postureBtns = document.querySelectorAll('[data-command^="posture_"]');
    postureBtns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        var command = this.getAttribute("data-command");
        var posture = command.replace("posture_", "");
        send("go_to_posture", {posture: posture});
      });
    });

    // Dance buttons
    var danceBtns = document.querySelectorAll('[data-dance]');
    danceBtns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        var dance = this.getAttribute("data-dance");

        if (dance === "christmas") {
          // Disable button during dance
          btn.disabled = true;
          btn.innerHTML = '<span class="dance-icon">🎄</span><span class="dance-name">Dancing...</span><span class="dance-duration">~20s</span>';

          // Send christmas dance command
          send("christmas_dance", {});

          // Re-enable after 25 seconds (dance is ~20s + buffer)
          setTimeout(function() {
            btn.disabled = false;
            btn.innerHTML = '<span class="dance-icon">🎄</span><span class="dance-name">Christmas Dance</span><span class="dance-duration">~20s</span>';
          }, 25000);
        } else if (dance === "birthday") {
          // Disable button during dance
          btn.disabled = true;
          btn.innerHTML = '<span class="dance-icon">🎂</span><span class="dance-name">Dancing...</span><span class="dance-duration">~30s</span>';

          // Send birthday dance command
          send("birthday_dance", {});

          // Re-enable after 35 seconds (dance is ~30s + buffer)
          setTimeout(function() {
            btn.disabled = false;
            btn.innerHTML = '<span class="dance-icon">🎂</span><span class="dance-name">Birthday Dance</span><span class="dance-duration">~30s</span>';
          }, 35000);
        } else if (dance === "kungfu") {
          // Disable button during dance
          btn.disabled = true;
          btn.innerHTML = '<span class="dance-icon">⚡</span><span class="dance-name">Dancing...</span><span class="dance-duration">~60s</span>';

          // Send kung fu dance command
          send("kungfu_dance", {});

          // Re-enable after 65 seconds (dance is ~60s + buffer)
          setTimeout(function() {
            btn.disabled = false;
            btn.innerHTML = '<span class="dance-icon">⚡</span><span class="dance-name">Kung Fu Dance</span><span class="dance-duration">~1m</span>';
          }, 65000);
        } else if (dance === "robot") {
          // Disable button during dance
          btn.disabled = true;
          btn.innerHTML = '<span class="dance-icon">⚙</span><span class="dance-name">Dancing...</span><span class="dance-duration">~30s</span>';

          // Send robot dance command
          send("robot_dance", {});

          // Re-enable after 35 seconds (dance is ~30s + buffer)
          setTimeout(function() {
            btn.disabled = false;
            btn.innerHTML = '<span class="dance-icon">⚙</span><span class="dance-name">Robot Dance</span><span class="dance-duration">~30s</span>';
          }, 35000);
        } else if (dance === "gangnam") {
          // Disable button during dance
          btn.disabled = true;
          btn.innerHTML = '<span class="dance-icon">♪</span><span class="dance-name">Dancing...</span><span class="dance-duration">~40s</span>';

          // Send gangnam dance command
          send("gangnam_dance", {});

          // Re-enable after 45 seconds (dance is ~40s + buffer)
          setTimeout(function() {
            btn.disabled = false;
            btn.innerHTML = '<span class="dance-icon">♪</span><span class="dance-name">Gangnam Style</span><span class="dance-duration">~40s</span>';
          }, 45000);
        } else if (dance === "chacha") {
          // Disable button during dance
          btn.disabled = true;
          btn.innerHTML = '<span class="dance-icon">~</span><span class="dance-name">Dancing...</span><span class="dance-duration">~55s</span>';

          // Send chacha dance command
          send("chacha_dance", {});

          // Re-enable after 60 seconds (dance is ~55s + buffer)
          setTimeout(function() {
            btn.disabled = false;
            btn.innerHTML = '<span class="dance-icon">~</span><span class="dance-name">Cha Cha Slide</span><span class="dance-duration">~55s</span>';
          }, 60000);
        }
      });
    });

    // Gesture buttons
    var gestureBtns = document.querySelectorAll('[data-gesture]');
    gestureBtns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        // Prevent spamming - don't allow new gesture if one is already running
        if (currentGesture) {
          console.log("Gesture already in progress, ignoring click");
          return;
        }

        var gesture = this.getAttribute("data-gesture");
        showGestureModal(gesture);
        send("gesture", {name: gesture});
      });
    });

    // Movement buttons
    var movementBtns = document.querySelectorAll("[data-action]");
    var supportsPointerEvents = typeof window !== "undefined" && window.PointerEvent;

    movementBtns.forEach(function(btn) {
      var action = btn.getAttribute("data-action");
      if (!action) {
        return;
      }

      if (supportsPointerEvents) {
        btn.addEventListener("pointerdown", function(evt) {
          if (evt.isPrimary === false) return;
          evt.preventDefault();
          if (typeof this.setPointerCapture === "function") {
            try {
              this.setPointerCapture(evt.pointerId);
            } catch (captureErr) {
              console.log("Pointer capture failed:", captureErr);
            }
          }
          beginContinuousMovement(action, evt.pointerId);
        });

        btn.addEventListener("pointerup", function(evt) {
          if (evt.isPrimary === false) return;
          if (typeof this.releasePointerCapture === "function") {
            try {
              this.releasePointerCapture(evt.pointerId);
            } catch (releaseErr) {
              console.log("Pointer release failed:", releaseErr);
            }
          }
          endContinuousMovement(action, evt.pointerId);
        });

        btn.addEventListener("pointercancel", function(evt) {
          if (evt.isPrimary === false) return;
          if (typeof this.releasePointerCapture === "function") {
            try {
              this.releasePointerCapture(evt.pointerId);
            } catch (releaseErr) {
              console.log("Pointer release failed:", releaseErr);
            }
          }
          endContinuousMovement(action, evt.pointerId);
        });
      } else {
        btn.addEventListener("mousedown", function(evt) {
          if (evt.button !== 0) return;
          evt.preventDefault();
          beginContinuousMovement(action);
        });

        btn.addEventListener("touchstart", function(evt) {
          if (evt.changedTouches && evt.changedTouches.length > 0) {
            evt.preventDefault();
          }
          beginContinuousMovement(action);
        }, {passive: false});

        ["mouseup", "mouseleave"].forEach(function(eventName) {
          btn.addEventListener(eventName, function() {
            endContinuousMovement(action);
          });
        });

        ["touchend", "touchcancel"].forEach(function(eventName) {
          btn.addEventListener(eventName, function(evt) {
            if (evt.changedTouches && evt.changedTouches.length > 0) {
              evt.preventDefault();
            }
            endContinuousMovement(action);
          });
        });
      }

      // Prevent synthetic click events after pointer interactions
      btn.addEventListener("click", function(evt) {
        evt.preventDefault();
      });
    });

    if (supportsPointerEvents) {
      window.addEventListener("pointerup", function(evt) {
        if (evt.isPrimary === false) return;
        if (!movementState.isHolding) return;
        endContinuousMovement(movementState.action, evt.pointerId);
      });
    } else {
      window.addEventListener("mouseup", function() {
        if (!movementState.isHolding) return;
        endContinuousMovement(movementState.action);
      });
      window.addEventListener("touchend", function() {
        if (!movementState.isHolding) return;
        endContinuousMovement(movementState.action);
      }, {passive: true});
      window.addEventListener("touchcancel", function() {
        if (!movementState.isHolding) return;
        endContinuousMovement(movementState.action);
      }, {passive: true});
    }
  }

  function beginContinuousMovement(action, pointerId) {
    var vector = getMovementVector(action);
    if (!vector) return;

    if (movementState.repeatTimer) {
      clearInterval(movementState.repeatTimer);
      movementState.repeatTimer = null;
    }

    movementState.isHolding = true;
    movementState.action = action;
    movementState.pointerId = typeof pointerId === "number" ? pointerId : null;
    movementState.vector = vector;
    sendMoveCommand(vector);

    movementState.repeatTimer = setInterval(function() {
      if (!movementState.isHolding || !movementState.vector) {
        return;
      }
      sendMoveCommand(movementState.vector);
    }, 100);
  }

  function endContinuousMovement(action, pointerId) {
    if (typeof pointerId === "number" && movementState.pointerId !== null && pointerId !== movementState.pointerId) {
      return;
    }

    if (action && movementState.action && action !== movementState.action) {
      return;
    }

    if (!movementState.isHolding) {
      return;
    }

    if (movementState.repeatTimer) {
      clearInterval(movementState.repeatTimer);
      movementState.repeatTimer = null;
    }

    movementState.isHolding = false;
    movementState.action = null;
    movementState.vector = null;
    movementState.pointerId = null;
    sendStopMovement();
  }

  function getMovementVector(action) {
    var speedSlider = document.getElementById("movement-speed-slider");
    var speedMultiplier = speedSlider ? parseFloat(speedSlider.value) : 1.0;

    // Scale rotation to max 2.0 when speed is 3.0 (ratio: 2/3)
    var rotationMultiplier = speedMultiplier * (2.0 / 3.0);

    switch (action) {
      case "forward":
        return {x: speedMultiplier, y: 0, theta: 0};
      case "backward":
        return {x: -speedMultiplier, y: 0, theta: 0};
      case "turn_left":
        return {x: 0, y: 0, theta: rotationMultiplier};
      case "turn_right":
        return {x: 0, y: 0, theta: -rotationMultiplier};
      default:
        return null;
    }
  }

  function sendMoveCommand(vector) {
    if (!vector) return;

    console.log("Movement vector:", vector);
    send("move", {
      x: vector.x,
      y: vector.y,
      theta: vector.theta
    });
  }

  function sendStopMovement() {
    sendMoveCommand({x: 0, y: 0, theta: 0});
  }

  // Camera Controls
  var cameraStreamInterval;
  var staticHeadEnabled = false;
  var staticHeadBusy = false;

  function setupCameraControls() {
    var captureBtn = document.getElementById("capture-btn");
    if (captureBtn) {
      captureBtn.addEventListener("click", function() {
        takePhoto();
      });
    }

    var staticHeadBtn = document.getElementById("static-head-btn");
    if (staticHeadBtn) {
      staticHeadBtn.addEventListener("click", function() {
        toggleStaticHead();
      });
    }

    // Head control buttons - hold to move
    var headBtns = document.querySelectorAll(".head-btn");
    var headMoveInterval = null;
    var currentHeadDirection = null;

    headBtns.forEach(function(btn) {
      var direction = btn.getAttribute("data-head");

      // Handle center button differently (single click)
      if (direction === "center") {
        btn.addEventListener("click", function() {
          send("move_head", { yaw: 0, pitch: 0 });
        });
        return;
      }

      // Touch/mouse down - start moving
      var startMove = function() {
        currentHeadDirection = direction;

        // Send first command immediately
        sendHeadMoveCommand(direction);

        // Continue sending commands while held (every 100ms)
        headMoveInterval = setInterval(function() {
          sendHeadMoveCommand(direction);
        }, 100);
      };

      // Touch/mouse up - stop moving
      var stopMove = function() {
        currentHeadDirection = null;
        if (headMoveInterval) {
          clearInterval(headMoveInterval);
          headMoveInterval = null;
        }
      };

      // Desktop: mousedown/mouseup
      btn.addEventListener("mousedown", startMove);
      btn.addEventListener("mouseup", stopMove);
      btn.addEventListener("mouseleave", stopMove); // Stop if mouse leaves button

      // Mobile: touchstart/touchend
      btn.addEventListener("touchstart", function(e) {
        e.preventDefault(); // Prevent mouse events
        startMove();
      });
      btn.addEventListener("touchend", function(e) {
        e.preventDefault();
        stopMove();
      });
    });

    // Request static head status when camera page opens
    send("get_static_head_status");
  }

  function sendHeadMoveCommand(direction) {
    // Smaller, more frequent increments for smooth movement
    var commands = {
      "up": { yaw: 0, pitch: -0.05 },     // Look up (negative pitch)
      "down": { yaw: 0, pitch: 0.05 },    // Look down (positive pitch)
      "left": { yaw: 0.08, pitch: 0 },    // Look left
      "right": { yaw: -0.08, pitch: 0 }   // Look right
    };

    var cmd = commands[direction];
    if (cmd) {
      send("move_head", { yaw: cmd.yaw, pitch: cmd.pitch });
    }
  }

  function toggleStaticHead() {
    if (staticHeadBusy) return;

    staticHeadBusy = true;
    updateStaticHeadButton();

    if (staticHeadEnabled) {
      send("disable_static_head");
    } else {
      send("enable_static_head");
    }
  }

  function updateStaticHeadButton() {
    var btn = document.getElementById("static-head-btn");
    if (!btn) return;

    var emoji = staticHeadEnabled ? "🔓" : "🔒";
    var label = staticHeadEnabled ? "Unlock Head" : "Static Head";

    // Update button content (supports both old and new HTML structure)
    var spans = btn.querySelectorAll("span");
    if (spans.length >= 2) {
      spans[0].textContent = emoji;
      spans[1].textContent = label;
    } else {
      btn.textContent = emoji + " " + label;
    }

    if (staticHeadEnabled) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }

    btn.disabled = staticHeadBusy;
  }

  function startCameraStream() {
    var preview = document.getElementById("camera-preview");
    if (!preview) return;

    // Clear existing content
    preview.innerHTML = '<img id="camera-feed" alt="Camera feed">';
    var img = preview.querySelector("img");

    // Request camera frames periodically
    cameraStreamInterval = setInterval(function() {
      if (currentPage === "camera") {
        send("get_camera_frame");
      }
    }, 500); // 2 FPS

    // Stop stream when leaving page
    window.addEventListener("beforeunload", stopCameraStream);
  }

  function stopCameraStream() {
    if (cameraStreamInterval) {
      clearInterval(cameraStreamInterval);
      cameraStreamInterval = null;
    }
  }

  function takePhoto() {
    var countdownEl = document.getElementById("countdown-display");
    var count = 3;

    countdownEl.textContent = count;

    var countdownInterval = setInterval(function() {
      count--;
      if (count > 0) {
        countdownEl.textContent = count;
      } else {
        clearInterval(countdownInterval);
        countdownEl.textContent = "📸";
        send("capture_photo");

        setTimeout(function() {
          countdownEl.textContent = "";
          // Switch to photos page after capture
          setTimeout(function() {
            switchPage("photos");
          }, 1000);
        }, 500);
      }
    }, 1000);
  }

  // Photos Controls
  function setupPhotosControls() {
    var refreshBtn = document.getElementById("refresh-photos-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function() {
        loadPhotos();
      });
    }
  }

  function loadPhotos() {
    // Request photo list from server
    send("list_photos");
    // Server will respond with photo data that we handle in handleMessage
  }

  // TTS Controls
  function setupTTSControls() {
    // Quick phrase buttons
    var phraseButtons = document.querySelectorAll('.tts-phrase-btn');
    phraseButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var phrase = this.getAttribute('data-phrase');
        if (phrase) {
          send('speak', {text: phrase});
          // Visual feedback
          btn.style.transform = 'scale(0.95)';
          setTimeout(function() {
            btn.style.transform = '';
          }, 150);
        }
      });
    });

    // Custom text speak button
    var speakBtn = document.getElementById('tts-speak-btn');
    var ttsInput = document.getElementById('tts-input');
    if (speakBtn && ttsInput) {
      speakBtn.addEventListener('click', function() {
        var text = ttsInput.value.trim();
        if (text) {
          send('speak', {text: text});
          // Optional: clear input after sending
          // ttsInput.value = '';
        } else {
          showToast('Please enter some text');
        }
      });

      // Allow Enter key to speak (Shift+Enter for new line)
      ttsInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          speakBtn.click();
        }
      });
    }
  }

  // LED Controls
  function setupLEDControls() {
    var ledButtons = document.querySelectorAll('[data-led-action]');
    ledButtons.forEach(function(btn) {
      btn.addEventListener("click", function() {
        var group = this.getAttribute("data-led-group");
        var action = this.getAttribute("data-led-action");
        var duration = parseFloat(this.getAttribute("data-duration") || "0.8");
        var intensity = parseFloat(this.getAttribute("data-intensity") || "1.0");
        var color = this.getAttribute("data-color");

        var payload = {group: group};

        switch (action) {
          case "on":
            send("led_on", payload);
            break;
          case "off":
            send("led_off", payload);
            break;
          case "fade":
            payload.intensity = intensity;
            payload.duration = duration;
            send("led_fade", payload);
            break;
          case "color":
            payload.color = color;
            payload.duration = duration;
            send("led_color", payload);
            break;
          case "rotate":
            payload.color = color;
            payload.duration = duration;
            payload.speed = 1.0;
            send("led_rotate", payload);
            break;
          case "rasta":
            payload.duration = duration;
            send("led_rasta", payload);
            break;
          case "random":
            var randomColor = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
            payload.color = randomColor;
            payload.duration = 0.6;
            send("led_color", payload);
            break;
          default:
            console.log("Unknown LED action:", action);
        }

        // Visual feedback
        btn.style.transform = "scale(0.95)";
        setTimeout(function() {
          btn.style.transform = "";
        }, 150);
      });
    });
  }

  // Settings
  function setupSettings() {
    if (pepperIpEl) {
      pepperIpEl.value = host;
    }

    var volumeSlider = document.getElementById("volume-slider");
    var volumeValue = document.getElementById("volume-value");
    var speedSlider = document.getElementById("speed-slider");
    var speedValue = document.getElementById("speed-value");
    var pitchSlider = document.getElementById("pitch-slider");
    var pitchValue = document.getElementById("pitch-value");
    var movementSpeedSlider = document.getElementById("movement-speed-slider");
    var movementSpeedValue = document.getElementById("movement-speed-value");
    var headTrackingToggle = document.getElementById("head-tracking-toggle");

    // Volume slider
    if (volumeSlider && volumeValue) {
      volumeSlider.addEventListener("input", function() {
        volumeValue.textContent = this.value + "%";
      });

      volumeSlider.addEventListener("change", function() {
        var volumePercent = parseInt(this.value);
        send("set_volume", {volume_percent: volumePercent});
        // Announce volume change like tablet does
        send("speak", {text: "Volume set to " + volumePercent + " percent."});
      });
    }

    // Speed slider
    if (speedSlider && speedValue) {
      speedSlider.addEventListener("input", function() {
        speedValue.textContent = this.value + "%";
      });

      speedSlider.addEventListener("change", function() {
        var speedPercent = parseInt(this.value);
        send("set_speed", {speed: speedPercent});
        // Announce speed change like tablet does
        send("speak", {text: "Speech speed set to " + speedPercent + " percent."});
      });
    }

    // Pitch slider
    if (pitchSlider && pitchValue) {
      pitchSlider.addEventListener("input", function() {
        var pitchPercent = parseInt(this.value);
        var multiplier = (pitchPercent / 100).toFixed(1);
        pitchValue.textContent = multiplier + "×";
      });

      pitchSlider.addEventListener("change", function() {
        var pitchPercent = parseInt(this.value);
        var multiplier = pitchPercent / 100;
        send("set_pitch", {pitch: multiplier});
        // Announce pitch change like tablet does
        var multiplierText = multiplier.toFixed(1);
        send("speak", {text: "Pitch set to " + multiplierText + " times."});
      });
    }

    // Movement speed slider
    if (movementSpeedSlider && movementSpeedValue) {
      movementSpeedSlider.addEventListener("input", function() {
        movementSpeedValue.textContent = parseFloat(this.value).toFixed(1) + "×";
      });
    }

    // Head tracking toggle
    if (headTrackingToggle) {
      headTrackingToggle.addEventListener("change", function() {
        if (headTrackingToggle.disabled) return;
        var enabled = this.checked;
        var command = enabled ? "start_head_tracking" : "stop_head_tracking";
        send(command);
        // Announce head tracking change like tablet does
        send("speak", {text: enabled ? "Head tracking enabled." : "Head tracking disabled."});
      });
    }

    // ======================================
    // NAVIGATION PAGE HANDLERS
    // ======================================

    // Location buttons
    var locationBtns = document.querySelectorAll(".nav-location-btn");
    locationBtns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        var location = this.getAttribute("data-location");
        if (location) {
          console.log("Navigating to:", location);
          showToast("Navigating to " + location.replace(/_/g, " ") + "...", 2000);
          send("navigate_to_location", { location: location });
        }
      });
    });

    // Navigation control buttons
    var navCancelBtn = document.getElementById("nav-cancel-btn");
    if (navCancelBtn) {
      navCancelBtn.addEventListener("click", function() {
        send("cancel_navigation");
        showToast("Navigation cancelled", 2000);
      });
    }

    var navReturnHomeBtn = document.getElementById("nav-return-home-btn");
    if (navReturnHomeBtn) {
      navReturnHomeBtn.addEventListener("click", function() {
        send("return_to_home");
        showToast("Returning to home...", 2000);
      });
    }

    var navRefreshStatusBtn = document.getElementById("nav-refresh-status-btn");
    if (navRefreshStatusBtn) {
      navRefreshStatusBtn.addEventListener("click", function() {
        updateNavigationStatus();
      });
    }

    var navStartLocalizationBtn = document.getElementById("nav-start-localization-btn");
    if (navStartLocalizationBtn) {
      navStartLocalizationBtn.addEventListener("click", function() {
        send("start_localization");
        showToast("Starting localization...", 2000);
        setTimeout(updateNavigationStatus, 1000);
      });
    }

    var navSetHomeBtn = document.getElementById("nav-set-home-btn");
    if (navSetHomeBtn) {
      navSetHomeBtn.addEventListener("click", function() {
        send("set_home");
        showToast("Home position set", 2000);
      });
    }

    var navGetPositionBtn = document.getElementById("nav-get-position-btn");
    if (navGetPositionBtn) {
      navGetPositionBtn.addEventListener("click", function() {
        send("get_robot_position");
      });
    }

    // Update navigation status display
    function updateNavigationStatus() {
      send("get_navigation_status");
    }

    // Auto-update navigation status when on navigation page
    var navStatusInterval = null;
    document.querySelectorAll('.nav-btn[data-page="navigation"]').forEach(function(btn) {
      var originalClick = btn.onclick;
      btn.addEventListener("click", function() {
        // When navigation page is shown, start auto-updating status
        updateNavigationStatus();
        if (navStatusInterval) clearInterval(navStatusInterval);
        navStatusInterval = setInterval(updateNavigationStatus, 3000);
      });
    });

    // Stop auto-updating when leaving navigation page
    document.querySelectorAll('.nav-btn:not([data-page="navigation"])').forEach(function(btn) {
      btn.addEventListener("click", function() {
        if (navStatusInterval) {
          clearInterval(navStatusInterval);
          navStatusInterval = null;
        }
      });
    });
  }

  // Handle navigation status responses
  function handleNavigationStatusResponse(payload) {
    if (payload.status) {
      var status = payload.status;
      var localizedEl = document.getElementById("nav-localized-status");
      var navigatingEl = document.getElementById("nav-navigating-status");
      var positionEl = document.getElementById("nav-position-status");

      if (localizedEl) {
        localizedEl.textContent = status.is_localizing ? "Yes" : "No";
        localizedEl.style.color = status.is_localizing ? "#34d399" : "#ef4444";
      }

      if (navigatingEl) {
        navigatingEl.textContent = status.is_navigating ? "Yes" : "No";
        navigatingEl.style.color = status.is_navigating ? "#34d399" : "#666";
      }

      if (positionEl && status.position) {
        var pos = status.position;
        positionEl.textContent = "(" + pos.x.toFixed(2) + ", " + pos.y.toFixed(2) + ", " + pos.theta.toFixed(2) + ")";
      } else if (positionEl) {
        positionEl.textContent = "Not localized";
      }
    }
  }

  // Handle position responses
  function handlePositionResponse(payload) {
    if (payload.position) {
      var pos = payload.position;
      showToast("Position: (" + pos.x.toFixed(2) + ", " + pos.y.toFixed(2) + ", " + pos.theta.toFixed(2) + ")", 3000);
    } else {
      showToast("Robot not localized", 2000);
    }
  }

  // Video Controls
  function setupVideoControls() {
    var videoUrlInput = document.getElementById("video-url-input");
    var videoPlayBtn = document.getElementById("video-play-btn");
    var videoCurrentId = document.getElementById("video-current-id");
    var videoTabletStatus = document.getElementById("video-tablet-status");
    var presetBtns = document.querySelectorAll(".preset-btn");

    // Extract video ID from YouTube URL
    function extractVideoId(url) {
      var match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
      return match ? match[1] : null;
    }

    // Play button click
    if (videoPlayBtn && videoUrlInput) {
      videoPlayBtn.addEventListener("click", function() {
        var url = videoUrlInput.value.trim();
        if (!url) {
          showToast("Please enter a YouTube URL", 2000);
          return;
        }

        var videoId = extractVideoId(url);
        if (!videoId) {
          showToast("Invalid YouTube URL", 2000);
          return;
        }

        // Send to tablet via WebSocket
        send("set_video", { url: url, video_id: videoId });

        // Update UI
        if (videoCurrentId) {
          videoCurrentId.textContent = videoId;
        }
        if (videoTabletStatus) {
          videoTabletStatus.textContent = "Sending...";
          videoTabletStatus.style.color = "#fbbf24";
        }

        showToast("Sending video to tablet...", 2000);

        // Update status after a short delay
        setTimeout(function() {
          if (videoTabletStatus) {
            videoTabletStatus.textContent = "Playing";
            videoTabletStatus.style.color = "#34d399";
          }
        }, 1500);
      });
    }

    // Preset button clicks
    presetBtns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        var url = this.getAttribute("data-url");
        if (videoUrlInput && url) {
          videoUrlInput.value = url;
          // Auto-play when preset is clicked
          if (videoPlayBtn) {
            videoPlayBtn.click();
          }
        }
      });
    });

    // Update tablet status based on connection
    if (videoTabletStatus) {
      videoTabletStatus.textContent = "Waiting for connection";
    }
  }

  // Video download progress handlers
  function handleVideoDownloadStarted(payload) {
    var videoId = payload.video_id || "Unknown";
    var progressContainer = document.getElementById("video-progress-container");
    var progressText = document.getElementById("video-progress-text");
    var progressBar = document.getElementById("video-progress-bar");
    var videoTabletStatus = document.getElementById("video-tablet-status");
    var videoCurrentId = document.getElementById("video-current-id");

    if (progressContainer) {
      progressContainer.style.display = "block";
    }
    if (progressText) {
      progressText.textContent = "Starting download...";
    }
    if (progressBar) {
      progressBar.style.width = "0%";
    }
    if (videoTabletStatus) {
      videoTabletStatus.textContent = "Downloading";
      videoTabletStatus.style.color = "#fbbf24";
    }
    if (videoCurrentId) {
      videoCurrentId.textContent = videoId;
    }
  }

  function handleVideoProgress(payload) {
    var percent = payload.percent || 0;
    var eta = payload.eta || "Unknown";
    var speed = payload.speed || "";
    var progressBar = document.getElementById("video-progress-bar");
    var progressText = document.getElementById("video-progress-text");
    var progressSpeed = document.getElementById("video-progress-speed");

    if (progressBar) {
      progressBar.style.width = percent + "%";
    }
    if (progressText) {
      progressText.textContent = "Downloading: " + Math.round(percent) + "% (ETA: " + eta + ")";
    }
    if (progressSpeed) {
      progressSpeed.textContent = speed;
    }
  }

  function handleVideoDownloadFailed(payload) {
    var videoId = payload.video_id || "Unknown";
    var progressContainer = document.getElementById("video-progress-container");
    var progressText = document.getElementById("video-progress-text");
    var videoTabletStatus = document.getElementById("video-tablet-status");

    if (progressContainer) {
      progressContainer.style.display = "block";
    }
    if (progressText) {
      progressText.textContent = "Download failed!";
      progressText.style.color = "#ef4444";
    }
    if (videoTabletStatus) {
      videoTabletStatus.textContent = "Download Failed";
      videoTabletStatus.style.color = "#ef4444";
    }
    showToast("Video download failed: " + videoId, 3000);

    // Hide progress after 5 seconds
    setTimeout(function() {
      if (progressContainer) {
        progressContainer.style.display = "none";
      }
    }, 5000);
  }

  function handleVideoReady(payload) {
    var videoId = payload.video_id || "Unknown";
    var cached = payload.cached || false;
    var progressContainer = document.getElementById("video-progress-container");
    var progressText = document.getElementById("video-progress-text");
    var progressBar = document.getElementById("video-progress-bar");
    var videoTabletStatus = document.getElementById("video-tablet-status");
    var videoCurrentId = document.getElementById("video-current-id");

    if (cached && progressBar) {
      progressBar.style.width = "100%";
    }
    if (progressText) {
      progressText.textContent = "Download complete!";
      progressText.style.color = "#34d399";
    }
    if (videoTabletStatus) {
      videoTabletStatus.textContent = "Playing";
      videoTabletStatus.style.color = "#34d399";
    }
    if (videoCurrentId) {
      videoCurrentId.textContent = videoId;
    }

    showToast("Video is now playing on tablet", 2000);

    // Hide progress after 3 seconds
    setTimeout(function() {
      if (progressContainer) {
        progressContainer.style.display = "none";
      }
    }, 3000);
  }

  // Start the app
  init();
})();
