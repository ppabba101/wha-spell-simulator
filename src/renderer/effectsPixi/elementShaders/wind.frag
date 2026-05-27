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
