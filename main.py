#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
main.py - Launcher for Pepper video, audio, and control services.

This lightweight entry point connects to Pepper's NAOqi session, launches the
ImageFeedbackSocketModule (with optional RTP mirroring) from `pepper_video`,
starts the standalone sound module in `pepper_sound` (falling back to
pepper_voice/pepper if needed), and launches the WebSocket control server
for motion commands.

RUNNING WITH AUTO-RESTART:
    To enable the remote restart button in Settings page, use the wrapper script:

    ./start_main.sh [IP] [PORT]

    Example:
    ./start_main.sh 127.0.0.1 9559

    The wrapper will automatically restart main.py when exit code 42 is received.

RUNNING WITHOUT AUTO-RESTART:
    python main.py --ip 127.0.0.1 --port 9559

    Note: Restart button in Settings will only stop the application.
"""

from __future__ import print_function

import argparse
import contextlib
import os
import signal
import socket
import subprocess
import sys
import time

import qi


REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
VIDEO_CANDIDATES = [
    os.path.join(REPO_ROOT, "pepper_video", "ImageFeedbackSocketModule_rtp.py")
]
SOUND_CANDIDATES = [
    os.path.join(REPO_ROOT, "pepper_sound", "Sound_Module.py"),
    os.path.join(REPO_ROOT, "pepper_voice", "pepper", "Sound_Module.py"),
]
FRONTEND_CANDIDATES = [
    os.path.join(REPO_ROOT, "frontend", "pepper"),
    os.path.join(REPO_ROOT, "frontend"),
    os.path.join(REPO_ROOT, "frontend-pepper"),  # Legacy fallback
    REPO_ROOT,
]


def _pick_existing(candidates):
    for path in candidates:
        if os.path.exists(path):
            return path
    return candidates[0]


VIDEO_MODULE = _pick_existing(VIDEO_CANDIDATES)
SOUND_MODULE = _pick_existing(SOUND_CANDIDATES)
FRONTEND_DIR = _pick_existing(FRONTEND_CANDIDATES)

# If using new structure (frontend/pepper/), serve from frontend/ root
# so both pepper/ and mobile/ are accessible
if FRONTEND_DIR.endswith(os.path.join("frontend", "pepper")):
    FRONTEND_DIR = os.path.dirname(FRONTEND_DIR)  # Go up to frontend/
    FRONTEND_INDEX = os.path.join(FRONTEND_DIR, "pepper", "index.html")
else:
    FRONTEND_INDEX = os.path.join(FRONTEND_DIR, "index.html")
MOVE_TO_HEAD_SCRIPT = os.path.join(REPO_ROOT, "pepper_movement", "move_to_head.py")


def launch_sound_module(qi_url, log_level="info"):
    if not os.path.exists(SOUND_MODULE):
        print("[sound] Sound_Module.py not found at {}".format(SOUND_MODULE))
        return None
    cmd = [
        sys.executable,
        SOUND_MODULE,
        "--qi-url",
        qi_url,
    ]
    print("[sound] starting: {}".format(" ".join(cmd)))
    stdout_target = None
    if log_level == "quiet":
        stdout_target = open(os.devnull, "w")

    # Set environment variables for sound module
    env = os.environ.copy()
    # DISABLED: Backend in "single" mode rejects session.update
    # env["PEPPER_SOUND_SEND_SESSION_UPDATE"] = "1"

    try:
        proc = subprocess.Popen(cmd, stdout=stdout_target, stderr=stdout_target, env=env)
    except Exception:
        if stdout_target:
            stdout_target.close()
        raise
    proc._stdout_handle = stdout_target  # store for cleanup
    return proc


def kill_port(port):
    """Kill any process using the specified port."""
    try:
        # Try lsof first (more reliable) - note the space before the colon
        output = subprocess.check_output(
            ["lsof", "-t", "-i", ":{}".format(port)],
            stderr=subprocess.STDOUT
        )
        pids = output.strip().split()
        killed_count = 0
        for pid in pids:
            # Only try to kill if it's actually a numeric PID
            if not pid.isdigit():
                continue
            try:
                subprocess.call(["kill", "-9", pid])
                print("[cleanup] Killed process {} on port {}".format(pid, port))
                killed_count += 1
            except Exception:
                pass
        if killed_count == 0:
            print("[cleanup] No processes found on port {}".format(port))
    except subprocess.CalledProcessError:
        # Port not in use, that's fine
        print("[cleanup] No processes using port {}".format(port))
    except OSError:
        # lsof might not be available, try fuser
        try:
            result = subprocess.call(
                ["fuser", "-k", "{}/tcp".format(port)],
                stderr=subprocess.STDOUT,
                stdout=open(os.devnull, 'w')
            )
            if result == 0:
                print("[cleanup] Killed process on port {} using fuser".format(port))
        except Exception:
            # If both fail, just continue silently
            pass
    except Exception:
        # Unexpected error, but don't crash
        pass


def stop_orphaned_move_to_head():
    """Ensure move_to_head.py is not already running unless explicitly requested."""
    if not os.path.exists(MOVE_TO_HEAD_SCRIPT):
        return

    candidates = []
    try:
        output = subprocess.check_output(
            ["pgrep", "-f", MOVE_TO_HEAD_SCRIPT],
            stderr=subprocess.STDOUT
        )
        candidates = output.decode("utf-8", "ignore").strip().splitlines()
    except subprocess.CalledProcessError:
        return  # nothing running
    except OSError:
        try:
            output = subprocess.check_output(
                ["ps", "-eo", "pid,args"],
                stderr=subprocess.STDOUT
            )
        except Exception:
            return
        for line in output.decode("utf-8", "ignore").splitlines():
            if MOVE_TO_HEAD_SCRIPT in line:
                parts = line.strip().split(None, 1)
                if parts:
                    candidates.append(parts[0])

    cleaned = []
    for pid_str in candidates:
        pid_str = pid_str.strip()
        if pid_str and pid_str.isdigit():
            cleaned.append(int(pid_str))

    if not cleaned:
        return

    for pid in cleaned:
        if pid == os.getpid():
            continue
        try:
            os.kill(pid, signal.SIGTERM)
            print("[movement] Stopped lingering move_to_head.py process (PID {})".format(pid))
        except OSError:
            continue


def _wait_for_port(host, port, timeout=3.0):
    """Return True when a TCP port starts accepting connections."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
            sock.settimeout(0.4)
            try:
                sock.connect((host, port))
            except socket.error:
                time.sleep(0.1)
                continue
            return True
    return False


