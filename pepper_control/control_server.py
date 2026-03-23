#!/usr/bin/env python2
# -*- coding: utf-8 -*-

"""
WebSocket control server that bridges UI commands to Pepper subsystems.

This module centralizes control message parsing and dispatch so that UI clients
can trigger Pepper gestures (via MovementController) alongside other handlers
such as audio streaming without embedding that logic in unrelated modules.
"""

import json
import threading
import logging
import os
import time
import subprocess
from collections import defaultdict

from websocket_server import WebsocketServer

try:
    from pepper_movement.movement_controller import MovementController
except Exception:
    MovementController = None

DEFAULT_GESTURES = [
    "air_guitar",
    "amused",
    "angry",
    "angry_gesture",
    "ask_attention",
    "bandmaster",
    "bow",
    "call_someone",
    "drink",
    "drive_car",
    "flying",
    "funny_dancer",
    "happy",
    "helicopter",
    "hey",
    "hide",
    "hot",
    "hug",
    "interested",
    "joy",
    "kisses",
    "knock_eye",
    "laugh",
    "mocker",
    "monster",
    "mystical",
    "relaxation",
    "robot",
    "salute",
    "sad",
    "scratch",
    "sneeze",
    "shake",
    "show_muscles",
    "shy",
    "stretch",
    "surprise",
    "take_picture",
    "taxi",
    "touch_head",
    "wake_up",
    "whisper",
    "winner",
    "zombie",
]


class ControlCommandError(Exception):
    """Raised when a control command cannot be executed."""



def _env_flag(name):
    return os.environ.get(name, "").lower() in ("1", "true", "yes", "on")


VERBOSE_LOGS = _env_flag("PEPPER_CONTROL_VERBOSE") or _env_flag("PEPPER_SOUND_VERBOSE")

LOG = logging.getLogger("pepper.control")
if not LOG.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    LOG.addHandler(handler)
LOG.setLevel(logging.DEBUG if VERBOSE_LOGS else logging.INFO)
LOG.propagate = False


def log_line(category, message, level=logging.INFO):
    LOG.log(level, "[%s] %s", category, message)


def log_debug(category, message):
    if VERBOSE_LOGS:
        log_line(category, message, logging.DEBUG)


