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
