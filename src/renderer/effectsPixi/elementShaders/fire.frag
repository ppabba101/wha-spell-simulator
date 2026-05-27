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