class PepperCommandRouter(object):
    """Dispatches incoming control commands to registered handlers."""

    def __init__(self, session, custom_handlers=None, movement_factory=None):
        """
        Args:
            session (qi.Session): Active NAOqi session.
            custom_handlers (dict): Mapping of command name -> callable.
            movement_factory (callable): Optional factory returning a MovementController.
        """
        self._session = session
        self._custom = {}
        if custom_handlers:
            for name, handler in custom_handlers.items():
                self.register(name, handler)
        self._movement_factory = movement_factory or self._default_movement_factory
        self._movement_controller = None
        self._movement_lock = threading.Lock()
        self._noisy_commands = {"get_camera_frame", "get_head_tracking_status"}
        self._suppressed_counts = defaultdict(int)

    def register(self, name, handler):
        """Register a callable for a specific command name."""
        if not name:
            raise ValueError("Command name must be provided")
        lowered = name.strip().lower()
        self._custom[lowered] = handler
        # DEBUG: Log move_head registration
        if lowered == "move_head":
            print("[router] Registered move_head handler: {}".format(handler))

    def route(self, command, payload=None):
        """
        Execute the handler associated with the command.

        Args:
            command (str): Command identifier (case-insensitive).
            payload (dict): Optional structured payload.

        Returns:
            tuple(bool, dict): (success flag, extra data to include in ack)
        """
        if not command:
            return False, {"error": "empty command"}

        payload = payload or {}
        name = command.strip().lower()

        # DEBUG: Always log move_head commands
        if name == "move_head":
            print("[router] move_head command received, payload: {}".format(payload))
            print("[router] Available custom handlers: {}".format(self._custom.keys()))

        should_log = True
        if name in self._noisy_commands and not VERBOSE_LOGS:
            count = self._suppressed_counts[name]
            self._suppressed_counts[name] = count + 1
            if count == 0:
                log_line("control", "command %s -> streaming handler" % name)
            elif (count + 1) % 20 == 0:
                log_line("control", "command %s handled x%d" % (name, count + 1))
            should_log = False
        else:
            log_line("control", "command %s (payload %s)" % (name, payload))

        handler = self._custom.get(name)
        if handler:
            if should_log or VERBOSE_LOGS:
                log_line("control", "-> custom handler %s" % name)
            return self._invoke_handler(handler, payload)

        if name == "stop_action":
            if should_log or VERBOSE_LOGS:
                log_line("control", "-> stop_action")
            return self._stop_gesture()

        if name == "stop_all_behaviors":
            if should_log or VERBOSE_LOGS:
                log_line("control", "-> stop_all_behaviors")
            return self._stop_all_behaviors()

        if name == "get_animation_status":
            animations_busy = self._check_animations_busy()
            return True, {
                "animations_busy": animations_busy,
                "status": "busy" if animations_busy else "idle"
            }

        if name == "restart_main":
            if should_log or VERBOSE_LOGS:
                log_line("control", "-> restart_main requested")
            return self._restart_main_application()

        if name == "reboot_robot":
            if should_log or VERBOSE_LOGS:
                log_line("control", "-> reboot_robot requested")
            return self._reboot_robot()

        if name == "get_health_data":
            if should_log or VERBOSE_LOGS:
                log_line("control", "-> get_health_data requested")
            return self._get_health_data()

        if name == "set_video":
            if should_log or VERBOSE_LOGS:
                log_line("control", "-> set_video requested")
            return self._set_video(payload)

        if name == "gesture":
            gesture_name = payload.get("name") or payload.get("argument") or payload.get("gesture")
            speech = payload.get("speech") or payload.get("say") or payload.get("text")
            return self._perform_gesture(gesture_name, speech)

        # Treat unknown command as direct gesture alias.
        speech = payload.get("speech") or payload.get("say") or payload.get("text")
        return self._perform_gesture(name, speech)

    def get_gesture_names(self):
        """Return sorted list of known gesture aliases, or [] if unavailable."""
        controller = self._movement_controller
        if controller and hasattr(controller, "gesture_map"):
            return sorted(controller.gesture_map.keys())
        return sorted(DEFAULT_GESTURES)

    def _invoke_handler(self, handler, payload):
        try:
            result = handler(payload)
        except ControlCommandError:
            raise
        except Exception as exc:
            return False, {"error": str(exc)}
        return self._normalize_handler_result(result)

    def _normalize_handler_result(self, result):
        if isinstance(result, tuple) and len(result) == 2:
            ok, data = result
            return bool(ok), data or {}
        if isinstance(result, dict):
            # Check if dict has "ok" key to determine success
            if "ok" in result:
                ok = bool(result.get("ok"))
                return ok, result
            return True, result
        if isinstance(result, bool):
            return result, {}
        return True, {}

    def _perform_gesture(self, name, speech=None):
        if not name:
            return False, {"error": "missing gesture name"}

        controller = None
        try:
            controller = self._ensure_movement_controller()
        except ControlCommandError as exc:
            return False, {"error": str(exc)}
        except Exception as exc:
            return False, {"error": "gesture controller error: {}".format(exc)}

        if not controller:
            return False, {"error": "movement controller unavailable"}

        # Check if animations are currently running
        animations_busy = self._check_animations_busy()

        success, meta = controller.run_gesture(name, speech)
        if success:
            response = meta or {}
            if "name" not in response:
                response["name"] = name
            # Add busy indicator to response
            response["animations_busy"] = animations_busy
            response["queued"] = animations_busy  # Indicates this was queued, not immediate
            log_line("control", "Gesture '%s' %s" % (
                name, "queued (animations busy)" if animations_busy else "executed"
            ))
            return True, response

        failure = meta or {}
        failure.setdefault("error", "gesture execution failed")
        if "name" not in failure:
            failure["name"] = name
        return False, failure

    def _check_animations_busy(self):
        """Check if any animations/behaviors are currently running."""
        try:
            behavior_manager = self._session.service("ALBehaviorManager")
            running = behavior_manager.getRunningBehaviors()
            return len(running) > 0
        except Exception:
            # If we can't check, assume not busy
            return False

    def _stop_gesture(self):
        controller = None
        try:
            controller = self._ensure_movement_controller()
        except ControlCommandError as exc:
            return False, {"error": str(exc)}
        except Exception as exc:
            return False, {"error": "stop command failed: {}".format(exc)}

        if not controller or not hasattr(controller, "stop_current_action"):
            return False, {"error": "stop not supported"}

        success, meta = controller.stop_current_action()
        if success:
            payload = meta or {}
            payload.setdefault("stopped", True)
            return True, payload

        return False, meta or {"error": "unable_to_stop"}

    def _stop_all_behaviors(self):
        """Stop all running behaviors using ALBehaviorManager."""
        log_line("control", "stop_all_behaviors -> requested")
        try:
            behavior_manager = self._session.service("ALBehaviorManager")
            log_debug("control", "querying running behaviors")
            running = behavior_manager.getRunningBehaviors()
            log_debug("control", "running behaviors: %s" % running)

            behavior_manager.stopAllBehaviors()
            log_line("control", "stop_all_behaviors -> success")
            return True, {"stopped": True, "message": "All behaviors stopped"}
        except Exception as exc:
            log_line("control", "stop_all_behaviors failed (%s)" % exc, logging.WARNING)
            return False, {"error": "Failed to stop behaviors: {}".format(exc)}

    def _ensure_movement_controller(self):
        with self._movement_lock:
            if self._movement_controller is not None:
                return self._movement_controller

            try:
                controller = self._movement_factory()
            except ControlCommandError:
                raise
            except SystemExit as exc:
                raise ControlCommandError("Movement controller exited: {}".format(exc))
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                raise ControlCommandError("Failed to initialize movement controller: {}".format(exc))

            self._movement_controller = controller
            return controller

    def _default_movement_factory(self):
        if MovementController is None:
            raise ControlCommandError("MovementController unavailable")
        return MovementController(self._session)

    def _restart_main_application(self):
        """Restart the main.py application by triggering a system exit."""
        log_line("control", "restart_main -> initiating application restart")
        import sys

        # Schedule restart in a separate thread to allow response to be sent first
        def _delayed_restart():
            time.sleep(1)  # Give time for response to be sent
            log_line("control", "restart_main -> exiting now (exit code 42 for restart)")
            os._exit(42)  # Use exit code 42 to signal restart requested

        restart_thread = threading.Thread(target=_delayed_restart)
        restart_thread.daemon = True
        restart_thread.start()

        return True, {"message": "Restart initiated, application will restart in 1 second"}

    def _reboot_robot(self):
        """Reboot Pepper robot using system command."""
        log_line("control", "reboot_robot -> initiating robot reboot")

        # Schedule reboot in a separate thread to allow response to be sent first
        def _delayed_reboot():
            time.sleep(2)  # Give time for response to be sent
            log_line("control", "reboot_robot -> executing reboot command")
            try:
                # Use system reboot command (requires nao user permissions)
                subprocess.call(["sudo", "reboot"])
            except Exception as exc:
                log_line("control", "reboot_robot -> failed: %s" % exc, logging.ERROR)

        reboot_thread = threading.Thread(target=_delayed_reboot)
        reboot_thread.daemon = True
        reboot_thread.start()

        return True, {"message": "Robot reboot initiated, Pepper will restart in 2 seconds"}

    def _get_health_data(self):
        """Collect comprehensive health/diagnostics data from Pepper."""
        log_line("control", "get_health_data -> collecting diagnostics")

        health_data = {
            "battery": {},
            "joints": [],
            "temperatures": [],
            "system": {},
            "devices": []
        }

        try:
            # Get battery info
            try:
                battery_service = self._session.service("ALBattery")
                health_data["battery"]["charge"] = battery_service.getBatteryCharge()
                health_data["battery"]["status"] = "OK" if health_data["battery"]["charge"] > 20 else "LOW"
            except Exception as exc:
                log_debug("health", "battery failed: %s" % exc)

            # Get memory service for detailed data
            try:
                memory = self._session.service("ALMemory")

                # Get joint temperatures and positions
                joint_names = ["HeadYaw", "HeadPitch", "LShoulderPitch", "LShoulderRoll",
                               "LElbowYaw", "LElbowRoll", "LWristYaw", "LHand",
                               "RShoulderPitch", "RShoulderRoll", "RElbowYaw", "RElbowRoll",
                               "RWristYaw", "RHand", "HipRoll", "HipPitch", "KneePitch"]

                for joint in joint_names:
                    try:
                        temp_key = "Device/SubDeviceList/%s/Temperature/Sensor/Value" % joint
                        pos_key = "Device/SubDeviceList/%s/Position/Sensor/Value" % joint
                        stiff_key = "Device/SubDeviceList/%s/Hardness/Actuator/Value" % joint

                        temp = memory.getData(temp_key)
                        position = memory.getData(pos_key)
                        stiffness = memory.getData(stiff_key)

                        health_data["joints"].append({
                            "name": joint,
                            "temperature": round(temp, 1) if temp else 0,
                            "position": round(position, 2) if position else 0,
                            "stiffness": round(stiffness, 2) if stiffness else 0,
                            "status": "HOT" if temp and temp > 60 else "OK"
                        })
                    except Exception:
                        pass

                # Get head CPU temperatures
                try:
                    cpu_temps = memory.getData("Device/SubDeviceList/Head/Temperature/Sensor/Value")
                    if cpu_temps:
                        health_data["temperatures"].append({
                            "location": "Head CPU",
                            "value": round(cpu_temps, 1),
                            "status": "HOT" if cpu_temps > 70 else "OK"
                        })
                except Exception:
                    pass

                # Get system info from RobotConfig
                try:
                    head_id = memory.getData("RobotConfig/Head/FullHeadId")
                    body_id = memory.getData("RobotConfig/Body/BodyId")
                    health_data["system"]["head_id"] = head_id if head_id else "Unknown"
                    health_data["system"]["body_id"] = body_id if body_id else "Unknown"
                except Exception:
                    pass

            except Exception as exc:
                log_line("health", "memory data failed: %s" % exc, logging.WARNING)

            # Get system info
            try:
                system_service = self._session.service("ALSystem")
                health_data["system"]["naoqi_version"] = system_service.systemVersion()
            except Exception:
                pass

            log_line("health", "collected data for %d joints" % len(health_data["joints"]))
            return True, health_data

        except Exception as exc:
            log_line("health", "failed: %s" % exc, logging.ERROR)
            return False, {"error": str(exc)}


