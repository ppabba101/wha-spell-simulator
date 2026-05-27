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
