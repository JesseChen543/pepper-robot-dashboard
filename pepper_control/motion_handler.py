#!/usr/bin/env python2
# -*- coding: utf-8 -*-

"""
motion_handler.py - Motion control handlers for Pepper WebSocket control server.

Provides command handlers for:
- Posture control (stand, sit, crouch, rest)
- Movement (forward, backward, strafe, turn)
- Joystick-based movement
"""

import sys
import os
import logging

LOG = logging.getLogger("pepper.control.motion")
if not LOG.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    LOG.addHandler(handler)
LOG.setLevel(logging.INFO)
LOG.propagate = False


def create_motion_handlers(session, repo_root, control_server=None):
    """
    Create motion control command handlers.

    Args:
        session (qi.Session): Active NAOqi session.
        repo_root (str): Repository root path.
        control_server: Optional control server for broadcasting dance status.

    Returns:
        dict: Mapping of command names to handler functions.
    """
    # Import movement modules
    movement_dir = os.path.join(repo_root, "pepper_movement")
    if movement_dir not in sys.path:
        sys.path.insert(0, movement_dir)

    try:
        from modules.walk import WalkController
    except ImportError as exc:
        LOG.warning("[motion] Failed to import WalkController: %s", exc)
        return {}

    # Initialize walker
    walker = WalkController(session)

    # Track currently running dance process
    _current_dance = {"process": None, "name": None}

    def _go_to_posture(payload):
        """Handle go_to_posture command"""
        posture_name = payload.get("posture", "").strip().lower()

        # Map common names to NAOqi posture names
        posture_map = {
            "stand": "StandInit",
            "sit": "Sit",
            "crouch": "Crouch",
            "rest": "Rest",
            "standzero": "StandZero",
        }

        naoqi_posture = posture_map.get(posture_name)
        if not naoqi_posture:
            LOG.warning("[motion] Unknown posture: %s", posture_name)
            return {"ok": False, "error": "unknown_posture", "posture": posture_name}

        try:
            if naoqi_posture == "Rest":
                walker.rest()
            else:
                walker.go_to_posture(naoqi_posture, 1.0)
            LOG.info("[motion] Posture %s executed", posture_name)
            return {"ok": True, "posture": posture_name}
        except Exception as exc:
            LOG.error("[motion] Posture failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    # Track last movement command to detect obstacles
    _last_move_cmd = {"x": 0, "y": 0, "theta": 0, "time": 0}
    _obstacle_warning_sent = False

    def _move(payload):
        """Handle move command from joystick"""
        import time
        x = float(payload.get("x", 0))
        y = float(payload.get("y", 0))
        theta = float(payload.get("theta", 0))

        # If all values are zero, stop movement
        if x == 0 and y == 0 and theta == 0:
            try:
                walker.stop()
                _last_move_cmd["x"] = 0
                _last_move_cmd["y"] = 0
                _last_move_cmd["theta"] = 0
                return {"ok": True, "action": "stopped"}
            except Exception as exc:
                return {"ok": False, "error": str(exc)}

        # Convert normalized joystick values to robot movement
        # x: forward/backward (-1 to 1)
        # y: left/right strafe (-1 to 1)
        # Scale to reasonable speeds
        x_speed = x * 0.3  # Max 0.3 m/s forward/backward
        y_speed = y * 0.2  # Max 0.2 m/s strafe
        theta_speed = theta * 0.5  # Max 0.5 rad/s rotation

        try:
            # Use ALMotion.moveToward for continuous movement
            motion = session.service("ALMotion")
            memory = session.service("ALMemory")

            # Check if this is rotation-only movement (turn left/right)
            is_rotation_only = (x == 0 and y == 0 and theta != 0)

            # PROACTIVE CHECK: Detect obstacles BEFORE sending movement command
            # Skip obstacle detection for rotation-only movements

            # Check bumper sensors (these trigger emergency stop)
            obstacle_detected = False
            obstacle_reason = ""

            if not is_rotation_only:
                try:
                    bumpers = [
                        "FrontTactilTouched",
                        "RearTactilTouched",
                        "RightBumperPressed",
                        "LeftBumperPressed"
                    ]
                    for bumper in bumpers:
                        try:
                            value = memory.getData(bumper)
                            if value > 0.5:  # Bumper is pressed
                                obstacle_detected = True
                                obstacle_reason = "Bumper pressed: {}".format(bumper)
                                print("[motion] OBSTACLE: {} is pressed".format(bumper))
                                break
                        except:
                            pass
                except Exception as e:
                    print("[motion] Could not check bumpers: {}".format(e))

                # If obstacle detected, stop and return error
                if obstacle_detected:
                    try:
                        motion.stopMove()
                    except:
                        pass
                    return {"ok": False, "error": "Movement blocked - " + obstacle_reason, "obstacle": True}

            # Check if external collision protection has been triggered
            try:
                ext_protection = motion.getExternalCollisionProtectionEnabled("All")
                if ext_protection:
                    # External collision is ON - this might block movement
                    # This is normal, but if we see emergency stop, it means collision was detected
                    pass
            except Exception as e:
                pass

            # REACTIVE CHECK: Detect if robot stopped moving due to collision
            # For continuous movement (moveToward), check velocity after acceleration period
            # Skip velocity check for rotation-only movements
            if not is_rotation_only:
                current_time = time.time()
                same_direction = (
                    _last_move_cmd["x"] == x and
                    _last_move_cmd["y"] == y and
                    _last_move_cmd["theta"] == theta
                )

                # Get the last time BEFORE updating
                last_time = _last_move_cmd["time"]

                # Only update timestamp when direction CHANGES (to track how long same direction held)
                if not same_direction:
                    _last_move_cmd["x"] = x
                    _last_move_cmd["y"] = y
                    _last_move_cmd["theta"] = theta
                    _last_move_cmd["time"] = current_time

                # Only check if we've been sending the SAME command for a while
                # This avoids false positives during acceleration or direction changes
                if (x != 0 or y != 0 or theta != 0) and same_direction and last_time > 0:
                    time_sending_command = current_time - last_time

                    # Wait for robot to accelerate (0.45 seconds), then continuously check
                    if time_sending_command > 0.45:
                        try:
                            # Get robot's actual velocity from ALMotion
                            robot_velocity = motion.getRobotVelocity()
                            # robot_velocity is [vx, vy, vtheta] in m/s
                            vx = abs(robot_velocity[0]) if len(robot_velocity) > 0 else 0
                            vy = abs(robot_velocity[1]) if len(robot_velocity) > 1 else 0
                            vtheta = abs(robot_velocity[2]) if len(robot_velocity) > 2 else 0

                            # If velocity is near zero after acceleration period -> obstacle
                            is_actually_moving = (vx > 0.03 or vy > 0.03 or vtheta > 0.05)

                            if not is_actually_moving:
                                # We're sending move commands but robot isn't moving
                                print("[motion] OBSTACLE DETECTED - velocity near zero after {:.2f}s".format(time_sending_command))
                                motion.stopMove()
                                error_response = {"ok": False, "error": "Movement blocked - obstacle detected", "obstacle": True}
                                return error_response
                        except Exception as e:
                            print("[motion] Velocity check error: {}".format(e))

            # Send movement command
            motion.moveToward(x_speed, y_speed, theta_speed)
            return {"ok": True, "x": x_speed, "y": y_speed, "theta": theta_speed}
        except Exception as exc:
            LOG.error("[motion] Move failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _forward(payload):
        """Move forward by distance"""
        distance = float(payload.get("distance", 0.5))
        try:
            result = walker.forward(distance)
            if result:
                return {"ok": True, "action": "forward", "distance": distance}
            else:
                return {"ok": False, "error": "Movement blocked - obstacle detected or path not clear"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _backward(payload):
        """Move backward by distance"""
        distance = float(payload.get("distance", 0.5))
        try:
            result = walker.backward(distance)
            if result:
                return {"ok": True, "action": "backward", "distance": distance}
            else:
                return {"ok": False, "error": "Movement blocked - obstacle detected or path not clear"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _turn_left(payload):
        """Turn left by degrees"""
        degrees = float(payload.get("degrees", 90))
        try:
            result = walker.turn_degrees_left(degrees)
            if result:
                return {"ok": True, "action": "turn_left", "degrees": degrees}
            else:
                return {"ok": False, "error": "Turn blocked - obstacle detected or path not clear"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _turn_right(payload):
        """Turn right by degrees"""
        degrees = float(payload.get("degrees", 90))
        try:
            result = walker.turn_degrees_right(degrees)
            if result:
                return {"ok": True, "action": "turn_right", "degrees": degrees}
            else:
                return {"ok": False, "error": "Turn blocked - obstacle detected or path not clear"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _stop(payload):
        """Emergency stop"""
        try:
            walker.stop()
            return {"ok": True, "action": "stopped"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _move_head(payload):
        """Move Pepper's head (camera)"""
        print("[motion] move_head called with payload: {}".format(payload))
        try:
            motion = session.service("ALMotion")

            # Get target angles from payload (relative movement)
            yaw = float(payload.get("yaw", 0))    # Horizontal (left/right)
            pitch = float(payload.get("pitch", 0)) # Vertical (up/down)
            print("[motion] Moving head - yaw: {}, pitch: {}".format(yaw, pitch))

            # If both are zero, center the head
            if yaw == 0 and pitch == 0:
                # Absolute positioning to center
                motion.setAngles(["HeadYaw", "HeadPitch"], [0.0, 0.0], 0.2)
                LOG.info("[motion] Head centered")
                return {"ok": True, "action": "head_centered"}

            # Get current head position
            current_yaw = motion.getAngles("HeadYaw", True)[0]
            current_pitch = motion.getAngles("HeadPitch", True)[0]

            # Calculate new positions (relative movement)
            new_yaw = current_yaw + yaw
            new_pitch = current_pitch + pitch

            # Apply limits (HeadYaw: -2.09 to +2.09, HeadPitch: -0.71 to +0.64)
            new_yaw = max(-2.0, min(2.0, new_yaw))
            new_pitch = max(-0.6, min(0.5, new_pitch))

            # Move head with higher speed for smoother continuous movement
            motion.setAngles(["HeadYaw", "HeadPitch"], [new_yaw, new_pitch], 0.5)

            LOG.info("[motion] Head moved - yaw: {:.2f}, pitch: {:.2f}".format(new_yaw, new_pitch))
            return {"ok": True, "yaw": new_yaw, "pitch": new_pitch}

        except Exception as exc:
            LOG.error("[motion] Move head failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _christmas_dance(payload):
        """Perform Christmas dance choreography"""
        try:
            import subprocess
            import threading

            LOG.info("[motion] Starting Christmas dance...")

            # Path to christmas dance script
            dance_script = os.path.join(repo_root, "pepper_movement", "christmas_dance.py")

            if not os.path.exists(dance_script):
                LOG.error("[motion] Christmas dance script not found: %s", dance_script)
                return {"ok": False, "error": "Christmas dance script not found"}

            # Get Pepper's IP from session
            pepper_ip = "127.0.0.1"  # Running on Pepper itself

            # Set dance name BEFORE starting thread to avoid race condition
            _current_dance["name"] = "Christmas Dance"

            def run_dance():
                """Run dance in background thread"""
                try:
                    # Run the dance script
                    proc = subprocess.Popen([
                        "python2.7",
                        dance_script,
                        "--ip", pepper_ip
                    ])
                    # Set process reference immediately
                    _current_dance["process"] = proc
                    LOG.info("[motion] Christmas dance process started (pid=%s)", proc.pid)

                    # Wait for completion
                    result = proc.wait()

                    if result == 0:
                        LOG.info("[motion] Christmas dance completed successfully")
                    else:
                        LOG.error("[motion] Christmas dance failed with code: %s", result)

                    _current_dance["process"] = None
                    _current_dance["name"] = None

                except Exception as exc:
                    LOG.error("[motion] Christmas dance error: %s", exc)
                    _current_dance["process"] = None
                    _current_dance["name"] = None

            # Start dance in background thread
            dance_thread = threading.Thread(target=run_dance)
            dance_thread.daemon = True
            dance_thread.start()

            # Small delay to ensure process is started
            import time
            time.sleep(0.1)

            return {"ok": True, "action": "christmas_dance_started", "duration": 20}

        except Exception as exc:
            LOG.error("[motion] Christmas dance failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _birthday_dance(payload):
        """Perform Birthday dance choreography"""
        try:
            import subprocess
            import threading

            LOG.info("[motion] Starting Birthday dance...")

            # Path to birthday dance script
            dance_script = os.path.join(repo_root, "pepper_movement", "birthday_dance.py")

            if not os.path.exists(dance_script):
                LOG.error("[motion] Birthday dance script not found: %s", dance_script)
                return {"ok": False, "error": "Birthday dance script not found"}

            # Get Pepper's IP from session
            pepper_ip = "127.0.0.1"  # Running on Pepper itself

            # Set dance name BEFORE starting thread to avoid race condition
            _current_dance["name"] = "Birthday Dance"

            def run_dance():
                """Run dance in background thread"""
                try:
                    # Run the dance script
                    proc = subprocess.Popen([
                        "python2.7",
                        dance_script,
                        "--ip", pepper_ip
                    ])
                    # Set process reference immediately
                    _current_dance["process"] = proc
                    LOG.info("[motion] Birthday dance process started (pid=%s)", proc.pid)

                    # Wait for completion
                    result = proc.wait()

                    if result == 0:
                        LOG.info("[motion] Birthday dance completed successfully")
                    else:
                        LOG.error("[motion] Birthday dance failed with code: %s", result)

                    _current_dance["process"] = None
                    _current_dance["name"] = None

                except Exception as exc:
                    LOG.error("[motion] Birthday dance error: %s", exc)
                    _current_dance["process"] = None
                    _current_dance["name"] = None

            # Start dance in background thread
            dance_thread = threading.Thread(target=run_dance)
            dance_thread.daemon = True
            dance_thread.start()

            # Small delay to ensure process is started
            import time
            time.sleep(0.1)

            return {"ok": True, "action": "birthday_dance_started", "duration": 35}

        except Exception as exc:
            LOG.error("[motion] Birthday dance failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _kungfu_dance(payload):
        """Perform Kung Fu dance choreography"""
        try:
            import subprocess
            import threading

            LOG.info("[motion] Starting Kung Fu dance...")

            # Path to kung fu dance script
            dance_script = os.path.join(repo_root, "pepper_movement", "kungfu_dance.py")

            if not os.path.exists(dance_script):
                LOG.error("[motion] Kung Fu dance script not found: %s", dance_script)
                return {"ok": False, "error": "Kung Fu dance script not found"}

            # Get Pepper's IP from session
            pepper_ip = "127.0.0.1"  # Running on Pepper itself

            # Set dance name BEFORE starting thread to avoid race condition
            _current_dance["name"] = "Kung Fu Dance"

            def run_dance():
                """Run dance in background thread"""
                try:
                    # Run the dance script
                    proc = subprocess.Popen([
                        "python2.7",
                        dance_script,
                        "--ip", pepper_ip
                    ])
                    # Set process reference immediately
                    _current_dance["process"] = proc
                    LOG.info("[motion] Kung Fu dance process started (pid=%s)", proc.pid)

                    # Wait for completion
                    result = proc.wait()

                    if result == 0:
                        LOG.info("[motion] Kung Fu dance completed successfully")
                    else:
                        LOG.error("[motion] Kung Fu dance failed with code: %s", result)

                    _current_dance["process"] = None
                    _current_dance["name"] = None

                except Exception as exc:
                    LOG.error("[motion] Kung Fu dance error: %s", exc)
                    _current_dance["process"] = None
                    _current_dance["name"] = None

            # Start dance in background thread
            dance_thread = threading.Thread(target=run_dance)
            dance_thread.daemon = True
            dance_thread.start()

            # Small delay to ensure process is started
            import time
            time.sleep(0.1)

            return {"ok": True, "action": "kungfu_dance_started", "duration": 60}

        except Exception as exc:
            LOG.error("[motion] Kung Fu dance failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _robot_dance(payload):
        """Perform Robot dance choreography"""
        try:
            import subprocess
            import threading

            LOG.info("[motion] Starting Robot dance...")

            # Path to robot dance script
            dance_script = os.path.join(repo_root, "pepper_movement", "robot_dance.py")

            if not os.path.exists(dance_script):
                LOG.error("[motion] Robot dance script not found: %s", dance_script)
                return {"ok": False, "error": "Robot dance script not found"}

            # Get Pepper's IP from session
            pepper_ip = "127.0.0.1"  # Running on Pepper itself

            # Set dance name BEFORE starting thread to avoid race condition
            _current_dance["name"] = "Robot Dance"

            def run_dance():
                """Run dance in background thread"""
                try:
                    # Run the dance script
                    proc = subprocess.Popen([
                        "python2.7",
                        dance_script,
                        "--ip", pepper_ip
                    ])
                    # Set process reference immediately
                    _current_dance["process"] = proc
                    LOG.info("[motion] Robot dance process started (pid=%s)", proc.pid)

                    # Wait for completion
                    result = proc.wait()

                    if result == 0:
                        LOG.info("[motion] Robot dance completed successfully")
                    else:
                        LOG.error("[motion] Robot dance failed with code: %s", result)

                    _current_dance["process"] = None
                    _current_dance["name"] = None

                except Exception as exc:
                    LOG.error("[motion] Robot dance error: %s", exc)
                    _current_dance["process"] = None
                    _current_dance["name"] = None

            # Start dance in background thread
            dance_thread = threading.Thread(target=run_dance)
            dance_thread.daemon = True
            dance_thread.start()

            # Small delay to ensure process is started
            import time
            time.sleep(0.1)

            return {"ok": True, "action": "robot_dance_started", "duration": 30}

        except Exception as exc:
            LOG.error("[motion] Robot dance failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _gangnam_dance(payload):
        """Perform Gangnam Style dance choreography"""
        try:
            import subprocess
            import threading

            LOG.info("[motion] Starting Gangnam Style dance...")

            # Path to gangnam dance script
            dance_script = os.path.join(repo_root, "pepper_movement", "gangnam_dance.py")

            if not os.path.exists(dance_script):
                LOG.error("[motion] Gangnam dance script not found: %s", dance_script)
                return {"ok": False, "error": "Gangnam dance script not found"}

            # Get Pepper's IP from session
            pepper_ip = "127.0.0.1"  # Running on Pepper itself

            # Set dance name BEFORE starting thread to avoid race condition
            _current_dance["name"] = "Gangnam Style Dance"

            def run_dance():
                """Run dance in background thread"""
                try:
                    # Run the dance script
                    proc = subprocess.Popen([
                        "python2.7",
                        dance_script,
                        "--ip", pepper_ip
                    ])
                    # Set process reference immediately
                    _current_dance["process"] = proc
                    LOG.info("[motion] Gangnam dance process started (pid=%s)", proc.pid)

                    # Wait for completion
                    result = proc.wait()

                    if result == 0:
                        LOG.info("[motion] Gangnam dance completed successfully")
                    else:
                        LOG.error("[motion] Gangnam dance failed with code: %s", result)

                    _current_dance["process"] = None
                    _current_dance["name"] = None

                except Exception as exc:
                    LOG.error("[motion] Gangnam dance error: %s", exc)
                    _current_dance["process"] = None
                    _current_dance["name"] = None

            # Start dance in background thread
            dance_thread = threading.Thread(target=run_dance)
            dance_thread.daemon = True
            dance_thread.start()

            # Small delay to ensure process is started
            import time
            time.sleep(0.1)

            return {"ok": True, "action": "gangnam_dance_started", "duration": 40}

        except Exception as exc:
            LOG.error("[motion] Gangnam dance failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _chacha_dance(payload):
        """Perform Cha Cha Slide dance choreography"""
        try:
            import subprocess
            import threading

            LOG.info("[motion] Starting Cha Cha Slide dance...")

            # Path to chacha dance script
            dance_script = os.path.join(repo_root, "pepper_movement", "chacha_dance.py")

            if not os.path.exists(dance_script):
                LOG.error("[motion] Cha Cha Slide script not found: %s", dance_script)
                return {"ok": False, "error": "Cha Cha Slide script not found"}

            # Get Pepper's IP from session
            pepper_ip = "127.0.0.1"  # Running on Pepper itself

            # Set dance name BEFORE starting thread to avoid race condition
            _current_dance["name"] = "Cha Cha Slide"

            def run_dance():
                """Run dance in background thread"""
                try:
                    # Run the dance script
                    proc = subprocess.Popen([
                        "python2.7",
                        dance_script,
                        "--ip", pepper_ip
                    ])
                    # Set process reference immediately
                    _current_dance["process"] = proc
                    LOG.info("[motion] Cha Cha Slide process started (pid=%s)", proc.pid)

                    # Wait for completion
                    result = proc.wait()

                    if result == 0:
                        LOG.info("[motion] Cha Cha Slide completed successfully")
                    else:
                        LOG.error("[motion] Cha Cha Slide failed with code: %s", result)

                    _current_dance["process"] = None
                    _current_dance["name"] = None

                except Exception as exc:
                    LOG.error("[motion] Cha Cha Slide error: %s", exc)
                    _current_dance["process"] = None
                    _current_dance["name"] = None

            # Start dance in background thread
            dance_thread = threading.Thread(target=run_dance)
            dance_thread.daemon = True
            dance_thread.start()

            # Small delay to ensure process is started
            import time
            time.sleep(0.1)

            return {"ok": True, "action": "chacha_dance_started", "duration": 55}

        except Exception as exc:
            LOG.error("[motion] Cha Cha Slide failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _stop_dance(payload):
        """Stop currently running dance and reset Pepper to standing posture"""
        try:
            import time

            dance_name = _current_dance.get("name")
            process = _current_dance.get("process")

            # Check if process exists and is running
            if process and process.poll() is None:
                LOG.info("[motion] Stopping %s...", dance_name)

                # Terminate the dance process
                process.terminate()

                # Give it 1 second to terminate gracefully
                time.sleep(1)

                # Force kill if still running
                if process.poll() is None:
                    process.kill()
                    LOG.warning("[motion] Force killed dance process")

                _current_dance["process"] = None
                _current_dance["name"] = None

                # Stop audio playback
                try:
                    LOG.info("[motion] Stopping audio playback...")
                    audio_player = session.service("ALAudioPlayer")
                    audio_player.stopAll()
                    LOG.info("[motion] Audio stopped")
                except Exception as audio_exc:
                    LOG.warning("[motion] Failed to stop audio: %s", audio_exc)

                # Reset Pepper to standing posture
                try:
                    LOG.info("[motion] Resetting Pepper to standing posture...")
                    motion = session.service("ALMotion")
                    posture = session.service("ALRobotPosture")

                    # Stop any ongoing movement
                    motion.stopMove()

                    # Go to standing posture
                    posture.goToPosture("StandInit", 0.8)
                    LOG.info("[motion] Pepper reset to standing posture")
                except Exception as posture_exc:
                    LOG.warning("[motion] Failed to reset posture: %s", posture_exc)

                LOG.info("[motion] Dance stopped successfully")
                return {"ok": True, "action": "dance_stopped", "dance_name": dance_name}

            elif dance_name:
                # Dance name set but process not running yet or already finished
                LOG.warning("[motion] Dance '%s' not currently running (process not active)", dance_name)
                _current_dance["process"] = None
                _current_dance["name"] = None
                return {"ok": False, "error": "dance_not_active"}
            else:
                LOG.warning("[motion] No dance currently running")
                return {"ok": False, "error": "no_dance_running"}

        except Exception as exc:
            LOG.error("[motion] Stop dance failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    handlers = {
        "go_to_posture": _go_to_posture,
        "move": _move,
        "forward": _forward,
        "backward": _backward,
        "turn_left": _turn_left,
        "turn_right": _turn_right,
        "stop_action": _stop,
        "move_head": _move_head,
        "christmas_dance": _christmas_dance,
        "birthday_dance": _birthday_dance,
        "kungfu_dance": _kungfu_dance,
        "robot_dance": _robot_dance,
        "gangnam_dance": _gangnam_dance,
        "chacha_dance": _chacha_dance,
        "stop_dance": _stop_dance,
    }

    print("[motion] Registered handlers: {}".format(handlers.keys()))
    return handlers