class PepperControlServer(object):
    """Owns WebSocket server lifecycle and delegates messages to a router."""

    def __init__(self, session, router=None, host="0.0.0.0", port=9001, shutdown_token=None):
        """
        Args:
            session (qi.Session): Active NAOqi session.
            router (PepperCommandRouter): Optional command router.
            host (str): Listen host.
            port (int): Listen port.
            shutdown_token (str): Optional security token for shutdown commands (unused, for compatibility).
        """
        self._session = session
        self._router = router or PepperCommandRouter(session)
        self._host = host
        self._port = port
        self._shutdown_token = shutdown_token
        self._server = WebsocketServer(port, host=host)
        self._server.set_fn_message_received(self._on_message)
        self._server.set_fn_new_client(self._on_new_client)
        self._thread = None
        self._battery_thread = None
        self._battery_stop = threading.Event()
        self._client_join_callbacks = []

    @property
    def router(self):
        return self._router

    def start(self, background=True):
        """Start the WebSocket server."""
        if background:
            thread = threading.Thread(target=self._server.run_forever)
            thread.daemon = True
            thread.start()
            self._thread = thread
            return thread
        self._server.run_forever()
        return None

    def _on_new_client(self, client, server):
        try:
            gestures = self._router.get_gesture_names()
            battery_level = self._get_battery_level()
            payload = {
                "type": "hello",
                "gestures": gestures,
                "battery": battery_level,
            }
            server.send_message(client, json.dumps(payload))
        except Exception:
            # Avoid breaking client connection on greeting issues.
            pass
        if self._client_join_callbacks:
            for callback in list(self._client_join_callbacks):
                try:
                    callback(client, self)
                except Exception as exc:
                    log_debug("control", "client join callback failed: %s" % exc)

    def _on_message(self, client, server, message):
        command, payload = self._parse_message(message)
        if not command:
            self._send_ack(client, command, False, {"error": "invalid message"})
            return

        try:
            success, extra = self._router.route(command, payload)
        except ControlCommandError as exc:
            success, extra = False, {"error": str(exc)}
        except Exception as exc:
            success, extra = False, {"error": "unhandled error: {}".format(exc)}

        self._send_ack(client, command, success, extra)

        # Broadcast state changes to all clients
        if success and command in ("start_head_tracking", "stop_head_tracking",
                                   "enable_static_head", "disable_static_head"):
            self._broadcast_state_change(command, extra)

    def _parse_message(self, raw):
        if not raw:
            return None, {}

        text = raw.strip()
        if not text:
            return None, {}

        if text.startswith("{") and text.endswith("}"):
            try:
                data = json.loads(text)
                if isinstance(data, dict):
                    return self._normalize_json_payload(data)
            except ValueError:
                pass

        parts = text.split(None, 1)
        command = parts[0]
        payload = {}
        if len(parts) > 1:
            payload["argument"] = parts[1].strip()
        return command, payload

    def _normalize_json_payload(self, data):
        command = data.get("command") or data.get("type") or data.get("action")
        payload = dict(data)
        if command == "gesture" and "argument" not in payload and "name" not in payload:
            gesture = payload.get("gesture") or payload.get("value")
            if gesture:
                payload["name"] = gesture
        return command, payload

    def _send_ack(self, client, command, success, extra=None):
        payload = {
            "type": "ack",
            "ok": bool(success),
        }
        if command:
            payload["command"] = command
        if extra:
            for key, value in extra.items():
                if value is None:
                    continue
                payload[key] = value
        try:
            self._server.send_message(client, json.dumps(payload))
        except Exception:
            pass

    def _broadcast_state_change(self, command, extra=None):
        """Broadcast state change to all connected clients."""
        payload = {
            "type": "state_change",
            "command": command,
        }
        if extra:
            for key, value in extra.items():
                if value is None:
                    continue
                payload[key] = value
        try:
            self._server.send_message_to_all(json.dumps(payload))
        except Exception:
            pass

    def broadcast(self, payload, raw=False):
        """
        Broadcast a message to all connected clients.

        Args:
            payload: Dict to serialise (or raw string when raw=True).
            raw (bool): Treat payload as pre-serialised JSON when True.

        Returns:
            bool: True when the broadcast succeeded, False otherwise.
        """
        if payload is None:
            log_line("control", "broadcast skipped - empty payload", logging.WARNING)
            return False

        try:
            serialized = payload if raw else json.dumps(payload)
        except Exception as exc:
            log_line("control", "broadcast serialisation failed: %s" % exc, logging.ERROR)
            return False

        try:
            self._server.send_message_to_all(serialized)
            return True
        except Exception as exc:
            log_line("control", "broadcast delivery failed: %s" % exc, logging.ERROR)
            return False

    def send_message(self, client, payload, raw=False):
        """
        Send a payload to a specific WebSocket client.

        Args:
            client: Client descriptor returned by websocket_server.
            payload: Dict to serialise (or raw string when raw=True).
            raw (bool): Treat payload as pre-serialised JSON when True.
        """
        if client is None or payload is None:
            return False

        try:
            serialized = payload if raw else json.dumps(payload)
        except Exception as exc:
            log_line("control", "send_message serialisation failed: %s" % exc, logging.ERROR)
            return False

        try:
            self._server.send_message(client, serialized)
            return True
        except Exception as exc:
            log_line("control", "send_message delivery failed: %s" % exc, logging.ERROR)
            return False

    def register_client_join_callback(self, callback):
        """Register a callable that runs whenever a new WebSocket client connects."""
        if not callable(callback):
            return False
        self._client_join_callbacks.append(callback)
        return True

    def _video_local_url(self, video_id):
        """Return the relative tablet URL for a cached video file."""
        if not video_id:
            return None
        return "/videos/%s.mp4" % video_id

    def _set_video(self, payload):
        """Broadcast video playback info to all connected clients (tablets)."""
        url = payload.get("url", "")
        video_id = payload.get("video_id", "")
        local_url = payload.get("local_url") or self._video_local_url(video_id)

        if not url:
            return False, {"error": "missing video URL"}

        clients = list(getattr(self._server, "clients", []))
        client_count = len(clients)
        log_line("video", "Broadcasting video: %s (id: %s) to %d clients" % (url, video_id, client_count))

        if client_count == 0:
            log_line("video", "No connected clients to receive video broadcast", logging.WARNING)
            return False, {"error": "no tablet connected"}

        broadcast_payload = {
            "type": "set_video",
            "url": url,
            "video_id": video_id,
        }
        if local_url:
            broadcast_payload["local_url"] = local_url
        serialized = json.dumps(broadcast_payload)

        success = 0
        failures = []

        for client in clients:
            try:
                self._server.send_message(client, serialized)
                success += 1
            except Exception as exc:
                failures.append({
                    "address": client.get("address"),
                    "error": str(exc),
                })

        if success:
            log_line("video", "Video URL delivered to %d client(s)" % success)
        if failures:
            log_line("video", "Video delivery failures: %s" % failures, logging.WARNING)

        if success == 0:
            return False, {"error": "broadcast failed", "failures": failures}

        return True, {
            "action": "video_set",
            "url": url,
            "video_id": video_id,
            "delivered": success,
            "local_url": local_url,
            "failures": failures if failures else None,
        }

    def _get_battery_level(self):
        """Get current battery level from Pepper."""
        try:
            battery_service = self._session.service("ALBattery")
            level = battery_service.getBatteryCharge()
            return int(level)
        except Exception as exc:
            log_debug("battery", "Failed to get battery level: %s" % exc)
            return None

    def _battery_broadcast_loop(self):
        """Background thread to broadcast battery level every 30 seconds."""
        log_line("battery", "battery broadcast started (every 30s)")
        while not self._battery_stop.is_set():
            try:
                battery_level = self._get_battery_level()
                if battery_level is not None:
                    payload = {
                        "type": "battery_update",
                        "battery": battery_level,
                    }
                    self._server.send_message_to_all(json.dumps(payload))
                    log_debug("battery", "broadcasted battery: %d%%" % battery_level)
            except Exception as exc:
                log_debug("battery", "broadcast error: %s" % exc)

            # Wait 30 seconds or until stop event
            self._battery_stop.wait(30)

        log_line("battery", "battery broadcast stopped")

    def start_battery_updates(self):
        """Start background battery level broadcasting."""
        if self._battery_thread is not None:
            log_debug("battery", "battery updates already running")
            return

        self._battery_stop.clear()
        self._battery_thread = threading.Thread(target=self._battery_broadcast_loop)
        self._battery_thread.daemon = True
        self._battery_thread.start()
        log_line("battery", "battery updates enabled")

    def stop_battery_updates(self):
        """Stop background battery level broadcasting."""
        if self._battery_thread is None:
            return

        self._battery_stop.set()
        if self._battery_thread.is_alive():
            self._battery_thread.join(timeout=2)
        self._battery_thread = None
        log_line("battery", "battery updates disabled")
