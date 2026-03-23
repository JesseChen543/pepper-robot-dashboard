#! /usr/bin/env python
# -*- encoding: UTF-8 -*-

"""
ImageFeedbackSocketModule_rtp.py - Pepper video/control server with optional RTP mirroring.

This variant keeps the original TCP socket behaviour for command + JPEG streaming
while optionally piping the camera feed into an RTP endpoint using ffmpeg.

The RTP stream uses a simple MJPEG payload sent via ffmpeg. Ensure ffmpeg is
available on Pepper (or adjust the command) and that the receiving endpoint
supports MJPEG over RTP.
"""

import argparse
import atexit
import signal
import socket
import struct
import subprocess
import threading
import time

import cv2
import numpy as np
import qi


class ImageFeedbackSocketModule(object):

    def __init__(
        self,
        session,
        HOST='',
        PORT=5000,
        frame_interval=1.0,
        enable_rtp=False,
        rtp_host='127.0.0.1',
        rtp_port=5004,
        rtp_log_level='error',
    ):
        atexit.register(self.class_exit)
        print("[video] Initializing ImageFeedbackSocketModule")

        self.HOST = HOST
        self.PORT = PORT
        self.frame_interval = frame_interval

        self.enable_rtp = enable_rtp
        self.rtp_host = rtp_host
        self.rtp_port = rtp_port
        self.rtp_log_level = rtp_log_level
        self.rtp_proc = None
        self.rtp_lock = threading.Lock()

        if self.enable_rtp:
            print("[video] RTP output enabled -> {}:{}".format(self.rtp_host, self.rtp_port))

        self.run = False
        print("[video] Setting up services")
        self.memory = session.service("ALMemory")
        self.post = session.service("ALRobotPosture")
        self.an = session.service("ALAnimationPlayer")
        self.vid = session.service("ALVideoDevice")
        self.navigation_service = session.service("ALNavigation")
        self.motion_service = session.service("ALMotion")
        self.tts = session.service("ALTextToSpeech")
        print("[video] Services ready")

        # Stop any running navigation/localization that might block motors
        print("[video] Checking for active navigation...")
        try:
            self.navigation_service.stopLocalization()
            print("[video] Stopped localization")
        except Exception:
            pass  # Localization wasn't running

        try:
            self.navigation_service.stopExploration()
            print("[video] Stopped exploration")
        except Exception:
            pass  # Exploration wasn't running

        print("[video] Waking up motors")
        try:
            self.motion_service.wakeUp()
            print("[video] Motors awake")
        except RuntimeError as e:
            if "WakeUp not started" in str(e):
                print("[video] WakeUp failed, trying rest->wakeUp sequence...")
                try:
                    self.motion_service.rest()
                    time.sleep(1)
                    self.motion_service.wakeUp()
                    print("[video] Motors awake after reset")
                except Exception as e2:
                    print("[video] WARNING: Could not wake motors: %s" % e2)
                    print("[video] Continuing anyway - motors may already be awake")
            else:
                raise

        print("[video] Moving to StandZero posture")
        self.post.goToPosture("StandZero", 1.0)

    # ------------------------------------------------------------------ #
    def open_socket(self):
        self.run = True
        print("[video] Starting server...")
        self.s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

        try:
            self.s.bind((self.HOST, self.PORT))
        except Exception as e:
            print("[video] Error binding socket:", e)
            self.socket_close()
        self.s.listen(1)

        print("[video] Server started. Waiting for client...")
        self.conn, self.addr = self.s.accept()
        print("Connected by", self.addr)

        try:
            self.cam = self.vid.subscribe("pepper_srv", 2, 11, 20)
        except Exception as e:
            print("[video] Error subscribing to video:", e)

        if self.enable_rtp:
            self._start_rtp_process()

        threading.Thread(target=self.handle_send).start()
        self.handle_receive()
        self.socket_close()

    # ------------------------------------------------------------------ #
    def _start_rtp_process(self):
        cmd = [
            "ffmpeg",
            "-loglevel", self.rtp_log_level,
            "-re",
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-i", "pipe:0",
            "-an",
            "-c:v", "copy",
            "-f", "rtp",
            "rtp://{}:{}".format(self.rtp_host, self.rtp_port),
        ]
        try:
            self.rtp_proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            print("[video] ffmpeg RTP bridge started (pid {})".format(self.rtp_proc.pid))
        except OSError as exc:
            self.rtp_proc = None
            print("[video] Error: ffmpeg launch failed:", exc)

    def _stop_rtp_process(self):
        with self.rtp_lock:
            if not self.rtp_proc:
                return
            try:
                if self.rtp_proc.stdin:
                    self.rtp_proc.stdin.close()
                self.rtp_proc.send_signal(signal.SIGTERM)
                self.rtp_proc.wait(timeout=3)
            except Exception:
                try:
                    self.rtp_proc.kill()
                except Exception:
                    pass
            finally:
                print("[video] ffmpeg RTP bridge stopped")
                self.rtp_proc = None

    def _send_rtp_frame(self, frame_bytes):
        with self.rtp_lock:
            if not self.rtp_proc or not self.rtp_proc.stdin:
                return
            try:
                self.rtp_proc.stdin.write(frame_bytes)
                self.rtp_proc.stdin.flush()
            except (IOError, OSError) as exc:
                print("[video] Error: RTP write failed:", exc)
                self._stop_rtp_process()

    # ------------------------------------------------------------------ #
    def moveTo(self, x, y, t):
        duration = abs(x) + abs(y) + abs(t) * 0.4

        try:
            feedback = self.motion_service.moveTo(x, y, t, duration * 5)
            print("[video] Motion feedback:", feedback)
            if feedback is False:
                self.motion_service.moveTo(x, y, t, duration * 5)
        except Exception as e:
            print("[video] Error in moveTo:", e)

    def control(self, cmd):
        arg = cmd[1:]
        dist = float(arg)

        if cmd.startswith("w"):
            self.moveTo(dist, 0.0, 0.0)
        elif cmd.startswith("a"):
            self.moveTo(0.0, dist, 0.0)
        elif cmd.startswith("s"):
            self.moveTo(-dist, 0.0, 0.0)
        elif cmd.startswith("d"):
            self.moveTo(0.0, -dist, 0.0)
        elif cmd.startswith("q"):
            self.moveTo(0.1, 0.0, dist)
        elif cmd.startswith("e"):
            self.moveTo(0.1, 0.0, -dist)

        time.sleep(2)

    def speakcontrol(self, cmd):
        self.tts.setVolume(1)
        self.tts.setParameter("speed", 100)

        self.volume = self.tts.getVolume()
        self.speed = int(self.tts.getParameter("speed"))

        lc = cmd.strip().lower()

        if lc.startswith("tts"):
            message = lc.replace("tts", "").strip()
            threading.Thread(target=self.tts.say, args=(message,)).start()
        elif lc == "v+":
            self.volume = min(self.volume + 0.1, 1.0)
            self.tts.setVolume(self.volume)
            self.tts.say("Volume increased")
        elif lc == "v-":
            self.volume = max(self.volume - 0.1, 0.0)
            self.tts.setVolume(self.volume)
            self.tts.say("Volume decreased")

    def handle_receive(self):
        print("[video] Starting receive handler")

        while self.run:
            try:
                raw = self.conn.recv(1024)
                if not raw:
                    break
                print("[video] Data from client:", raw[:50])
                decoded = raw.decode('utf-8', errors='ignore').strip()

                message = None
                if '<' in decoded and decoded.endswith('>'):
                    cmd, _, rest = decoded.partition('<')
                    message = rest[:-1]
                    cmd = cmd.strip()
                else:
                    cmd = decoded

                if message:
                    threading.Thread(target=self.tts.say, args=(message,)).start()

                if cmd == "exit":
                    print("[video] Exit command received")
                    self.conn.sendall(b"ack: shutting down\n")
                    self.close_socket()
                    break

                for handler, err_label in [
                    (self.an.run, "not an animation path"),
                    (self.an.runTag, "not a tag"),
                    (self.control, "not a motion"),
                    (self.speakcontrol, "not a speak command"),
                ]:
                    try:
                        handler(cmd)
                        self.post.goToPosture("StandInit", 0.5)
                        break
                    except Exception:
                        pass

                self.motion_service.killAll()

            except Exception as e:
                print("[video] Error handling socket data:", e)

    def handle_send(self):
        print("run video")
        try:
            while self.run:
                img = self.vid.getImageRemote(self.cam)
                if not img:
                    continue
                w, h, data = img[0], img[1], img[6]
                frame = np.frombuffer(data, np.uint8).reshape((h, w, 3))
                bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                ok, enc = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                if not ok:
                    continue
                buf = enc.tostring()

                try:
                    self.conn.sendall(struct.pack('>I', len(buf)) + buf)
                except Exception:
                    print("[video] TCP connection cut")
                    self.socket_close()

                if self.enable_rtp and self.rtp_proc:
                    self._send_rtp_frame(buf)

                self.vid.releaseImage(self.cam)
        except KeyboardInterrupt:
            print("[video] Keyboard interrupt")
        finally:
            self.socket_close()

    def socket_close(self):
        print("[video] Closing socket and cleaning up")
        self.run = False
        try:
            self.conn.close()
        except Exception:
            print("[video] Error closing connection")
        try:
            self.s.close()
        except Exception:
            print("[video] Error closing socket")
        try:
            self.vid.unsubscribe(self.cam)
        except Exception:
            print("[video] Error unsubscribing from video")

        if self.enable_rtp:
            self._stop_rtp_process()

    def class_exit(self):
        self.run = False
        self.socket_close()