def launch_frontend_server(port):
    if not os.path.exists(FRONTEND_INDEX):
        print("[frontend] index.html not found at {}".format(FRONTEND_INDEX))
        return None

    # Use absolute path to avoid Python 2.7 SimpleHTTPServer cwd issues
    frontend_abs_dir = os.path.abspath(FRONTEND_DIR)

    # Use HTTP server with CSP headers for YouTube embeds
    csp_server = os.path.join(REPO_ROOT, "pepper_control", "http_server_csp.py")
    if os.path.exists(csp_server):
        # Python 2.7 compatible server with CSP headers
        cmd = [sys.executable, csp_server, str(port), frontend_abs_dir]
        print("[frontend] starting HTTP server with YouTube CSP headers on port {}".format(port))
        print("[frontend] serving from: {}".format(frontend_abs_dir))
    else:
        # Fallback to simple_server (no CSP headers - YouTube won't work)
        print("[frontend] Warning: http_server_csp.py not found, YouTube embeds may not work")
        if sys.version_info[0] < 3:
            server_script = os.path.join(REPO_ROOT, "pepper_control", "simple_server.py")
            if os.path.exists(server_script):
                cmd = [sys.executable, server_script, str(port), frontend_abs_dir]
            else:
                cmd = [sys.executable, "-m", "SimpleHTTPServer", str(port)]
        else:
            cmd = [sys.executable, "-m", "http.server", str(port)]

    try:
        proc = subprocess.Popen(cmd, cwd=frontend_abs_dir)
    except Exception:
        raise

    if not _wait_for_port("127.0.0.1", port):
        if proc.poll() is not None:
            print("[frontend] Failed to start HTTP server (exit {}).".format(proc.returncode))
        else:
            print("[frontend] Warning: server on port {} not reachable yet.".format(port))

    return proc


def launch_video_module(args, session):
    if not os.path.exists(VIDEO_MODULE):
        print("[video] ImageFeedbackSocketModule_rtp.py not found at {}".format(VIDEO_MODULE))
        return None

    cmd = [
        sys.executable,
        VIDEO_MODULE,
        "--ip", args.ip,
        "--port", str(args.port),
        "--socket-host", args.socket_host,
        "--socket-port", str(args.socket_port),
    ]
    if args.enable_rtp:
        cmd.extend([
            "--enable-rtp",
            "--rtp-host", args.rtp_host,
            "--rtp-port", str(args.rtp_port),
            "--rtp-log-level", args.rtp_log_level,
        ])

    print("[video] starting: {}".format(" ".join(cmd)))
    proc = subprocess.Popen(cmd)
    return proc


