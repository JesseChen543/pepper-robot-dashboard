# Pepper Robot Main Dashboard

The central control dashboard for **SoftBank Pepper Robot** (NAOqi 2.5). A unified web interface served directly on Pepper and displayed on its Android tablet — one place to control all robot features.

## Features

- **Motion control** — joystick and arrow button driving
- **Camera** — photo capture with countdown + gallery
- **LED control** — eye and chest animations and colours
- **Realtime voice** — OpenAI Realtime API integration (via WonderConnect)
- **Video streaming** — real-time camera feed via RTP/TCP
- **Health monitoring** — battery, CPU, memory, temperature
- **Dance launcher** — trigger choreographed routines
- **YouTube player** — play videos on Pepper's tablet
- **WiFi QR code** — display network QR for quick connections
- **Mobile remote** — control Pepper from a smartphone browser

## Architecture

```
main.py  (orchestrator — runs on Pepper)
├── HTTP server :8080  ──→  frontend/ served to tablet & browser
├── WebSocket :9001    ←→  browser sends commands
├── Video stream :5000 ──→  TCP camera feed
└── Voice module       ──→  WonderConnect realtime API
```

## Quick Start

### 1. Configure your IPs

Edit `pepper_config.py`:

```python
PEPPER_IP = "192.168.x.x"   # Your Pepper's network IP
PC_IP     = "192.168.x.x"   # Your PC's IP (for video stream destination)
```

### 2. Set voice credentials (optional)

```bash
export WONDERCONNECT_WS_URL="ws://your-backend.example.com/ws/realtime"
export WONDERCONNECT_CLIENT_IDENTITY="your-client-identity"
export WONDERCONNECT_CLIENT_SECRET="your-client-secret-key"
```

### 3. Upload to Pepper and run

```bash
# Copy the project to Pepper
scp -r . nao@<PEPPER_IP>:/home/nao/pepper-main/

# SSH in
ssh nao@<PEPPER_IP>

# Run
cd /home/nao/pepper-main
python main.py --ip 127.0.0.1 --port 9559
```

### 4. Open the dashboard

- **Pepper's tablet** — auto-loads `http://198.18.0.1:8080`
- **Any browser on the same network** — `http://<PEPPER_IP>:8080`

## Auto-Start on Boot

Use the included systemd service:

```bash
sudo cp pepper-main.service /etc/systemd/system/
sudo systemctl enable pepper-main
sudo systemctl start pepper-main
```

Or use `start_main.sh` for auto-restart on crash:

```bash
./start_main.sh 127.0.0.1 9559
```

## Project Structure

```
pepper-main/
├── main.py                          # Service orchestrator
├── pepper_config.py                 # IP and port configuration
├── pepper_control/                  # WebSocket control server + handlers
│   ├── control_server.py
│   ├── handler_registry.py
│   ├── motion_handler.py
│   ├── navigation_handler.py
│   ├── video_handler.py
│   ├── http_server_csp.py           # HTTP server with YouTube CSP headers
│   └── youtube_proxy.py
├── pepper_video/
│   └── ImageFeedbackSocketModule_rtp.py   # Video streaming
├── frontend/                        # Web dashboard (served on :8080)
│   ├── index.html                   # Home screen / app launcher
│   ├── motion.html                  # Movement joystick controls
│   ├── camera.html                  # Camera capture with countdown
│   ├── photos.html                  # Photo gallery (download + QR)
│   ├── leds.html                    # LED colour and animation controls
│   ├── health.html                  # System diagnostics
│   ├── video_player.html            # YouTube on tablet
│   ├── wifi-qr.html                 # WiFi QR code display
│   ├── settings.html                # Settings and service restart
│   ├── js/                          # JavaScript modules
│   ├── css/                         # Styles
│   ├── photos/                      # Captured photos (gitignored)
│   └── mobile/                      # Smartphone remote UI
├── setup_venv.sh
├── setup_venv.bat
├── start_main.sh                    # Auto-restart wrapper
├── pepper-main.service              # systemd service file
└── requirements-pc.txt
```

## Ports

| Port | Service |
|------|---------|
| 9559 | NAOqi SDK |
| 9001 | WebSocket control server |
| 5000 | Video TCP stream |
| 8080 | Frontend HTTP server |
| 5004 | RTP video mirror (optional, requires ffmpeg) |

## Requirements

- Pepper Robot with NAOqi 2.5
- Python 2.7 (runs on Pepper)
- Python 3.x (optional — PC-side tools only)
- Network access to Pepper on port 9559

## Related Projects (Feature Sub-Repos)

| Feature | Repo |
|---------|------|
| Dance routines | [naoqi-robot-dance](https://github.com/JesseChen543/naoqi-robot-dance) |
| Movement control | `pepper-movement` |
| Voice / Realtime API | `pepper-voice` |
| LED control | `pepper-led` |
| Camera + gallery | `pepper-camera` |

## License

MIT
