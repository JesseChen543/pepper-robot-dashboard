/**
 * dance-popup.js - Dance Status Popup Handler v4
 *
 * Listens for dance command ack messages and shows/hides popup
 * with dance name, duration, and stop button.
 */

(function() {
  'use strict';

  console.log('[DancePopup] Script loaded v4');

  var popup = document.getElementById('dance-popup');
  var title = document.getElementById('dance-popup-title');
  var message = document.getElementById('dance-popup-message');
  var stopBtn = document.getElementById('dance-stop-btn');
  var currentWs = null;
  var danceTimeout = null;

  if (!popup || !title || !message || !stopBtn) {
    console.warn('[DancePopup] Popup elements not found - dance popup disabled');
    return;
  }

  console.log('[DancePopup] Popup elements found');

  // Dance name mapping
  var danceNames = {
    'christmas_dance': 'Christmas Dance',
    'birthday_dance': 'Birthday Dance',
    'kungfu_dance': 'Kung Fu Dance',
    'robot_dance': 'Robot Dance',
    'gangnam_dance': 'Gangnam Style',
    'chacha_dance': 'Cha Cha Slide'
  };

  /**
   * Show dance popup with dance name and duration
   */
  function showDancePopup(danceName, duration) {
    title.textContent = 'Performing ' + danceName;
    message.textContent = 'Duration: ~' + duration + ' seconds';
    popup.style.display = 'flex';
    console.log('[DancePopup] SHOWING popup for:', danceName, 'duration:', duration);

    // Auto-hide after duration + buffer
    if (danceTimeout) {
      clearTimeout(danceTimeout);
    }
    danceTimeout = setTimeout(function() {
      hideDancePopup();
    }, (duration + 5) * 1000);
  }

  /**
   * Hide dance popup
   */
  function hideDancePopup() {
    popup.style.display = 'none';
    if (danceTimeout) {
      clearTimeout(danceTimeout);
      danceTimeout = null;
    }
    console.log('[DancePopup] Popup hidden');
  }

  /**
   * Handle incoming WebSocket message
   */
  function handleMessage(event) {
    try {
      var data = JSON.parse(event.data);

      // Check for dance ack message (type: 'ack' with action containing '_dance_started')
      if (data.type === 'ack' && data.action && data.action.indexOf('_dance_started') !== -1) {
        console.log('[DancePopup] *** DANCE ACK RECEIVED ***', data);

        // Extract dance name from command (e.g., 'christmas_dance' -> 'Christmas Dance')
        var command = data.command || '';
        var danceName = danceNames[command] || command.replace(/_/g, ' ');
        var duration = data.duration || 30;

        showDancePopup(danceName, duration);
      }

      // Check for dance_status messages (for stop/complete from broadcast)
      if (data.type === 'dance_status') {
        console.log('[DancePopup] *** DANCE STATUS RECEIVED ***', data);

        if (data.status === 'started') {
          showDancePopup(data.dance_name, data.duration);
        } else if (data.status === 'completed' || data.status === 'stopped') {
          hideDancePopup();
        }
      }

    } catch (e) {
      // Not JSON or parse error, ignore
    }
  }

  /**
   * Stop dance button handler
   */
  stopBtn.addEventListener('click', function() {
    console.log('[DancePopup] Stop button clicked');

    var wsConn = window.ws;
    if (wsConn && wsConn.readyState === WebSocket.OPEN) {
      wsConn.send('stop_dance');
      console.log('[DancePopup] Sent stop_dance command');
      // Hide popup immediately
      hideDancePopup();
    } else {
      console.error('[DancePopup] WebSocket not connected');
    }
  });

  /**
   * Attach listener to WebSocket
   */
  function attachListener(ws) {
    if (ws && ws !== currentWs) {
      console.log('[DancePopup] Attaching to new WebSocket');
      ws.addEventListener('message', handleMessage);
      currentWs = ws;
    }
  }

  /**
   * Poll for WebSocket and keep it attached
   */
  function pollWebSocket() {
    var ws = window.ws;

    if (ws) {
      attachListener(ws);
    }

    // Keep polling in case WebSocket reconnects (creates new object)
    setTimeout(pollWebSocket, 1000);
  }

  // Start polling
  pollWebSocket();

  // Expose for testing
  window.testDancePopup = function() {
    showDancePopup('Test Dance', 10);
  };
  window.hideDancePopup = hideDancePopup;

})();