def parse_args():
    parser = argparse.ArgumentParser(description="Pepper video/audio launcher")
    parser.add_argument("--ip", type=str, default="127.0.0.1",
                        help="Pepper NAOqi IP (default: 127.0.0.1 when running on robot)")
    parser.add_argument("--port", type=int, default=9559,
                        help="Pepper NAOqi port (default: 9559)")
    parser.add_argument("--socket-host", type=str, default="",
                        help="TCP bind address for the video server (default: all interfaces)")
    parser.add_argument("--socket-port", type=int, default=5000,
                        help="TCP port for the video server (default: 5000)")
    parser.add_argument("--enable-rtp", action="store_true",
                        help="Enable RTP mirroring via ffmpeg bridge")
    parser.add_argument("--rtp-host", type=str, default="127.0.0.1",
                        help="Destination host for RTP stream (used when --enable-rtp)")
    parser.add_argument("--rtp-port", type=int, default=5004,
                        help="Destination port for RTP stream")
    parser.add_argument("--rtp-log-level", type=str, default="error",
                        help="ffmpeg log level (quiet, error, warning, info, debug)")
    parser.add_argument("--sound-log", type=str, default="info",
                        help="Sound module logging (info or quiet)")
    parser.add_argument("--frontend-port", type=int, default=8080,
                        help="Port for local frontend web server (default: 8080)")
    parser.add_argument("--tablet-host", type=str, default="198.18.0.1",
                        help="Tablet host/IP to load the frontend (default: 198.18.0.1)")
    parser.add_argument("--autostart-move-head", action="store_true", default=False,
                        help="Automatically launch pepper_movement/move_to_head.py (disabled by default, enable in settings)")
    parser.add_argument("--tablet-warmup-url", type=str,
                        default="none",
                        help="Optional URL to prime the tablet before loading the main UI "
                             "(default: none). Use a full URL to wake the tablet with a "
                             "temporary page, or 'none' to skip the warm-up.")
    parser.add_argument("--tablet-warmup-delay", type=float, default=1.0,
                        help="Seconds to wait after the warm-up webview before continuing (default: 1.0)")
    parser.add_argument("--tablet-skip-warmup", action="store_true",
                        help="Skip the warm-up webview step")
    return parser.parse_args()


def clear_tablet_cache(tablet):
    """
    Clear tablet cache using comprehensive approach.

    Args:
        tablet: ALTabletService instance

    Returns:
        bool: True if successful
    """
    try:
        print("[tablet] Clearing tablet cache...")

        # Step 1: Hide webview
        try:
            tablet.hideWebview()
            time.sleep(0.5)
        except Exception as e:
            print("[tablet] hideWebview warning: {}".format(e))

        # Step 2: Reset tablet (clears cache on some NAOqi versions)
        try:
            if hasattr(tablet, 'resetTablet'):
                tablet.resetTablet()
                print("[tablet] Tablet reset successful")
            else:
                print("[tablet] resetTablet not available")
        except Exception as e:
            print("[tablet] resetTablet warning: {}".format(e))

        # Step 3: Clean webview cache
        try:
            if hasattr(tablet, 'cleanWebview'):
                tablet.cleanWebview()
                print("[tablet] cleanWebview successful")
            else:
                print("[tablet] cleanWebview not available")
        except Exception as e:
            print("[tablet] cleanWebview warning: {}".format(e))

        # Step 4: Wait for tablet to stabilize
        time.sleep(2.0)
        print("[tablet] Cache cleared successfully")
        return True

    except Exception as exc:
        print("[tablet] Cache clearing error: {}".format(exc))
        return False


def show_webview_fresh(tablet, url, clear_cache=True):
    """
    Show webview with optional cache clearing.

    Args:
        tablet: ALTabletService instance
        url: URL to display
        clear_cache: If True, clears cache before showing webview
    """
    if clear_cache:
        clear_tablet_cache(tablet)

    # Add timestamp to URL for cache busting
    import datetime
    timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    if '?' in url:
        cache_bust_url = "{}&_cache={}".format(url, timestamp)
    else:
        cache_bust_url = "{}?_cache={}".format(url, timestamp)

    print("[tablet] Loading URL with cache buster: {}".format(cache_bust_url))
    tablet.showWebview(cache_bust_url)


