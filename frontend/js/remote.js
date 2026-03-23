(function() {
  // Get the current host (Pepper's IP)
  // Use the actual IP address instead of localhost/198.18.0.1
  var host = window.location.hostname;

  // If we're on localhost or 198.18.0.1, use Pepper's actual IP
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "198.18.0.1") {
    host = window.location.hostname; // Use server hostname dynamically
  }

  var port = window.location.port || "8080";

  // Generate mobile URL - path should be pepper/mobile/ since we're serving from frontend/
  var mobileUrl = "http://" + host + ":" + port + "/pepper/mobile/";

  // Display URL
  var urlElement = document.getElementById("qr-url");
  if (urlElement) {
    urlElement.textContent = mobileUrl;
  }

  // Generate QR code
  var qrCodeElement = document.getElementById("qr-code");
  if (qrCodeElement && typeof QRCode !== "undefined") {
    new QRCode(qrCodeElement, {
      text: mobileUrl,
      width: 300,
      height: 300,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    console.error("QRCode library not loaded or element not found");
  }
})();
