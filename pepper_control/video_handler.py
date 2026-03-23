#!/usr/bin/env python2
# -*- coding: utf-8 -*-

"""
video_handler.py - YouTube video download and playback handler

Downloads YouTube videos as MP4 files and serves them via HTTP
for playback on Pepper's old browser (Chrome 44).

DEPENDENCIES:
    pip install youtube-dl

USAGE:
    Commands exposed via WebSocket:
    - set_video: Download and play YouTube video
    - list_videos: List cached videos
    - delete_video: Delete cached video
"""

import os
import subprocess
import logging
import threading
import re

LOG = logging.getLogger("pepper.control.video")
if not LOG.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    LOG.addHandler(handler)
LOG.setLevel(logging.INFO)
LOG.propagate = False


# Video cache directory
VIDEO_CACHE_DIR = "/tmp/pepper_videos"
VIDEO_HTTP_PREFIX = "/videos"
DEFAULT_VIDEO_URL = os.environ.get(
    "PEPPER_DEFAULT_VIDEO_URL",
    "https://www.youtube.com/watch?v=74iDgbjTYNc"
)
MAX_RECENT_EVENTS = 5

if not os.path.exists(VIDEO_CACHE_DIR):
    try:
        os.makedirs(VIDEO_CACHE_DIR)
    except Exception:
        pass


def log_line(category, message, level=logging.INFO):
    LOG.log(level, "[%s] %s", category, message)


def local_video_url(video_id):
    """Return the HTTP path used by the tablet to stream a cached video."""
    if not video_id:
        return None
    return "{}/{}.mp4".format(VIDEO_HTTP_PREFIX, video_id)


def extract_video_id(url):
    """Extract YouTube video ID from URL"""
    if not url:
        return None

    # Direct video ID
    if re.match(r'^[a-zA-Z0-9_-]{11}$', url):
        return url

    # Extract from various YouTube URL formats
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/.*[?&]v=([a-zA-Z0-9_-]{11})',
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)

    return None