def parse_args():
    parser = argparse.ArgumentParser(
        description="Start Pepper image feedback socket server with optional RTP mirror."
    )
    parser.add_argument("--ip", type=str, default="127.0.0.1",
                        help="Robot NAOqi IP address (default: 127.0.0.1).")
    parser.add_argument("--port", type=int, default=9559,
                        help="Robot NAOqi port (default: 9559).")
    parser.add_argument("--socket-host", type=str, default="",
                        help="TCP server bind address (default: all interfaces).")
    parser.add_argument("--socket-port", type=int, default=5000,
                        help="TCP server port (default: 5000).")
    parser.add_argument("--enable-rtp", action="store_true",
                        help="Enable RTP mirroring via ffmpeg.")
    parser.add_argument("--rtp-host", type=str, default="127.0.0.1",
                        help="Destination host for RTP stream.")
    parser.add_argument("--rtp-port", type=int, default=5004,
                        help="Destination port for RTP stream.")
    parser.add_argument("--rtp-log-level", type=str, default="error",
                        help="ffmpeg log level (quiet, error, warning, info, debug).")
    return parser


def main():
    parser = parse_args()
    args = parser.parse_args()

    session = qi.Session()
    try:
        session.connect("tcp://{}:{}".format(args.ip, args.port))
    except RuntimeError as err:
        print(
            "Can't connect to Naoqi at {}:{} -- {}".format(
                args.ip, args.port, err
            )
        )
        return 1

    module = ImageFeedbackSocketModule(
        session,
        HOST=args.socket_host,
        PORT=args.socket_port,
        enable_rtp=args.enable_rtp,
        rtp_host=args.rtp_host,
        rtp_port=args.rtp_port,
        rtp_log_level=args.rtp_log_level,
    )

    try:
        module.open_socket()
    except KeyboardInterrupt:
        print("[video] Keyboard interrupt received, shutting down.")
    finally:
        module.socket_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
