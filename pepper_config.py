# Pepper Project - Central IP Configuration
# Update these values with your actual network IPs

# ===== PEPPER ROBOT IP =====
# Update this with your Pepper's actual IP
PEPPER_IP = "YOUR_PEPPER_IP"  # e.g., "192.168.1.100"  

# Default port for NAOqi services
PEPPER_PORT = 9559

# Alternative IPs (for reference)
# - Ethernet: 198.18.0.1
# - Wi-Fi: 192.168.x.x (check your network)

# ===== YOUR PC IP =====
# Update this with your PC's IP on the same network
PC_IP = "YOUR_PC_IP"  # e.g., "192.168.1.200"  

# Default ports
PC_FLASK_PORT = 8080
PC_AUDIO_PORT = 5000

# ===== CONVENIENCE =====
PEPPER_URL = f"tcp://{PEPPER_IP}:{PEPPER_PORT}"
PEPPER_WEB = f"http://{PEPPER_IP}/"
TABLET_BASE_URL = "http://198.18.0.1/apps"

# ===== USAGE =====
# Import in your scripts:
#   from pepper_config import PEPPER_IP, PEPPER_PORT, PC_IP
#   tts = ALProxy("ALTextToSpeech", PEPPER_IP, PEPPER_PORT)
