/**
 * pepper-utils.js
 *
 * Shared utility functions for Pepper robot control
 * ES5 compatible for old Android WebView
 */

(function(window) {
  var PepperUtils = {
    // WebSocket connection reference (set by each page)
    ws: null,

    /**
     * Initialize PepperUtils with WebSocket connection
     * Call this from each page after WebSocket is connected
     * @param {WebSocket} websocket - Active WebSocket connection
     */
    init: function(websocket) {
      this.ws = websocket;
    },

    /**
     * Make Pepper speak text using text-to-speech
     * @param {string} text - Text for Pepper to speak
     * @param {function} onSuccess - Optional callback on success
     * @param {function} onError - Optional callback on error
     * @returns {boolean} - True if command was sent, false if WebSocket not ready
     */
    speak: function(text, onSuccess, onError) {
      if (!this.ws || this.ws.readyState !== 1) {
        console.log("[PepperUtils] Cannot speak: WebSocket not connected");
        if (onError) {
          onError("WebSocket not connected");
        }
        return false;
      }

      if (!text || text.trim() === "") {
        console.log("[PepperUtils] Cannot speak: Empty text");
        if (onError) {
          onError("Empty text");
        }
        return false;
      }

      var payload = {
        command: "speak",
        text: text.trim()
      };

      try {
        this.ws.send(JSON.stringify(payload));
        console.log("[PepperUtils] Speak command sent: " + text);
        if (onSuccess) {
          onSuccess();
        }
        return true;
      } catch (err) {
        console.log("[PepperUtils] Speak error:", err);
        if (onError) {
          onError(err);
        }
        return false;
      }
    },

    /**
     * Send a command to Pepper via WebSocket
     * @param {string} command - Command name (e.g., "gesture", "set_volume")
     * @param {object} data - Additional data to send with command
     * @returns {boolean} - True if sent successfully
     */
    sendCommand: function(command, data) {
      if (!this.ws || this.ws.readyState !== 1) {
        console.log("[PepperUtils] Cannot send command: WebSocket not connected");
        return false;
      }

      var payload = data || {};
      payload.command = command;

      try {
        this.ws.send(JSON.stringify(payload));
        console.log("[PepperUtils] Command sent: " + command);
        return true;
      } catch (err) {
        console.log("[PepperUtils] Send command error:", err);
        return false;
      }
    },

    /**
     * Announce an action with speech
     * Useful for accessibility and feedback
     * @param {string} action - Action description (e.g., "Starting navigation")
     */
    announce: function(action) {
      this.speak(action);
    },

    /**
     * Check if WebSocket is connected and ready
     * @returns {boolean}
     */
    isConnected: function() {
      return this.ws && this.ws.readyState === 1;
    },

    /**
     * Play a gesture animation
     * @param {string} gestureName - Name of gesture (e.g., "wave", "nod")
     * @returns {boolean}
     */
    playGesture: function(gestureName) {
      return this.sendCommand("gesture", { gesture: gestureName });
    },

    /**
     * Set head tracking on or off
     * @param {boolean} enabled - True to enable, false to disable
     * @returns {boolean}
     */
    setHeadTracking: function(enabled) {
      var command = enabled ? "start_head_tracking" : "stop_head_tracking";
      return this.sendCommand(command);
    }
  };

  // Expose to global scope
  window.PepperUtils = PepperUtils;

})(window);
