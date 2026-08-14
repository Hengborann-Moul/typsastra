export function applyDarkPreviewPixels(pixels: Uint8ClampedArray): void {
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const luminance = (77 * red + 150 * green + 29 * blue) >> 8;
    const darkLuminance = 235 - ((209 * luminance) >> 8);
    pixels[index] = clampChannel(darkLuminance + ((230 * (red - luminance)) >> 8));
    pixels[index + 1] = clampChannel(darkLuminance + ((230 * (green - luminance)) >> 8));
    pixels[index + 2] = clampChannel(darkLuminance + ((230 * (blue - luminance)) >> 8));
  }
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}
