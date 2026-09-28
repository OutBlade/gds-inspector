/**
 * All layout geometry is instanced. Each instance carries its 2x2 linear part
 * and a translation split into float32 hi and lo halves, and the camera origin
 * is split the same way, so positions far from (0, 0) keep nanometre precision.
 */
const instanceHeader = /* glsl */ `
in vec3 position;
in vec4 iLin;
in vec2 iHi;
in vec2 iLo;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform vec2 uOriginHi;
uniform vec2 uOriginLo;

vec2 placeXY(vec2 p) {
  vec2 lin = vec2(iLin.x * p.x + iLin.z * p.y, iLin.y * p.x + iLin.w * p.y);
  return lin + ((iHi - uOriginHi) + (iLo - uOriginLo));
}
`;

export const flatVertex = /* glsl */ `
${instanceHeader}
uniform float uZ;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(placeXY(position.xy), uZ, 1.0);
}
`;

/** One pixel per placement, for cells far smaller than a pixel. */
export const pointVertex = /* glsl */ `
${instanceHeader}
uniform float uZ;
uniform float uSize;
void main() {
  gl_PointSize = uSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(placeXY(position.xy), uZ, 1.0);
}
`;

export const fillFragment = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTint;
uniform int uPattern;
uniform float uPx;
out vec4 outColor;

float stripe(float v, float period) {
  return step(mod(v, period), uPx * 1.25);
}

void main() {
  vec2 f = gl_FragCoord.xy;
  float p = 8.0 * uPx;
  float line = 0.0;
  if (uPattern == 0) line = 1.0;
  else if (uPattern == 1) discard;
  else if (uPattern == 2) line = stripe(f.x + f.y, p);
  else if (uPattern == 3) line = stripe(f.x - f.y + 4096.0, p);
  else if (uPattern == 4) line = max(stripe(f.x + f.y, p), stripe(f.x - f.y + 4096.0, p));
  else if (uPattern == 5) line = stripe(f.x, 5.0 * uPx) * stripe(f.y, 5.0 * uPx);
  else if (uPattern == 6) line = stripe(f.y, 6.0 * uPx);
  else if (uPattern == 7) line = stripe(f.x, 6.0 * uPx);
  else if (uPattern == 8) line = stripe(f.x + f.y, 4.0 * uPx);
  float a = uPattern == 0 ? uAlpha * 0.62 : mix(uAlpha * uTint, uAlpha * 0.9, line);
  outColor = vec4(uColor, a);
}
`;

export const edgeFragment = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uAlpha;
out vec4 outColor;
void main() {
  outColor = vec4(uColor, uAlpha);
}
`;

export const solidVertex = /* glsl */ `
${instanceHeader}
in vec3 normal;
uniform float uZ0;
uniform float uT;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec2 xy = placeXY(position.xy);
  vec2 n2 = vec2(iLin.x * normal.x + iLin.z * normal.y, iLin.y * normal.x + iLin.w * normal.y);
  vNormal = vec3(normalize(n2 + vec2(1e-12)) * length(normal.xy), normal.z);
  vec3 w = vec3(xy, uZ0 + position.z * uT);
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

export const solidFragment = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform vec3 uLight;
uniform vec4 uClip;
uniform float uClipOn;
uniform vec3 cameraPosition;
uniform vec3 uFog;
uniform vec2 uFogRange;
in vec3 vNormal;
in vec3 vWorld;
out vec4 outColor;
void main() {
  if (uClipOn > 0.5 && dot(uClip.xyz, vWorld) + uClip.w < 0.0) discard;
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  vec3 l = normalize(uLight);
  float diff = max(dot(n, l), 0.0);
  float hemi = 0.5 + 0.5 * n.z;
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0);
  vec3 c = uColor * (0.2 + 0.28 * hemi + 0.62 * diff) + vec3(0.14 * spec);
  float d = length(cameraPosition - vWorld);
  float fog = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 0.55);
  outColor = vec4(mix(c, uFog, fog), 1.0);
}
`;

/** Neutral stand-in for cells too small to draw: their bounding boxes. */
export const boxFragment = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uAlpha;
out vec4 outColor;
void main() {
  outColor = vec4(uColor, uAlpha);
}
`;
