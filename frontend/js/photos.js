(function() {
  var ws;
  var statusEl = document.getElementById("status-pill");
  var photosSections = document.getElementById("photos-sections");
  var loadingState = document.getElementById("loading-state");
  var emptyState = document.getElementById("empty-state");
  var photoModal = document.getElementById("photo-modal");
  var modalContent = document.getElementById("modal-content");
  var modalClose = document.getElementById("modal-close");
  var modalPrev = document.getElementById("modal-prev");
  var modalNext = document.getElementById("modal-next");
  var modalDownload = document.getElementById("modal-download");
  var qrModal = document.getElementById("qr-modal");
  var qrImage = document.getElementById("qr-image");
  var qrClose = document.getElementById("qr-close");
  var downloadAllBtn = document.getElementById("download-all-btn");
  var reconnectDelay = 3000;
  var photos = [];
  var currentPhotoIndex = -1;
  var touchStartX = 0;
  var touchEndX = 0;

  function setStatus(text, emoji) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = (emoji || "") + " " + text;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function getDateLabel(timestamp) {
    var date = new Date(timestamp * 1000);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    var photoDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (photoDate.getTime() === today.getTime()) {
      return "Today";
    } else if (photoDate.getTime() === yesterday.getTime()) {
      return "Yesterday";
    } else {
      var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      return months[date.getMonth()] + " " + date.getDate() + ", " + date.getFullYear();
    }
  }

  function formatTime(timestamp) {
    var date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }

  function buildAbsolutePhotoUrl(photo) {
    if (!photo) {
      return "";
    }
    var origin = window.location.origin || (window.location.protocol + "//" + window.location.host);
    if (!origin) {
      return photo.url || "";
    }
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

  function requestBackendQR(absoluteUrl) {
    console.log("Requesting backend QR code generation for:", absoluteUrl);
    sendJson({
      command: "generate_qr_code",
      url: absoluteUrl
    });
  }

  function openQrModal() {
    if (!qrModal || !qrImage) {
      console.error("QR modal or image element not found");
      return;
    }
    if (currentPhotoIndex < 0 || currentPhotoIndex >= photos.length) {
      console.error("Invalid photo index:", currentPhotoIndex);
      return;
    }
    var photo = photos[currentPhotoIndex];
    if (!photo) {
      console.error("No photo found at index:", currentPhotoIndex);
      return;
    }
    var absoluteUrl = buildAbsolutePhotoUrl(photo);
    if (!absoluteUrl) {
      console.error("Failed to build absolute URL for photo:", photo);
      return;
    }

    console.log("Opening QR modal for photo:", photo.filename);
    console.log("Absolute URL:", absoluteUrl);

    qrModal.classList.add("show");
    qrImage.src = "";
    qrImage.alt = "Generating QR code...";
    requestBackendQR(absoluteUrl);
  }

  function closeQrModal() {
    if (!qrModal) {
      return;
    }
    qrModal.classList.remove("show");
    if (qrImage) {
      qrImage.removeAttribute("src");
    }
  }

  function downloadAllPhotos() {
    console.log("Requesting gallery creation for all photos");
    if (downloadAllBtn) {
      downloadAllBtn.textContent = "Creating gallery...";
      downloadAllBtn.disabled = true;
    }
    sendJson({
      command: "create_photos_gallery"
    });
  }

  function groupPhotosByDate(photoList) {
    var groups = {};
    for (var i = 0; i < photoList.length; i++) {
      var photo = photoList[i];
      var label = getDateLabel(photo.modified);
      if (!groups[label]) {
        groups[label] = [];
      }
      groups[label].push(photo);
    }
    return groups;
  }

  function displayPhotos(photoList) {
    photos = photoList;

    if (loadingState) {
      loadingState.style.display = "none";
    }

    if (!photoList || photoList.length === 0) {
      if (emptyState) {
        emptyState.style.display = "block";
      }
      if (photosSections) {
        photosSections.innerHTML = "";
      }
      if (downloadAllBtn) {
        downloadAllBtn.style.display = "none";
      }
      return;
    }

    if (emptyState) {
      emptyState.style.display = "none";
    }
    if (downloadAllBtn) {
      downloadAllBtn.style.display = "block";
      downloadAllBtn.textContent = "📦 Download All";
      downloadAllBtn.disabled = false;
    }

    if (!photosSections) {
      return;
    }

    var groups = groupPhotosByDate(photoList);
    var labels = [];
    for (var label in groups) {
      labels.push(label);
    }

    var html = "";
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      var groupPhotos = groups[label];

      html += "<div class=\"photos-section\">";
      html += "  <div class=\"photos-section-header\">" + label + "</div>";
      html += "  <div class=\"photos-grid\">";

      for (var j = 0; j < groupPhotos.length; j++) {
        var photo = groupPhotos[j];
        var index = photoList.indexOf(photo);

        html += "    <div class=\"photo-item\" data-index=\"" + index + "\">";
        html += "      <div class=\"photo-item-inner\">";
        html += "        <img src=\"" + photo.url + "\" alt=\"\" />";
        html += "      </div>";
        html += "    </div>";
      }

      html += "  </div>";
      html += "</div>";
    }

    photosSections.innerHTML = html;

    var items = photosSections.querySelectorAll(".photo-item");
    for (var k = 0; k < items.length; k++) {
      items[k].addEventListener("click", function() {
        var index = parseInt(this.getAttribute("data-index"), 10);
        openPhoto(index);
      });
    }
  }

  function openPhoto(index) {
    if (index < 0 || index >= photos.length) {
      return;
    }

    currentPhotoIndex = index;
    showPhotoAtIndex(index);

    if (photoModal) {
      photoModal.classList.add("show");
    }

    updateNavButtons();
  }

  function showPhotoAtIndex(index) {
    if (index < 0 || index >= photos.length || !modalContent) {
      return;
    }

    var photo = photos[index];
    var dateLabel = getDateLabel(photo.modified);
    var timeLabel = formatTime(photo.modified);

    var html = "";
    html += "<img src=\"" + photo.url + "\" alt=\"\" />";
    html += "<button class=\"photo-modal-nav prev\" id=\"modal-prev\">&lt;</button>";
    html += "<button class=\"photo-modal-nav next\" id=\"modal-next\">&gt;</button>";
    html += "<div class=\"photo-modal-info\">";
    html += "  <div class=\"photo-info-title\">" + dateLabel + " at " + timeLabel + "</div>";
    html += "  <div class=\"photo-info-details\">" + formatFileSize(photo.size) + "</div>";
    html += "</div>";

    modalContent.innerHTML = html;

    modalPrev = document.getElementById("modal-prev");
    modalNext = document.getElementById("modal-next");

    if (modalPrev) {
      modalPrev.addEventListener("click", showPrevPhoto);
    }
    if (modalNext) {
      modalNext.addEventListener("click", showNextPhoto);
    }
    if (modalDownload) {
      modalDownload.disabled = false;
    }
  }

  function updateNavButtons() {
    if (modalPrev) {
      modalPrev.style.display = currentPhotoIndex > 0 ? "block" : "none";
    }
    if (modalNext) {
      modalNext.style.display = currentPhotoIndex < photos.length - 1 ? "block" : "none";
    }
  }

  function showPrevPhoto() {
    if (currentPhotoIndex > 0) {
      currentPhotoIndex--;
      showPhotoAtIndex(currentPhotoIndex);
      updateNavButtons();
    }
  }

  function showNextPhoto() {
    if (currentPhotoIndex < photos.length - 1) {
      currentPhotoIndex++;
      showPhotoAtIndex(currentPhotoIndex);
      updateNavButtons();
    }
  }

  function closePhoto() {
    if (photoModal) {
      photoModal.classList.remove("show");
    }
    if (modalDownload) {
      modalDownload.disabled = true;
    }
    closeQrModal();
    currentPhotoIndex = -1;
  }

  function handleSwipe() {
    var swipeThreshold = 50;
    var diff = touchEndX - touchStartX;

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        showPrevPhoto();
      } else {
        showNextPhoto();
      }
    }
  }

  function loadPhotos() {
    if (!ws || ws.readyState !== 1) {
      setTimeout(loadPhotos, 1000);
      return;
    }
    send("list_photos");
  }

  function handleAck(payload) {
    var cmd = payload.command || "";

    if (payload.ok) {
      if (!cmd || cmd === "start_audio" || cmd === "stop_audio") {
        return;
      }

      if (cmd === "list_photos") {
        console.log("Photos loaded:", payload);
        displayPhotos(payload.photos || []);
      }

      if (cmd === "generate_qr_code") {
        console.log("QR code received from backend");
        if (payload.qr_image && qrImage) {
          qrImage.src = payload.qr_image;
          qrImage.alt = "QR code for photo download";
          console.log("QR code image set successfully");
        } else {
          console.error("No QR image in response:", payload);
        }
      }

      if (cmd === "create_photos_gallery") {
        console.log("Gallery created:", payload);
        if (payload.gallery_url) {
          var absoluteGalleryUrl = buildAbsolutePhotoUrl({url: payload.gallery_url});
          console.log("Gallery URL:", absoluteGalleryUrl);
          console.log("Opening QR modal for gallery");

          if (qrModal && qrImage) {
            qrModal.classList.add("show");
            qrImage.src = "";
            qrImage.alt = "Generating QR code for gallery...";
            requestBackendQR(absoluteGalleryUrl);
          }
        }
        if (downloadAllBtn) {
          downloadAllBtn.textContent = "📦 Download All";
          downloadAllBtn.disabled = false;
        }
      }
    } else {
      if (cmd === "list_photos") {
        console.error("Failed to load photos:", payload.error);
        if (loadingState) {
          loadingState.textContent = "Failed to load photos";
        }
      }

      if (cmd === "generate_qr_code") {
        console.error("Failed to generate QR code:", payload.error);
        if (payload.suggestion) {
          console.log("Suggestion:", payload.suggestion);
        }
        if (qrImage) {
          qrImage.alt = "QR code generation failed";
        }
      }

      if (cmd === "create_photos_gallery") {
        console.error("Failed to create gallery:", payload.error);
        if (downloadAllBtn) {
          downloadAllBtn.textContent = "📦 Download All";
          downloadAllBtn.disabled = false;
        }
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
      loadPhotos();
    };

    ws.onclose = function() {
      setStatus("Connection closed", "[!!]");
      retry();
    };

    ws.onerror = function(e) {
      console.log("WebSocket error:", e);
      setStatus("Connection error", "[!!]");
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

  function sendJson(payload) {
    if (!ws || ws.readyState !== 1) {
      console.error("WebSocket not connected");
      return false;
    }
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error("sendJson error:", err);
      return false;
    }
  }

  if (modalClose) {
    modalClose.addEventListener("click", closePhoto);
  }
  if (modalDownload) {
    modalDownload.disabled = true;
    modalDownload.addEventListener("click", function(e) {
      e.preventDefault();
      openQrModal();
    });
  }
  if (qrClose) {
    qrClose.addEventListener("click", function(e) {
      e.preventDefault();
      closeQrModal();
    });
  }
  if (qrModal) {
    qrModal.addEventListener("click", function(e) {
      if (e.target === qrModal) {
        closeQrModal();
      }
    });
  }
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener("click", function(e) {
      e.preventDefault();
      downloadAllPhotos();
    });
  }

  if (photoModal) {
    photoModal.addEventListener("click", function(e) {
      if (e.target === photoModal) {
        closePhoto();
      }
    });

    photoModal.addEventListener("touchstart", function(e) {
      touchStartX = e.changedTouches[0].screenX;
    });

    photoModal.addEventListener("touchend", function(e) {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipe();
    });
  }

  setStatus("Connecting...", "[--]");
  connect();
})();
