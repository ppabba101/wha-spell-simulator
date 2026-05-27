/**
 * M7b — Per-element fragment shader sources.
 *
 * Sources are inlined as JS strings rather than imported with Vite's `?raw`
 * suffix so the unit tests (which run under plain Node, not Vite) can resolve
 * the module without a special loader. The companion `.frag` files in this
 * directory remain the canonical source of truth — keep them in sync.
 */

export const fireFrag = /* glsl */ `
precision mediump float;
varying vec2 vTextureCoord;
uniform float u_time;
uniform vec3 u_color;
uniform float u_intensity;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = vTextureCoord;
  vec2 c = uv - vec2(0.5);
  float r = length(c);
  float flicker = noise(uv * 8.0 + vec2(0.0, u_time * 2.0));
  float curl = noise(uv * 3.0 - vec2(u_time * 0.5)) - 0.5;
  uv += vec2(curl) * 0.06;
  float core = exp(-r * 4.5) * (0.65 + flicker * 0.55);
  vec3 palette = mix(vec3(1.0, 0.9, 0.35), vec3(0.95, 0.25, 0.05), smoothstep(0.0, 0.45, r));
  palette = mix(palette, u_color, 0.35);
  float alpha = clamp(core * u_intensity * 1.6, 0.0, 1.0);
  gl_FragColor = vec4(palette * core, alpha);
}
`;

export const waterFrag = /* glsl */ `
precision mediump float;
varying vec2 vTextureCoord;
uniform float u_time;
uniform vec3 u_color;
uniform float u_intensity;

void main() {
  vec2 uv = vTextureCoord;
  vec2 c = uv - vec2(0.5);
  float r = length(c);
  float a = sin(uv.x * 22.0 + u_time * 1.3) * 0.5 + 0.5;
  float b = sin(uv.y * 26.0 - u_time * 0.9) * 0.5 + 0.5;
  float caustic = pow(a * b, 1.6);
  vec2 refract = vec2(sin(uv.y * 12.0 + u_time), cos(uv.x * 12.0 - u_time)) * 0.02;
  float ring = smoothstep(0.5, 0.0, r);
  float intensity = caustic * ring * (0.6 + 0.4 * sin(u_time * 2.0 + r * 14.0));
  vec3 palette = mix(vec3(0.15, 0.55, 0.95), vec3(0.45, 0.95, 1.0), caustic);
  palette = mix(palette, u_color, 0.25);
  float alpha = clamp(intensity * u_intensity * 1.4, 0.0, 1.0);
  gl_FragColor = vec4(palette * intensity, alpha);
}
`;

export const windFrag = /* glsl */ `
precision mediump float;
varying vec2 vTextureCoord;
uniform float u_time;
uniform vec3 u_color;
uniform float u_intensity;

float hash(vec2 p) { return fract(sin(dot(p, vec2(91.3, 47.7))) * 28291.137); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = vTextureCoord;
  vec2 c = uv - vec2(0.5);
  float r = length(c);
  vec2 flow = vec2(u_time * 0.6, u_time * 0.15);
  float n1 = noise(uv * 4.0 + flow);
  float n2 = noise(uv * 8.0 - flow * 0.5);
  float wisps = pow(n1 * n2, 0.7);
  float ring = smoothstep(0.55, 0.05, r);
  vec3 palette = mix(vec3(0.85, 0.95, 1.0), u_color, 0.2);
  float alpha = clamp(wisps * ring * u_intensity * 0.85, 0.0, 0.9);
  gl_FragColor = vec4(palette, alpha);
}
`;

export const earthFrag = /* glsl */ `
precision mediump float;
varying vec2 vTextureCoord;
uniform float u_time;
uniform vec3 u_color;
uniform float u_intensity;

float hash(vec2 p) { return fract(sin(dot(p, vec2(53.3, 73.1))) * 19341.7); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = vTextureCoord;
  vec2 c = uv - vec2(0.5);
  float r = length(c);
  vec2 settle = vec2(0.0, sin(u_time * 0.6) * 0.04);
  float dust = fbm(uv * 6.0 + settle);
  float decay = exp(-r * 3.0);
  float intensity = dust * decay;
  vec3 palette = mix(vec3(0.55, 0.38, 0.18), vec3(0.78, 0.65, 0.35), dust);
  palette = mix(palette, u_color, 0.2);
  float alpha = clamp(intensity * u_intensity * 1.3, 0.0, 0.95);
  gl_FragColor = vec4(palette * (0.5 + dust), alpha);
}
`;

export const lightFrag = /* glsl */ `
precision mediump float;
varying vec2 vTextureCoord;
uniform float u_time;
uniform vec3 u_color;
uniform float u_intensity;

void main() {
  vec2 uv = vTextureCoord;
  vec2 c = uv - vec2(0.5);
  float r = length(c);
  float falloff = 1.0 / (1.0 + r * r * 12.0);
  float aberration = sin(u_time * 1.6 + r * 8.0) * 0.5 + 0.5;
  vec3 hot = vec3(1.0, 0.98, 0.82);
  vec3 cool = vec3(1.0, 0.85, 0.5);
  vec3 palette = mix(cool, hot, aberration);
  palette = mix(palette, u_color, 0.15);
  float bloom = pow(falloff, 1.3);
  float intensity = bloom * (0.85 + 0.15 * sin(u_time * 3.0));
  float alpha = clamp(intensity * u_intensity * 1.5, 0.0, 1.0);
  gl_FragColor = vec4(palette * intensity, alpha);
}
`;

export const ELEMENT_SHADERS = {
  fire: fireFrag,
  water: waterFrag,
  wind: windFrag,
  earth: earthFrag,
  light: lightFrag
};
