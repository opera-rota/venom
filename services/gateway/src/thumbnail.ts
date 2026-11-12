import { screenLimits, Thumbnail } from "@venom/contracts";
import { decode, encode } from "jpeg-js";

const qualities = [62, 44, 28] as const;

function shrink(source: Uint8Array, width: number, height: number, targetWidth: number): { readonly data: Uint8Array; readonly width: number; readonly height: number } {
  if (width <= targetWidth) {
    return { data: source, width, height };
  }
  const scale = width / targetWidth;
  const targetHeight = Math.max(1, Math.round(height / scale));
  const data = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const top = Math.floor(y * scale);
    const bottom = Math.min(height, Math.max(top + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < targetWidth; x += 1) {
      const left = Math.floor(x * scale);
      const right = Math.min(width, Math.max(left + 1, Math.floor((x + 1) * scale)));
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let row = top; row < bottom; row += 1) {
        for (let column = left; column < right; column += 1) {
          const at = (row * width + column) * 4;
          red += source[at] ?? 0;
          green += source[at + 1] ?? 0;
          blue += source[at + 2] ?? 0;
        }
      }
      const area = (bottom - top) * (right - left);
      const to = (y * targetWidth + x) * 4;
      data[to] = red / area;
      data[to + 1] = green / area;
      data[to + 2] = blue / area;
      data[to + 3] = 255;
    }
  }
  return { data, width: targetWidth, height: targetHeight };
}

export function thumbnailOf(picture: string): Thumbnail | null {
  try {
    const decoded = decode(Buffer.from(picture, "base64"), { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 20, maxMemoryUsageInMB: 256 });
    const small = shrink(decoded.data, decoded.width, decoded.height, screenLimits.thumbnailWidth);
    for (const quality of qualities) {
      const encoded = encode(small, quality).data.toString("base64");
      const parsed = Thumbnail.safeParse(encoded);
      if (parsed.success) {
        return parsed.data;
      }
    }
    return null;
  } catch {
    return null;
  }
}
