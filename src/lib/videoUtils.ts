/** Returns center-crop params for rendering a video element as a square. */
export function centerCropSquare(videoWidth: number, videoHeight: number) {
  const side = Math.min(videoWidth, videoHeight);
  return {
    side,
    sx: (videoWidth - side) / 2,
    sy: (videoHeight - side) / 2,
  };
}