def download_video(video_id, output_dir=VIDEO_CACHE_DIR):
    """
    Download YouTube video as MP4 using youtube-dl

    Args:
        video_id: YouTube video ID
        output_dir: Directory to save video

    Returns:
        str: Path to downloaded video, or None if failed
    """
    if not os.path.exists(output_dir):
        try:
            os.makedirs(output_dir)
        except Exception as e:
            log_line("video", "Failed to create cache dir: {}".format(e), logging.ERROR)
            return None

    output_file = os.path.join(output_dir, "{}.mp4".format(video_id))

    # Check if already downloaded
    if os.path.exists(output_file):
        log_line("video", "Video already cached: {}".format(video_id))
        return output_file

    # Download with youtube-dl / yt-dlp
    url = "https://www.youtube.com/watch?v={}".format(video_id)
    ytdl_bin = os.environ.get("PEPPER_YTDL_BIN") or "youtube-dl"
    # Format 18 = 360p MP4 with audio, works reliably on old browsers like Chrome 44
    # Format 22 = 720p MP4 with audio
    # Avoid m3u8/HLS formats as they produce MPEG-TS which Chrome 44 can't play
    format_selector = os.environ.get(
        "PEPPER_YTDL_FORMAT",
        "18/22/135+140/best[ext=mp4][protocol^=http]/best"
    )

    # Build command with anti-bot bypass options
    cmd = [
        ytdl_bin,
        "-f", format_selector,
        "--no-playlist",
        "--no-warnings",
        "-o", output_file,
    ]

    # Force IPv4 to avoid YouTube 403 errors (see: https://github.com/yt-dlp/yt-dlp/issues/11868)
    force_ipv = os.environ.get("PEPPER_YTDL_FORCE_IP", "4")  # Default to IPv4
    if force_ipv == "4":
        cmd.append("-4")
    elif force_ipv == "6":
        cmd.append("-6")

    # Add user agent to avoid bot detection
    user_agent = os.environ.get(
        "PEPPER_YTDL_USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    cmd.extend(["--user-agent", user_agent])

    # Use Android player client to bypass 403 errors
    # See: https://github.com/yt-dlp/yt-dlp/issues/11868
    player_client = os.environ.get("PEPPER_YTDL_PLAYER_CLIENT", "android")
    cmd.extend(["--extractor-args", "youtube:player_client={}".format(player_client)])

    # Add cookies file if provided
    cookies_file = os.environ.get("PEPPER_YTDL_COOKIES")
    if cookies_file and os.path.exists(cookies_file):
        cmd.extend(["--cookies", cookies_file])

    # Add any extra args from environment
    extra_args = os.environ.get("PEPPER_YTDL_EXTRA_ARGS", "")
    if extra_args:
        cmd.extend(extra_args.split())

    # Finally add the URL
    cmd.append(url)

    log_line("video", "Downloading: {} -> {}".format(url, output_file))

    try:
        # Run in background to not block WebSocket
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout, stderr = proc.communicate()

        if proc.returncode == 0 and os.path.exists(output_file):
            log_line("video", "Downloaded successfully: {}".format(output_file))
            return output_file
        else:
            log_line("video", "Download failed (exit {}): {}".format(
                proc.returncode, stderr), logging.ERROR)
            return None

    except OSError as e:
        log_line("video", "youtube-dl not found - install with: pip install youtube-dl",
                 logging.ERROR)
        return None
    except Exception as e:
        log_line("video", "Download error: {}".format(e), logging.ERROR)
        return None


def download_video_async(video_id, callback=None, progress_callback=None):
    """
    Download video in background thread with progress tracking

    Args:
        video_id: YouTube video ID
        callback: Called when download completes (video_id, result_path)
        progress_callback: Called with progress updates (video_id, percent, eta, speed)
    """
    def _download():
        result = download_video_with_progress(video_id, progress_callback)
        if callback:
            callback(video_id, result)

    thread = threading.Thread(target=_download)
    thread.daemon = True
    thread.start()
    return thread


def download_video_with_progress(video_id, progress_callback=None, output_dir=VIDEO_CACHE_DIR):
    """
    Download YouTube video with real-time progress tracking

    Args:
        video_id: YouTube video ID
        progress_callback: Function to call with (video_id, percent, eta, speed)
        output_dir: Directory to save video

    Returns:
        str: Path to downloaded video, or None if failed
    """
    import re

    if not os.path.exists(output_dir):
        try:
            os.makedirs(output_dir)
        except Exception as e:
            log_line("video", "Failed to create cache dir: {}".format(e), logging.ERROR)
            return None

    output_file = os.path.join(output_dir, "{}.mp4".format(video_id))

    # Check if already downloaded
    if os.path.exists(output_file):
        log_line("video", "Video already cached: {}".format(video_id))
        if progress_callback:
            progress_callback(video_id, 100, "0s", "cached")
        return output_file

    # Download with youtube-dl / yt-dlp
    url = "https://www.youtube.com/watch?v={}".format(video_id)
    ytdl_bin = os.environ.get("PEPPER_YTDL_BIN") or "youtube-dl"
    # Format 18 = 360p MP4 with audio, works reliably on old browsers like Chrome 44
    # Format 22 = 720p MP4 with audio
    # Avoid m3u8/HLS formats as they produce MPEG-TS which Chrome 44 can't play
    format_selector = os.environ.get(
        "PEPPER_YTDL_FORMAT",
        "18/22/135+140/best[ext=mp4][protocol^=http]/best"
    )

    # Build command with anti-bot bypass options
    cmd = [
        ytdl_bin,
        "-f", format_selector,
        "--no-playlist",
        "--no-warnings",
        "-o", output_file,
        "--newline",  # Print progress on new lines for easier parsing
    ]

    # Force IPv4 to avoid YouTube 403 errors (see: https://github.com/yt-dlp/yt-dlp/issues/11868)
    force_ipv = os.environ.get("PEPPER_YTDL_FORCE_IP", "4")  # Default to IPv4
    if force_ipv == "4":
        cmd.append("-4")
    elif force_ipv == "6":
        cmd.append("-6")

    # Add user agent to avoid bot detection
    user_agent = os.environ.get(
        "PEPPER_YTDL_USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    cmd.extend(["--user-agent", user_agent])

    # Use Android player client to bypass 403 errors
    # See: https://github.com/yt-dlp/yt-dlp/issues/11868
    player_client = os.environ.get("PEPPER_YTDL_PLAYER_CLIENT", "android")
    cmd.extend(["--extractor-args", "youtube:player_client={}".format(player_client)])

    # Add cookies file if provided
    cookies_file = os.environ.get("PEPPER_YTDL_COOKIES")
    if cookies_file and os.path.exists(cookies_file):
        cmd.extend(["--cookies", cookies_file])

    # Add any extra args from environment
    extra_args = os.environ.get("PEPPER_YTDL_EXTRA_ARGS", "")
    if extra_args:
        cmd.extend(extra_args.split())

    # Finally add the URL
    cmd.append(url)

    log_line("video", "Downloading with progress tracking: {} -> {}".format(url, output_file))

    try:
        # Run with real-time stdout reading
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            universal_newlines=True
        )

        # Parse progress from yt-dlp output
        # Example: [download]  45.2% of 10.50MiB at 1.23MiB/s ETA 00:05
        progress_pattern = re.compile(r'\[download\]\s+(\d+(?:\.\d+)?)%.*?ETA\s+(\S+)')
        speed_pattern = re.compile(r'at\s+(\S+/s)')

        for line in iter(proc.stdout.readline, ''):
            line = line.strip()
            if not line:
                continue

            # Look for progress updates
            progress_match = progress_pattern.search(line)
            if progress_match and progress_callback:
                percent = float(progress_match.group(1))
                eta = progress_match.group(2)
                speed_match = speed_pattern.search(line)
                speed = speed_match.group(1) if speed_match else "unknown"
                progress_callback(video_id, percent, eta, speed)

        proc.wait()

        if proc.returncode == 0 and os.path.exists(output_file):
            log_line("video", "Downloaded successfully: {}".format(output_file))
            if progress_callback:
                progress_callback(video_id, 100, "0s", "completed")
            return output_file
        else:
            log_line("video", "Download failed (exit {})".format(proc.returncode), logging.ERROR)
            return None

    except OSError as e:
        log_line("video", "youtube-dl not found - install with: pip install youtube-dl",
                 logging.ERROR)
        return None
    except Exception as e:
        log_line("video", "Download error: {}".format(e), logging.ERROR)
        return None


def list_cached_videos(output_dir=VIDEO_CACHE_DIR):
    """List all cached videos"""
    if not os.path.exists(output_dir):
        return []

    videos = []
    for filename in os.listdir(output_dir):
        if filename.endswith(".mp4"):
            video_id = filename[:-4]  # Remove .mp4
            filepath = os.path.join(output_dir, filename)
            size = os.path.getsize(filepath)
            videos.append({
                "video_id": video_id,
                "filename": filename,
                "size_mb": round(size / 1024.0 / 1024.0, 2),
                "local_url": local_video_url(video_id),
            })

    return videos


def delete_cached_video(video_id, output_dir=VIDEO_CACHE_DIR):
    """Delete a cached video"""
    filepath = os.path.join(output_dir, "{}.mp4".format(video_id))
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
            log_line("video", "Deleted cached video: {}".format(video_id))
            return True
        except Exception as e:
            log_line("video", "Failed to delete video: {}".format(e), logging.ERROR)
            return False
    return False


def create_video_handlers(session, repo_root, control_server=None):
    """
    Create video download/playback command handlers

    Args:
        session: NAOqi session
        repo_root: Repository root path
        control_server: Optional control server for broadcasting

    Returns:
        dict: Handler mapping
    """
    recent_events = []

    def _record_event(message):
        if not isinstance(message, dict):
            return
        event_type = message.get("type")
        if not event_type:
            return
        # Remove previous entries of the same type to avoid stale data
        if event_type == "set_video":
            recent_events[:] = [evt for evt in recent_events if evt.get("type") != "set_video"]
        elif event_type in ("video_download_started", "video_download_failed"):
            recent_events[:] = [evt for evt in recent_events if evt.get("type") not in ("video_download_started", "video_download_failed")]
        recent_events.append(dict(message))
        while len(recent_events) > MAX_RECENT_EVENTS:
            recent_events.pop(0)

    def _send_recent_events(client=None):
        if not recent_events or control_server is None:
            return
        sender = getattr(control_server, "send_message", None)
        for event in list(recent_events):
            delivered = False
            if sender and client is not None:
                try:
                    delivered = sender(client, event)
                except Exception as exc:
                    log_line("video", "Failed to send event to new client: %s" % exc, logging.DEBUG)
                    delivered = False
            if not delivered:
                control_server.broadcast(event)

    tablet = None
    try:
        tablet = session.service("ALTabletService")
    except Exception as e:
        log_line("video", "Warning: Could not get tablet service: {}".format(e))

    def _broadcast(message):
        if not message:
            return False
        if isinstance(message, dict):
            _record_event(message)
        if not control_server:
            log_line("video", "Broadcast skipped (no control server)", logging.DEBUG)
            return False
        return control_server.broadcast(message)

    def _prime_default_video():
        url = (DEFAULT_VIDEO_URL or "").strip()
        if not url:
            return
        video_id = extract_video_id(url)
        if not video_id:
            log_line("video", "Default video URL invalid: %s" % url, logging.WARNING)
            return
        cached_path = os.path.join(VIDEO_CACHE_DIR, "%s.mp4" % video_id)
        local_url = local_video_url(video_id)

        if os.path.exists(cached_path):
            message = {
                "type": "set_video",
                "video_id": video_id,
                "url": url,
                "cached": True,
                "local_url": local_url,
                "default": True,
            }
            _record_event(message)
            if control_server:
                control_server.broadcast(message)
            return

        log_line("video", "Default video not cached, starting download: %s" % video_id)
        _broadcast({
            "type": "video_download_started",
            "video_id": video_id,
            "url": url,
            "default": True,
        })

        def _after_default(vid, result):
            if not result:
                log_line("video", "Default video download failed: %s" % vid, logging.WARNING)
                return
            message = {
                "type": "set_video",
                "video_id": vid,
                "url": url,
                "cached": True,
                "local_url": local_video_url(vid),
                "default": True,
            }
            _broadcast(message)

        download_video_async(video_id, _after_default)

    if control_server and hasattr(control_server, "register_client_join_callback"):
        control_server.register_client_join_callback(
            lambda client, _server: _send_recent_events(client)
        )

    _prime_default_video()

    def handle_set_video(payload):
        """Handle set_video command - download and play video"""
        url = payload.get("url", "")
        video_id = extract_video_id(url)

        if not video_id:
            log_line("video", "Invalid video URL: {}".format(url), logging.ERROR)
            return {"ok": False, "error": "Invalid video URL"}

        log_line("video", "Request to play video: {}".format(video_id))

        # Check if video is cached
        cached_path = os.path.join(VIDEO_CACHE_DIR, "{}.mp4".format(video_id))
        is_cached = os.path.exists(cached_path)
        local_url = local_video_url(video_id) if is_cached else None

        if is_cached:
            log_line("video", "Video already cached, playing: {}".format(video_id))
            # Broadcast to video player
            payload = {
                "type": "set_video",
                "video_id": video_id,
                "url": url,
                "cached": True,
                "local_url": local_url,
            }
            _broadcast(payload)
            return {
                "ok": True,
                "video_id": video_id,
                "cached": True,
                "local_url": local_url,
                "path": cached_path,
            }
        else:
            log_line("video", "Video not cached, starting download: {}".format(video_id))

            # Notify clients that download is starting
            _broadcast({
                "type": "video_download_started",
                "video_id": video_id,
                "url": url
            })

            # Progress callback to broadcast download progress
            def on_download_progress(vid, percent, eta, speed):
                _broadcast({
                    "type": "video_download_progress",
                    "video_id": vid,
                    "percent": percent,
                    "eta": eta,
                    "speed": speed
                })

            # Start download in background
            def on_download_complete(vid, result):
                if result:
                    log_line("video", "Download complete, broadcasting: {}".format(vid))
                    _broadcast({
                        "type": "set_video",
                        "video_id": vid,
                        "url": url,
                        "cached": True,
                        "local_url": local_video_url(vid),
                    })
                else:
                    log_line("video", "Download failed: {}".format(vid), logging.ERROR)
                    _broadcast({
                        "type": "video_download_failed",
                        "video_id": vid,
                        "url": url
                    })

            download_video_async(video_id, on_download_complete, on_download_progress)

            return {
                "ok": True,
                "video_id": video_id,
                "cached": False,
                "downloading": True,
                "local_url": local_video_url(video_id),
            }

    def handle_list_videos(payload):
        """List cached videos"""
        videos = list_cached_videos()
        log_line("video", "Listing {} cached videos".format(len(videos)))
        return {"ok": True, "videos": videos}

    def handle_delete_video(payload):
        """Delete cached video"""
        video_id = payload.get("video_id", "")
        if not video_id:
            return {"ok": False, "error": "video_id required"}

        success = delete_cached_video(video_id)
        return {"ok": success, "video_id": video_id}

    handlers = {
        "set_video": handle_set_video,
        "list_videos": handle_list_videos,
        "delete_video": handle_delete_video,
    }

    log_line("video", "Video handlers registered: {}".format(handlers.keys()))
    return handlers
