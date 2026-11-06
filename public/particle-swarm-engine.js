const DEFAULT_COUNT = 20000;
const TAU = Math.PI * 2;

export function particleCountForViewport(width) {
  if (Number(width) < 420) return 12000;
  if (Number(width) < 760) return 16000;
  return DEFAULT_COUNT;
}

export function generateParticleData(count = DEFAULT_COUNT, seed = 0x51f15e) {
  const safeCount = Math.max(1, Math.min(30000, Math.floor(Number(count) || DEFAULT_COUNT)));
  const data = new Float32Array(safeCount * 4);
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < safeCount; index += 1) {
    const band = index % 100;
    const y = 1 - 2 * ((index + 0.5) / safeCount);
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * goldenAngle;
    let x = Math.cos(angle) * radial;
    let z = Math.sin(angle) * radial;
    let scale = 0.78 + random() * 0.34;

    if (band >= 68 && band < 88) {
      const orbit = angle * 0.42 + random() * 0.12;
      const major = 1.04 + random() * 0.24;
      const minor = (random() - 0.5) * 0.13;
      x = Math.cos(orbit) * (major + minor);
      z = Math.sin(orbit) * (major + minor);
      const tilt = (random() - 0.5) * 0.34;
      scale = 0.86 + random() * 0.12;
      data[index * 4 + 1] = y * 0.17 + tilt;
    } else if (band >= 88) {
      const inner = 0.12 + random() * 0.55;
      x *= inner;
      y *= inner;
      z *= inner;
      scale = 0.84 + random() * 0.18;
      data[index * 4 + 1] = y;
    } else {
      data[index * 4 + 1] = y * scale;
    }

    data[index * 4] = x * scale;
    data[index * 4 + 2] = z * scale;
    data[index * 4 + 3] = random();
  }

  return data;
}

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute float aSeed;
uniform float uTime;
uniform float uEnergy;
uniform float uAspect;
uniform float uPixelRatio;
uniform float uMotion;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float tick = uTime * uMotion;
  float angle = tick * (0.075 + aSeed * 0.022);
  float cs = cos(angle);
  float sn = sin(angle);
  vec3 p = aPosition;
  float rotatedX = p.x * cs - p.z * sn;
  float rotatedZ = p.x * sn + p.z * cs;
  float breath = 1.0 + sin(tick * 0.72 + aSeed * 15.0) * (0.025 + uEnergy * 0.045);
  p.x = rotatedX * breath;
  p.z = rotatedZ * breath;
  p.y += sin(tick * 0.52 + aSeed * 19.0) * (0.018 + uEnergy * 0.035);
  p.x += sin(tick * 0.3 + aSeed * 8.0) * 0.012;
  float depth = 3.15 + p.z * 0.72;
  float perspective = 3.0 / max(1.35, depth);
  gl_Position = vec4(p.x * perspective * 1.13 * uAspect, p.y * perspective * 1.13, p.z * 0.28, 1.0);
  gl_PointSize = clamp((1.15 + (1.0 - aSeed) * 1.95 + uEnergy * 0.7) * perspective * uPixelRatio, 1.0, 5.4 * uPixelRatio);

  vec3 violet = vec3(0.58, 0.29, 0.97);
  vec3 rose = vec3(0.97, 0.15, 0.39);
  float blend = smoothstep(0.52, 0.94, aSeed);
  vColor = mix(violet, rose, blend);
  vAlpha = 0.32 + (1.0 - aSeed) * 0.57;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 point = gl_PointCoord - vec2(0.5);
  float radius = length(point);
  float core = 1.0 - smoothstep(0.10, 0.49, radius);
  float glow = exp(-radius * 7.2) * 0.36;
  float alpha = clamp((core * 0.7 + glow) * vAlpha, 0.0, 0.86);
  gl_FragColor = vec4(vColor * (0.76 + core * 0.75), alpha);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export function createParticleEngine(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    return { mode: "unavailable", setState() {}, destroy() {} };
  }

  const width = Number(canvas.clientWidth || canvas.width || 0);
  const count = Number.isFinite(options.count)
    ? Math.max(1, Math.min(30000, Math.floor(options.count)))
    : particleCountForViewport(width || 1024);
  const data = generateParticleData(count);
  const reducedMotion = Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    preserveDrawingBuffer: false
  }) || canvas.getContext("experimental-webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    preserveDrawingBuffer: false
  });

  if (!gl) {
    canvas.classList.add("energy-core--fallback");
    return { mode: "css-fallback", setState() {}, destroy() { canvas.classList.remove("energy-core--fallback"); } };
  }

  const program = createProgram(gl);
  if (!program) {
    canvas.classList.add("energy-core--fallback");
    return { mode: "shader-fallback", setState() {}, destroy() { canvas.classList.remove("energy-core--fallback"); } };
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    canvas.classList.add("energy-core--fallback");
    return { mode: "buffer-fallback", setState() {}, destroy() { canvas.classList.remove("energy-core--fallback"); } };
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, "aPosition");
  const seedLocation = gl.getAttribLocation(program, "aSeed");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(seedLocation);
  gl.vertexAttribPointer(seedLocation, 1, gl.FLOAT, false, 16, 12);

  const timeUniform = gl.getUniformLocation(program, "uTime");
  const energyUniform = gl.getUniformLocation(program, "uEnergy");
  const aspectUniform = gl.getUniformLocation(program, "uAspect");
  const pixelRatioUniform = gl.getUniformLocation(program, "uPixelRatio");
  const motionUniform = gl.getUniformLocation(program, "uMotion");
  const pixelRatio = Math.min(1.5, Math.max(1, Number(globalThis.devicePixelRatio) || 1));
  let energy = 0.18;
  let motion = reducedMotion ? 0 : 1;
  let frameId = 0;
  let destroyed = false;
  let visible = !globalThis.document?.hidden;
  let lastSize = "";
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(resize)
    : null;

  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * pixelRatio));
    const h = Math.max(1, Math.floor(rect.height * pixelRatio));
    const signature = w + "x" + h;
    if (signature === lastSize) return;
    lastSize = signature;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    draw(0);
  }

  function draw(timestamp) {
    if (destroyed) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform1f(timeUniform, Math.max(0, Number(timestamp) || 0) * 0.001);
    gl.uniform1f(energyUniform, energy);
    gl.uniform1f(aspectUniform, canvas.height / Math.max(1, canvas.width));
    gl.uniform1f(pixelRatioUniform, pixelRatio);
    gl.uniform1f(motionUniform, motion);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, count);
  }

  function animate(timestamp) {
    if (destroyed || !visible) return;
    draw(timestamp);
    if (!reducedMotion) frameId = requestAnimationFrame(animate);
  }

  function start() {
    if (destroyed || !visible || reducedMotion || frameId) {
      if (reducedMotion && visible) draw(0);
      return;
    }
    frameId = requestAnimationFrame(animate);
  }

  function onVisibilityChange() {
    visible = !globalThis.document?.hidden;
    if (!visible && frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
      return;
    }
    start();
  }

  function setState(nextState) {
    const values = { standby: 0.18, listening: 0.48, thinking: 0.7, speaking: 0.9, executing: 0.76, error: 0.25 };
    energy = values[nextState] ?? 0.18;
    if (reducedMotion) draw(0);
  }

  if (resizeObserver) resizeObserver.observe(canvas);
  else globalThis.addEventListener?.("resize", resize);
  globalThis.document?.addEventListener?.("visibilitychange", onVisibilityChange);
  resize();
  start();

  return {
    mode: "webgl",
    count,
    setState,
    destroy() {
      destroyed = true;
      if (frameId) cancelAnimationFrame(frameId);
      if (resizeObserver) resizeObserver.disconnect();
      else globalThis.removeEventListener?.("resize", resize);
      globalThis.document?.removeEventListener?.("visibilitychange", onVisibilityChange);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    }
  };
}
