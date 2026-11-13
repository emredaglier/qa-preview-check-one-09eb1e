export const VERTEX_SOURCE = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/**
 * One soft disc, premultiplied so the canvas can sit over the page. `falloff` in `math.ts` is the
 * same curve on the CPU (smoothstep of 1 - distance / radius); keep the two in step.
 */
export const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

uniform vec2 uRes;      // canvas size, device px
uniform vec2 uCenter;   // device px, origin top left
uniform float uRadius;  // device px, at least 1
uniform float uStrength;
uniform vec3 uColor;

out vec4 outColor;

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float t = clamp(1.0 - distance(pixel, uCenter) / uRadius, 0.0, 1.0);
  float alpha = t * t * (3.0 - 2.0 * t) * uStrength;
  outColor = vec4(uColor * alpha, alpha);
}
`
