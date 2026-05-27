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
