#!/usr/bin/env python2
# -*- coding: utf-8 -*-

"""
handler_registry.py - Central aggregation of Pepper control command handlers.

This module builds the dictionary of command handlers that are exposed through
the WebSocket control server. It pulls in camera, head-tracking, and TTS
handlers and allows callers to layer additional custom handlers (for example,
audio controls from Sound_Module).
"""

import logging
import os
import sys


LOG = logging.getLogger("pepper.control.registry")
if not LOG.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    LOG.addHandler(handler)
LOG.setLevel(logging.INFO)
LOG.propagate = False


def _ensure_path(path):
    """Ensure a directory is present on sys.path."""
    if not path:
        return False
    abs_path = os.path.abspath(path)
    if abs_path not in sys.path:
        sys.path.insert(0, abs_path)
        return True
    return False


def build_control_handlers(session, repo_root, audio_service=None,
                           extra_handlers=None, include_camera=True,
                           include_head_tracking=True, include_tts=True,
                           include_motion=True, include_navigation=True,
                           include_video=True):
    """
    Build the mapping of control commands to handler callables.

    Args:
        session (qi.Session): Active NAOqi session.
        repo_root (str): Repository root path for locating modules.
        audio_service: Optional ALAudioDevice service, required for TTS handlers.
        extra_handlers (dict): Optional base handlers to merge (e.g., audio).
        include_camera (bool): Whether to include camera handlers.
        include_head_tracking (bool): Whether to include head-tracking handlers.
        include_tts (bool): Whether to include TTS handlers.
        include_motion (bool): Whether to include motion handlers.
        include_navigation (bool): Whether to include navigation handlers.

    Returns:
        dict: Combined handler mapping.
    """
    repo_root = os.path.abspath(repo_root)
    _ensure_path(repo_root)

    handlers = {}
    control_server = None
    if extra_handlers:
        control_server = extra_handlers.get('control_server')
        handlers.update(extra_handlers)

    if include_motion:
        try:
            from pepper_control.motion_handler import create_motion_handlers
            # Pass control_server if available in extra_handlers
            motion_handlers = create_motion_handlers(session, repo_root, control_server)
            print("[registry] Motion handlers created: {}".format(motion_handlers.keys()))
            handlers.update(motion_handlers)
            LOG.info("[control] Motion handlers loaded: %s", motion_handlers.keys())
        except Exception as exc:
            LOG.warning("[control] Failed to load motion handlers: %s", exc)
            import traceback
            traceback.print_exc()

    if include_navigation:
        try:
            from pepper_control.navigation_handler import create_navigation_handlers
            navigation_handlers = create_navigation_handlers(session, repo_root)
            print("[registry] Navigation handlers created: {}".format(navigation_handlers.keys()))
            handlers.update(navigation_handlers)
            LOG.info("[control] Navigation handlers loaded: %s", navigation_handlers.keys())
        except Exception as exc:
            LOG.warning("[control] Failed to load navigation handlers: %s", exc)
            import traceback
            traceback.print_exc()

    if include_video:
        try:
            from pepper_control.video_handler import create_video_handlers
            video_handlers = create_video_handlers(session, repo_root, control_server=control_server)
            handlers.update(video_handlers)
            LOG.info("[control] Video handlers loaded: %s", video_handlers.keys())
        except Exception as exc:
            LOG.warning("[control] Failed to load video handlers: %s", exc)
            import traceback
            traceback.print_exc()

    if include_camera:
        try:
            from pepper_camera.camera_handler import create_camera_handlers
            handlers.update(create_camera_handlers(session, repo_root))
        except Exception as exc:
            LOG.warning("[control] Failed to load camera handlers: %s", exc)

    if include_head_tracking:
        try:
            from pepper_movement.head_tracking_handler import create_head_tracking_handlers
            handlers.update(create_head_tracking_handlers(session, repo_root))
        except Exception as exc:
            LOG.warning("[control] Failed to load head tracking handlers: %s", exc)

    if include_tts and audio_service is not None:
        voice_dir = os.path.join(repo_root, "pepper_voice")
        added_voice = _ensure_path(voice_dir)
        try:
            from tts_handler import create_tts_handlers
            handlers.update(create_tts_handlers(session, audio_service))
        except Exception as exc:
            LOG.warning("[control] Failed to load TTS handlers: %s", exc)
        finally:
            if added_voice and voice_dir in sys.path:
                try:
                    sys.path.remove(voice_dir)
                except ValueError:
                    pass

    return handlers