def warmup_tablet(tablet, url, delay):
    if not url:
        return False
    if url.strip().lower() == "none":
        return False
    try:
        tablet.showWebview(url)
        print("[tablet] Warm-up webview launched at {}".format(url))
        if delay > 0:
            time.sleep(delay)
        try:
            tablet.hideWebview()
        except Exception:
            pass
        return True
    except Exception as exc:
        print("[tablet] Warm-up failed: {}".format(exc))
        return False


def initialize_pepper(session):
    """Initialize Pepper: wake up, disable autonomous life, enable movement, stand up."""
    try:
        print("[init] Initializing Pepper for action execution...")

        # Wake up motors
        motion = session.service("ALMotion")
        motion.wakeUp()
        print("[init] Motors woken up")

        # Disable autonomous life so it doesn't interfere with actions
        autonomous_life = session.service("ALAutonomousLife")
        if autonomous_life.getState() != "disabled":
            autonomous_life.setState("disabled")
            print("[init] Autonomous life disabled")

        # Go to standing posture
        posture = session.service("ALRobotPosture")
        posture.goToPosture("StandInit", 0.8)
        print("[init] Pepper is now standing and ready")

        return True
    except Exception as exc:
        print("[init] Failed to initialize Pepper: {}".format(exc))
        return False


def ensure_safety_features(session):
    """Re-enable core safety features (collision, fall management, smart stiffness)."""
    try:
        motion = session.service("ALMotion")
    except Exception as exc:
        print("[safety] Unable to access ALMotion: {}".format(exc))
        return

    def _call(desc, func, *args):
        try:
            func(*args)
            print("[safety] {} enabled".format(desc))
        except Exception as inner_exc:
            print("[safety] Warning: could not enable {} ({})".format(desc, inner_exc))

    # External collision protection
    _call("external collision protection", motion.setExternalCollisionProtectionEnabled, "All", True)

    # Fall management
    if hasattr(motion, "setFallManagerEnabled"):
        _call("fall manager", motion.setFallManagerEnabled, True)

    # Smart stiffness keeps joints compliant when idle
    if hasattr(motion, "setSmartStiffnessEnabled"):
        _call("smart stiffness", motion.setSmartStiffnessEnabled, True)

    # Push recovery (Pepper 1.8+) helps absorb small pushes
    if hasattr(motion, "setPushRecoveryEnabled"):
        _call("push recovery", motion.setPushRecoveryEnabled, True)


