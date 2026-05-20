#!/usr/bin/env python3
"""
render-telemetry.py — Render telemetry overlay frames from JSON metrics
for mineflayer-real-movement YouTube video production.

Usage:
    python render-telemetry.py metrics.json --output-dir frames/
    ffmpeg -framerate 60 -i frames/frame_%05d.png -c:v png telemetry_overlay.mov

Requires: matplotlib, numpy
    pip install matplotlib numpy
"""

import argparse
import json
import math
import os
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np


def load_metrics(path: str) -> list[dict]:
    with open(path, 'r') as f:
        data = json.load(f)
    # Support both flat array and nested {ticks: [...]}
    if isinstance(data, list):
        return data
    return data.get('ticks', [])


def render_frame(tick: dict, idx: int, total: int, out_dir: Path):
    fig, axes = plt.subplots(2, 2, figsize=(8, 6), facecolor='black')
    fig.patch.set_alpha(0.0)

    yaw = tick.get('yaw', 0.0)
    pitch = tick.get('pitch', 0.0)
    speed = tick.get('speed', 0.0)
    state = tick.get('state', 'IDLE')
    reaction_delay = tick.get('reactionDelayMs', 0.0)
    jitter_yaw = tick.get('jitterYaw', 0.0)
    jitter_speed = tick.get('jitterSpeed', 0.0)

    # Panel 1: Yaw / Pitch polar-like bar
    ax = axes[0, 0]
    ax.set_facecolor('black')
    ax.bar(['Yaw', 'Pitch'], [abs(yaw % 360), abs(pitch)], color=['#00ff88', '#ff8800'])
    ax.set_ylim(0, 360)
    ax.set_title(f'Rotation  |  Yaw: {yaw:6.1f}°  Pitch: {pitch:5.1f}°', color='white', fontsize=9)
    ax.tick_params(colors='white', labelsize=8)
    ax.spines[:].set_color('white')

    # Panel 2: Speed time-series mini
    ax = axes[0, 1]
    ax.set_facecolor('black')
    ax.set_title(f'Speed  |  {speed:.3f} b/t  Jitter: {jitter_speed:.3f}', color='white', fontsize=9)
    ax.tick_params(colors='white', labelsize=8)
    ax.spines[:].set_color('white')
    # Placeholder: would need history buffer for real sparkline
    ax.text(0.5, 0.5, state, color='#00ff88', fontsize=14, ha='center', va='center',
            transform=ax.transAxes, fontweight='bold')
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xticks([])
    ax.set_yticks([])

    # Panel 3: Reaction delay gauge
    ax = axes[1, 0]
    ax.set_facecolor('black')
    ax.set_title(f'Reaction Delay  |  {reaction_delay:.0f} ms', color='white', fontsize=9)
    ax.tick_params(colors='white', labelsize=8)
    ax.spines[:].set_color('white')
    max_delay = 300
    pct = min(reaction_delay / max_delay, 1.0)
    ax.barh(['Delay'], [pct], color='#ff4444' if pct > 0.5 else '#44ff44', height=0.4)
    ax.set_xlim(0, 1)
    ax.set_xticks([0, 0.5, 1.0])
    ax.set_xticklabels(['0', '150', '300 ms'])

    # Panel 4: Jitter distribution
    ax = axes[1, 1]
    ax.set_facecolor('black')
    ax.set_title(f'Jitter  |  Yaw: {jitter_yaw:.2f}°  Speed: {jitter_speed:.3f}', color='white', fontsize=9)
    ax.tick_params(colors='white', labelsize=8)
    ax.spines[:].set_color('white')
    # Simple visual: two bars
    ax.bar(['Yaw jitter', 'Speed jitter'], [abs(jitter_yaw), abs(jitter_speed) * 10],
           color=['#00ccff', '#ff00cc'])
    ax.set_ylim(0, max(2.0, abs(jitter_yaw) * 1.5))

    fig.suptitle(f'mineflayer-real-movement  |  Tick {idx + 1}/{total}',
                 color='white', fontsize=10, y=0.98)

    plt.tight_layout(rect=[0, 0, 1, 0.95])
    out_path = out_dir / f'frame_{idx:05d}.png'
    fig.savefig(out_path, dpi=150, transparent=True, pad_inches=0.02)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description='Render telemetry overlay frames')
    parser.add_argument('metrics', help='Path to metrics JSON file')
    parser.add_argument('--output-dir', '-o', default='frames', help='Output directory for PNG frames')
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    ticks = load_metrics(args.metrics)
    if not ticks:
        print('No tick data found in metrics file.')
        return

    total = len(ticks)
    print(f'Rendering {total} frames to {out_dir}...')

    for i, tick in enumerate(ticks):
        render_frame(tick, i, total, out_dir)
        if (i + 1) % 100 == 0 or i == total - 1:
            print(f'  {i + 1}/{total} done')

    print(f'Complete. Overlay frames: {out_dir}')
    print('Next step: composite over gameplay with ffmpeg or DaVinci Resolve.')


if __name__ == '__main__':
    main()
