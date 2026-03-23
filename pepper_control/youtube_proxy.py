#!/usr/bin/env python2
# -*- coding: utf-8 -*-
"""
YouTube Video Proxy for Pepper's Old Browser

Downloads YouTube videos and serves them as MP4 files that work on Chrome 44.
Uses youtube-dl to fetch videos.

INSTALL:
    pip install youtube-dl

USAGE:
    python youtube_proxy.py --video-id VIDEO_ID
"""

import subprocess
import os
import sys
import argparse


def download_video(video_id, output_dir="/tmp/pepper_videos"):
    """Download YouTube video as MP4"""
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    output_file = os.path.join(output_dir, "{}.mp4".format(video_id))

    # Check if already downloaded
    if os.path.exists(output_file):
        print("[youtube] Video already downloaded: {}".format(output_file))
        return output_file

    # Download with youtube-dl
    url = "https://www.youtube.com/watch?v={}".format(video_id)
    cmd = [
        "youtube-dl",
        "-f", "best[ext=mp4]/best",  # Prefer MP4
        "-o", output_file,
        url
    ]

    print("[youtube] Downloading: {}".format(url))
    print("[youtube] Command: {}".format(" ".join(cmd)))

    try:
        subprocess.check_call(cmd)
        print("[youtube] Downloaded to: {}".format(output_file))
        return output_file
    except subprocess.CalledProcessError as e:
        print("[youtube] Download failed: {}".format(e))
        return None
    except OSError:
        print("[youtube] ERROR: youtube-dl not installed")
        print("[youtube] Install with: pip install youtube-dl")
        return None


def main():
    parser = argparse.ArgumentParser(description="Download YouTube video for Pepper")
    parser.add_argument("--video-id", required=True, help="YouTube video ID")
    parser.add_argument("--output-dir", default="/tmp/pepper_videos", help="Output directory")
    args = parser.parse_args()

    output_file = download_video(args.video_id, args.output_dir)
    if output_file:
        print("[youtube] SUCCESS: {}".format(output_file))
        return 0
    else:
        print("[youtube] FAILED")
        return 1


if __name__ == "__main__":
    sys.exit(main())
