"""Prototype v2 of intensity-based gel region detection.

Algorithm (mirrors planned JS implementation):
  1. grayscale + downscale (max dim ~1400)
  2. background = brightest strong histogram peak
  3. content mask = gray < background - margin
  4. row profile (content fraction per row), smooth, threshold at frac*max,
     merge runs separated by small gaps (lane gaps / dye-front gaps)
  5. same for columns within the detected rows, then refine rows again
  6. pad 1% and map back to full resolution
Outputs detected box + saves preview crops for visual comparison.
"""
import sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
MAXDIM = 1400


def smooth(a, win):
    if win < 2:
        return a
    kernel = np.ones(win) / win
    return np.convolve(a, kernel, mode="same")


def merged_runs(passing, gap_tol):
    """Indices of runs of `passing`, merging runs separated by <= gap_tol.
    Returns list of (start, end, total_count)."""
    runs = []
    start = None
    for i, p in enumerate(passing):
        if p and start is None:
            start = i
        elif not p and start is not None:
            runs.append([start, i])
            start = None
    if start is not None:
        runs.append([start, len(passing)])
    if not runs:
        return []
    merged = [runs[0]]
    for s, e in runs[1:]:
        if s - merged[-1][1] <= gap_tol:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [(s, e, e - s) for s, e in merged]


def best_group(passing, frac_max, rel, gap_tol):
    """Merged run group with the largest total, using cutoff rel*frac_max."""
    cutoff = rel * frac_max
    passing = passing >= cutoff
    groups = merged_runs(passing, gap_tol)
    if not groups:
        return None
    return max(groups, key=lambda g: g[2])


def detect(path, margin=30, rel_row=0.15, rel_col=0.15, save_as=None):
    img = Image.open(path).convert("L")
    w, h = img.size
    scale = min(1.0, MAXDIM / max(w, h))
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    gray = np.asarray(img.resize((sw, sh), Image.BILINEAR), dtype=np.uint8)

    hist = np.convolve(np.histogram(gray, bins=256, range=(0, 256))[0],
                       np.ones(3) / 3, mode="same")
    hist[:128] = 0
    bg = int(np.argmax(hist))

    mask = gray < (bg - margin)

    gap_y = max(2, round(0.05 * sh))
    gap_x = max(2, round(0.04 * sw))

    row_frac = smooth(mask.mean(axis=1), 3)
    g = best_group(row_frac, row_frac.max(), rel_row, gap_y)
    r0, r1 = g[0], g[1]

    col_frac = smooth(mask[r0:r1, :].mean(axis=0), 3)
    g = best_group(col_frac, col_frac.max(), rel_col, gap_x)
    c0, c1 = g[0], g[1]

    # refine rows within the detected columns
    row_frac2 = smooth(mask[:, c0:c1].mean(axis=1), 3)
    g = best_group(row_frac2, row_frac2.max(), rel_row, gap_y)
    r0, r1 = g[0], g[1]

    pad_y, pad_x = round(0.01 * sh), round(0.01 * sw)
    r0 = max(0, r0 - pad_y); r1 = min(sh, r1 + pad_y)
    c0 = max(0, c0 - pad_x); c1 = min(sw, c1 + pad_x)

    fx, fy = w / sw, h / sh
    box = (round(c0 * fx), round(r0 * fy), round(c1 * fx), round(r1 * fy))
    bw, bh = box[2] - box[0], box[3] - box[1]
    ok = bw > 0.15 * w and bh > 0.15 * h
    print(f"{path.split(chr(92))[-1]}  size={w}x{h} bg={bg}")
    print(f"  box(l,t,r,b)=({box[0]},{box[1]},{box[2]},{box[3]}) "
          f"{bw}x{bh} aspect={bw/bh:.3f} coverage={bw*bh/(w*h)*100:.0f}% ok={ok}")
    if save_as:
        img.crop(box).save(save_as, quality=85)
    return box


if __name__ == "__main__":
    detect(r"C:\Users\cadel\Documents\MIZZOU\YokomLab\OPTN\MBP-OPTN Purification 2025-16-12.jpg",
           save_as="tools/crop1.jpg")
    detect(r"C:\Users\cadel\Documents\MIZZOU\YokomLab\OPTN\MBP_OPTN_WT_04_23_26.jpg",
           save_as="tools/crop2.jpg")
    detect(r"C:\Users\cadel\Downloads\gel-analysis.png")
    detect(r"C:\Users\cadel\Downloads\gel-analysis (1).png")
