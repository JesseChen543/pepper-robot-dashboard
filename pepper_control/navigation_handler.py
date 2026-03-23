#!/usr/bin/env python2
# -*- coding: utf-8 -*-

"""
navigation_handler.py - Navigation command handlers for Pepper WebSocket control server.

Provides command handlers for:
- Navigate to named location (navigate_to_location)
- Navigate to coordinates (navigate_to_coordinates)
- Start/stop exploration
- Start/stop localization
- Get current position
- Set/return to home
- Cancel navigation
- Get navigation status
- Add/remove locations
"""

import sys
import os
import logging

LOG = logging.getLogger("pepper.control.navigation")
if not LOG.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    LOG.addHandler(handler)
LOG.setLevel(logging.INFO)
LOG.propagate = False


def create_navigation_handlers(session, repo_root):
    """
    Create navigation command handlers.

    Args:
        session (qi.Session): Active NAOqi session.
        repo_root (str): Repository root path.

    Returns:
        dict: Mapping of command names to handler functions.
    """
    # Import navigation modules
    navigation_dir = os.path.join(repo_root, "pepper_navigation")
    if navigation_dir not in sys.path:
        sys.path.insert(0, navigation_dir)

    try:
        from location_manager import LocationManager
        from navigation_controller import NavigationController
    except ImportError as exc:
        LOG.warning("[navigation] Failed to import navigation modules: %s", exc)
        return {}

    # Initialize location manager and navigation controller
    location_db_path = os.path.join(repo_root, "restaurant_locations.json")
    location_manager = LocationManager(location_db_path)
    nav_controller = NavigationController(session, location_manager)

    LOG.info("[navigation] Initialized with %d locations", len(location_manager.get_all_locations()))

    # ========================================================================
    # COMMAND HANDLERS
    # ========================================================================

    def _navigate_to_location(payload):
        """Navigate to a named location"""
        location_name = payload.get("location", "").strip()

        if not location_name:
            LOG.warning("[navigation] No location specified")
            return {"ok": False, "error": "no_location_specified"}

        # Check if location exists
        location = location_manager.get_location(location_name)
        if not location:
            LOG.warning("[navigation] Location '%s' not found", location_name)
            available = location_manager.list_location_names()
            return {
                "ok": False,
                "error": "location_not_found",
                "location": location_name,
                "available_locations": available
            }

        try:
            success = nav_controller.navigate_to_location(location_name)
            if success:
                LOG.info("[navigation] Started navigation to '%s'", location_name)
                return {
                    "ok": True,
                    "location": location_name,
                    "coordinates": location
                }
            else:
                return {
                    "ok": False,
                    "error": "navigation_failed",
                    "location": location_name
                }
        except Exception as exc:
            LOG.error("[navigation] Navigate to location failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _navigate_to_coordinates(payload):
        """Navigate to specific coordinates"""
        try:
            x = float(payload.get("x", 0))
            y = float(payload.get("y", 0))
            theta = float(payload.get("theta", 0))

            success = nav_controller.navigate_to_coordinates(x, y, theta)
            if success:
                LOG.info("[navigation] Started navigation to (%.2f, %.2f, %.2f)", x, y, theta)
                return {
                    "ok": True,
                    "x": x,
                    "y": y,
                    "theta": theta
                }
            else:
                return {"ok": False, "error": "navigation_failed"}

        except ValueError as exc:
            LOG.warning("[navigation] Invalid coordinates: %s", exc)
            return {"ok": False, "error": "invalid_coordinates"}
        except Exception as exc:
            LOG.error("[navigation] Navigate to coordinates failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _cancel_navigation(payload):
        """Cancel ongoing navigation"""
        try:
            success = nav_controller.cancel_navigation()
            if success:
                LOG.info("[navigation] Navigation cancelled")
                return {"ok": True, "action": "cancelled"}
            else:
                return {"ok": False, "error": "cancel_failed"}
        except Exception as exc:
            LOG.error("[navigation] Cancel navigation failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _start_exploration(payload):
        """Start exploration/mapping mode"""
        try:
            success = nav_controller.start_exploration()
            if success:
                LOG.info("[navigation] Exploration started")
                return {"ok": True, "action": "exploration_started"}
            else:
                return {"ok": False, "error": "exploration_failed"}
        except Exception as exc:
            LOG.error("[navigation] Start exploration failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _stop_exploration(payload):
        """Stop exploration/mapping mode"""
        try:
            success = nav_controller.stop_exploration()
            if success:
                LOG.info("[navigation] Exploration stopped")
                return {"ok": True, "action": "exploration_stopped"}
            else:
                return {"ok": False, "error": "stop_exploration_failed"}
        except Exception as exc:
            LOG.error("[navigation] Stop exploration failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _save_exploration_map(payload):
        """Save exploration map to file"""
        filename = payload.get("filename", "restaurant_map.explo")
        try:
            # Save to repo root
            filepath = os.path.join(repo_root, filename)
            saved_path = nav_controller.save_exploration_map(filepath)
            if saved_path:
                LOG.info("[navigation] Saved exploration map to %s", saved_path)
                return {"ok": True, "filename": filename, "path": saved_path}
            else:
                return {"ok": False, "error": "save_failed"}
        except Exception as exc:
            LOG.error("[navigation] Save exploration map failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _load_exploration_map(payload):
        """Load exploration map from file"""
        filename = payload.get("filename", "restaurant_map.explo")
        try:
            filepath = os.path.join(repo_root, filename)
            success = nav_controller.load_exploration_map(filepath)
            if success:
                LOG.info("[navigation] Loaded exploration map from %s", filepath)
                return {"ok": True, "filename": filename, "path": filepath}
            else:
                return {"ok": False, "error": "load_failed"}
        except Exception as exc:
            LOG.error("[navigation] Load exploration map failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _start_localization(payload):
        """Start localization (determine position in map)"""
        try:
            success = nav_controller.start_localization()
            if success:
                LOG.info("[navigation] Localization started")
                return {"ok": True, "action": "localization_started"}
            else:
                return {"ok": False, "error": "localization_failed"}
        except Exception as exc:
            LOG.error("[navigation] Start localization failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _stop_localization(payload):
        """Stop localization"""
        try:
            success = nav_controller.stop_localization()
            if success:
                LOG.info("[navigation] Localization stopped")
                return {"ok": True, "action": "localization_stopped"}
            else:
                return {"ok": False, "error": "stop_localization_failed"}
        except Exception as exc:
            LOG.error("[navigation] Stop localization failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _get_robot_position(payload):
        """Get robot's current position in map"""
        try:
            position = nav_controller.get_robot_position()
            if position:
                LOG.info("[navigation] Position: (%.2f, %.2f, %.2f)",
                        position["x"], position["y"], position["theta"])
                return {
                    "ok": True,
                    "position": position
                }
            else:
                return {
                    "ok": False,
                    "error": "not_localized",
                    "message": "Robot not localized in map"
                }
        except Exception as exc:
            LOG.error("[navigation] Get position failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _set_home(payload):
        """Set current position as home"""
        try:
            success = nav_controller.set_home()
            if success:
                position = nav_controller.get_robot_position()
                LOG.info("[navigation] Home set")
                return {
                    "ok": True,
                    "action": "home_set",
                    "position": position
                }
            else:
                return {"ok": False, "error": "set_home_failed"}
        except Exception as exc:
            LOG.error("[navigation] Set home failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _return_to_home(payload):
        """Navigate back to home position"""
        try:
            success = nav_controller.return_to_home()
            if success:
                LOG.info("[navigation] Returning to home")
                return {"ok": True, "action": "returning_home"}
            else:
                return {"ok": False, "error": "return_home_failed"}
        except Exception as exc:
            LOG.error("[navigation] Return to home failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _get_navigation_status(payload):
        """Get current navigation status"""
        try:
            status = nav_controller.get_navigation_status()
            LOG.info("[navigation] Status retrieved")
            return {
                "ok": True,
                "status": status
            }
        except Exception as exc:
            LOG.error("[navigation] Get status failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _list_locations(payload):
        """Get list of all available locations"""
        try:
            locations = location_manager.get_all_locations()
            location_names = location_manager.list_location_names()
            LOG.info("[navigation] Listed %d locations", len(locations))
            return {
                "ok": True,
                "locations": locations,
                "location_names": location_names
            }
        except Exception as exc:
            LOG.error("[navigation] List locations failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _add_location(payload):
        """Add or update a location"""
        try:
            name = payload.get("name", "").strip()
            if not name:
                return {"ok": False, "error": "no_name_specified"}

            # Option 1: Use current robot position
            use_current = payload.get("use_current_position", False)
            if use_current:
                success = location_manager.update_location_from_robot(name, session)
                if success:
                    location = location_manager.get_location(name)
                    location_manager.save()
                    LOG.info("[navigation] Added location '%s' from current position", name)
                    return {
                        "ok": True,
                        "action": "location_added",
                        "name": name,
                        "location": location
                    }
                else:
                    return {"ok": False, "error": "failed_to_get_position"}

            # Option 2: Use provided coordinates
            x = float(payload.get("x", 0))
            y = float(payload.get("y", 0))
            theta = float(payload.get("theta", 0))
            description = payload.get("description", "")

            success = location_manager.add_location(name, x, y, theta, description)
            if success:
                location_manager.save()
                LOG.info("[navigation] Added location '%s'", name)
                return {
                    "ok": True,
                    "action": "location_added",
                    "name": name,
                    "location": {"x": x, "y": y, "theta": theta, "description": description}
                }
            else:
                return {"ok": False, "error": "add_location_failed"}

        except ValueError as exc:
            LOG.warning("[navigation] Invalid coordinates for add location: %s", exc)
            return {"ok": False, "error": "invalid_coordinates"}
        except Exception as exc:
            LOG.error("[navigation] Add location failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    def _remove_location(payload):
        """Remove a location from database"""
        name = payload.get("name", "").strip()
        if not name:
            return {"ok": False, "error": "no_name_specified"}

        try:
            success = location_manager.remove_location(name)
            if success:
                location_manager.save()
                LOG.info("[navigation] Removed location '%s'", name)
                return {
                    "ok": True,
                    "action": "location_removed",
                    "name": name
                }
            else:
                return {"ok": False, "error": "location_not_found"}
        except Exception as exc:
            LOG.error("[navigation] Remove location failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    # ========================================================================
    # HANDLER REGISTRATION
    # ========================================================================

    handlers = {
        "navigate_to_location": _navigate_to_location,
        "navigate_to_coordinates": _navigate_to_coordinates,
        "cancel_navigation": _cancel_navigation,
        "start_exploration": _start_exploration,
        "stop_exploration": _stop_exploration,
        "save_exploration_map": _save_exploration_map,
        "load_exploration_map": _load_exploration_map,
        "start_localization": _start_localization,
        "stop_localization": _stop_localization,
        "get_robot_position": _get_robot_position,
        "set_home": _set_home,
        "return_to_home": _return_to_home,
        "get_navigation_status": _get_navigation_status,
        "list_locations": _list_locations,
        "add_location": _add_location,
        "remove_location": _remove_location,
    }

    print("[navigation] Registered handlers: {}".format(handlers.keys()))
    return handlers