def main():
    args = parse_args()

    if not args.autostart_move_head:
        stop_orphaned_move_to_head()

    session = qi.Session()
    qi_url = "tcp://{}:{}".format(args.ip, args.port)
    try:
        session.connect(qi_url)
    except RuntimeError as err:
        print("Failed to connect to NAOqi at {}:{}. {}".format(args.ip, args.port, err))
        return 1

    # Initialize Pepper for action execution
    initialize_pepper(session)
    ensure_safety_features(session)

    print("[control] WebSocket control server will be started by Sound_Module.py")

    frontend_proc = launch_frontend_server(args.frontend_port)

    # Wait for frontend server to be ready (with retry)
    print("[frontend] Waiting for server to be ready...")
    frontend_ready = False
    for i in range(5):
        time.sleep(1.0)
        if _wait_for_port("127.0.0.1", args.frontend_port, timeout=1.0):
            print("[frontend] Server is ready on port {}".format(args.frontend_port))
            frontend_ready = True
            break
        else:
            print("[frontend] Server not ready yet, waiting... ({}/5)".format(i + 1))

    if not frontend_ready:
        print("[frontend] Warning: Server may not be fully ready, but continuing anyway...")

    # launch tablet webview first so it comes up even if other modules fail later
    tablet = session.service("ALTabletService")

    # Determine tablet URL based on structure
    if FRONTEND_INDEX.endswith(os.path.join("pepper", "index.html")):
        tablet_url = "http://{}:{}/pepper/index.html".format(args.tablet_host, args.frontend_port)
    else:
        tablet_url = "http://{}:{}/index.html".format(args.tablet_host, args.frontend_port)

    try:
        if not args.tablet_skip_warmup:
            if warmup_tablet(tablet, args.tablet_warmup_url, args.tablet_warmup_delay):
                time.sleep(0.1)

        # Try to load the frontend with retry mechanism (max 5 attempts)
        max_attempts = 5
        attempt = 0
        success = False

        while attempt < max_attempts and not success:
            attempt += 1
            try:
                print("[tablet] Attempting to load webview (attempt {}/{})...".format(attempt, max_attempts))
                # Use show_webview_fresh to clear cache on first load
                show_webview_fresh(tablet, tablet_url, clear_cache=(attempt == 1))
                print("[tablet] Webview launched successfully at {}".format(tablet_url))
                success = True
            except Exception as exc:
                print("[tablet] Attempt {} failed: {}".format(attempt, exc))
                if attempt < max_attempts:
                    print("[tablet] Retrying in 2 seconds...")
                    time.sleep(2.0)
                else:
                    print("[tablet] Failed to open webview after {} attempts".format(max_attempts))

    except Exception as exc:
        print("[tablet] Error during webview initialization: {}".format(exc))

    video_proc = launch_video_module(args, session)
    sound_proc = launch_sound_module(qi_url, log_level=args.sound_log)
    move_proc = None
    if args.autostart_move_head and os.path.exists(MOVE_TO_HEAD_SCRIPT):
        try:
            move_proc = subprocess.Popen([sys.executable, MOVE_TO_HEAD_SCRIPT, "--ip", args.ip, "--port", str(args.port)])
            print("[movement] move_to_head.py started")
        except Exception as exc:
            print("[movement] Failed to start move_to_head.py: {}".format(exc))

    restart_requested = False
    try:
        while True:
            time.sleep(1.0)
            if video_proc and video_proc.poll() is not None:
                print("[video] process terminated with code {}".format(video_proc.returncode))
                if video_proc.returncode == 42:
                    restart_requested = True
                break
            if sound_proc and sound_proc.poll() is not None:
                print("[sound] process terminated with code {}".format(sound_proc.returncode))
                if sound_proc.returncode == 42:
                    restart_requested = True
                break
    except KeyboardInterrupt:
        print("[main] Keyboard interrupt received, stopping services...")
    finally:
        # Clean up photos directory FIRST before stopping other services
        print("[cleanup] Deleting photos...")
        sys.stdout.flush()
        try:
            import glob
            photos_dir = os.path.join(REPO_ROOT, "frontend", "pepper", "photos")
            print("[cleanup] Looking for photos in: {}".format(photos_dir))
            sys.stdout.flush()
            if os.path.exists(photos_dir):
                # Delete all photos
                photo_files = glob.glob(os.path.join(photos_dir, "*.jpg"))
                photo_files.extend(glob.glob(os.path.join(photos_dir, "*.jpeg")))
                print("[cleanup] Found {} photos to delete".format(len(photo_files)))
                sys.stdout.flush()
                for photo_file in photo_files:
                    try:
                        os.remove(photo_file)
                        print("[cleanup] Deleted: {}".format(os.path.basename(photo_file)))
                        sys.stdout.flush()
                    except Exception as e:
                        print("[cleanup] Failed to delete {}: {}".format(os.path.basename(photo_file), e))
                        sys.stdout.flush()
                print("[cleanup] Photo cleanup complete")
                sys.stdout.flush()
            else:
                print("[cleanup] No photos directory found at: {}".format(photos_dir))
                sys.stdout.flush()
        except Exception as e:
            print("[cleanup] Error during photo cleanup: {}".format(e))
            sys.stdout.flush()

        print("[cleanup] Stopping services...")
        sys.stdout.flush()
        if video_proc and video_proc.poll() is None:
            video_proc.terminate()
            for _ in range(50):
                if video_proc.poll() is not None:
                    break
                time.sleep(0.1)
            if video_proc.poll() is None:
                video_proc.kill()
        if sound_proc and sound_proc.poll() is None:
            sound_proc.terminate()
            for _ in range(50):
                if sound_proc.poll() is not None:
                    break
                time.sleep(0.1)
            if sound_proc.poll() is None:
                sound_proc.kill()
        if sound_proc and getattr(sound_proc, "_stdout_handle", None):
            try:
                sound_proc._stdout_handle.close()
            except Exception:
                pass
        if move_proc and move_proc.poll() is None:
            try:
                move_proc.terminate()
                for _ in range(50):
                    if move_proc.poll() is not None:
                        break
                    time.sleep(0.1)
                if move_proc.poll() is None:
                    move_proc.kill()
            except Exception:
                pass
        if frontend_proc and frontend_proc.poll() is None:
            frontend_proc.terminate()
            for _ in range(50):
                if frontend_proc.poll() is not None:
                    break
                time.sleep(0.1)
            if frontend_proc.poll() is None:
                frontend_proc.kill()

        print("[cleanup] All services stopped")
        sys.stdout.flush()

    # If restart was requested (exit code 42 from subprocess), propagate it
    if restart_requested:
        print("[main] Restart requested - exiting with code 42")
        sys.stdout.flush()
        return 42

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
