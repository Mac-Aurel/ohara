// Deterministic grayscale tones for the "no photo" placeholder — keeps the
// monochrome palette while still giving each category a distinct shade.
const TONES = ['#161616', '#2c2c2c', '#454545', '#5c5c5c', '#747474', '#8c8c8c'];

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function categoryTone(label) {
  if (!label) return TONES[0];
  return TONES[hashString(label) % TONES.length];
}
