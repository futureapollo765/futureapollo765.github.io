// Project the original studio renders onto their Blender geometry. The
// camera can sit at any angle between captures. Depth maps reject samples from
// an occluding hoop, so the moving edges come from the mesh, not a crossfade.
const vertexSource = `#version 300 es
layout(location=0) in vec4 packedVertex;
uniform vec2 camera, fromView, toView;
out vec3 fromCoord, toCoord, position;
flat out float finish;

vec3 project(vec3 p, vec2 rotation) {
  vec2 xy = vec2(dot(p.xy, vec2(rotation.x, -rotation.y)), dot(p.xy, rotation.yx));
  return vec3(xy.x / 2.725, p.z / 2.725, xy.y / 3.0);
}

void main() {
  vec3 p = packedVertex.xyz / 10000.0;
  position = project(p, camera);
  gl_Position = vec4(position, 1.0);
  fromCoord = project(p, fromView) * 0.5 + 0.5;
  toCoord = project(p, toView) * 0.5 + 0.5;
  finish = packedVertex.w;
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec3 fromCoord, toCoord, position;
flat in float finish;
uniform sampler2D captures, fromDepth, toDepth;
uniform vec2 fromTile, toTile;
uniform float fraction;
uniform vec3 pointerLight;
out vec4 color;

vec4 readCapture(vec3 coord, vec2 tile, sampler2D depthMap) {
  vec4 sampleColor = texture(captures, (tile + coord.xy) / 6.0);
  float depth = texture(depthMap, coord.xy).r;
  float edgeBias = 0.0015 + min(0.012, fwidth(coord.z) * 1.7);
  float visibility = 1.0 - smoothstep(edgeBias, edgeBias + 0.004, coord.z - depth);
  return vec4(sampleColor.rgb, sampleColor.a * visibility);
}

void main() {
  vec4 left = readCapture(fromCoord, fromTile, fromDepth);
  vec4 right = readCapture(toCoord, toTile, toDepth);
  vec2 weights = vec2(left.a * (1.0 - fraction), right.a * fraction);
  float total = weights.x + weights.y;
  vec3 surface = (weights.x * left.rgb + weights.y * right.rgb) / max(total, 0.0001);
  // Both captures can miss a narrow silhouette just revealed by the rotation.
  // Use the local face and its finish until a captured surface is visible.
  vec3 face = cross(dFdx(position), dFdy(position));
  vec3 normal = face * inversesqrt(max(dot(face, face), 1e-14));
  float silver = (finish < 1.5 || finish > 4.5) ? 0.38 : 0.12;
  float highlight = pow(abs(dot(normal, normalize(vec3(-0.5, 0.82, 0.64)))), 5.0);
  surface = mix(vec3(silver * (0.55 + highlight)), surface, smoothstep(0.0, 0.15, total));
  vec2 uv = position.xy * vec2(0.5, -0.5) + 0.5;
  vec2 delta = uv - pointerLight.xy;
  surface += 0.12 * pointerLight.z * exp(-15.0 * dot(delta, delta)) * smoothstep(0.03, 0.65, surface.r);
  color = vec4(surface, 1.0);
}`;

function createProgram(gl, fragment) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

async function loadMesh(url, signal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error("Could not load orbital geometry");
  let bytes = await response.arrayBuffer();
  const header = new Uint8Array(bytes);
  // Some static hosts automatically decompress .gz; handle both HTTP forms.
  if (header[0] === 0x1f && header[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = await new Response(stream).arrayBuffer();
  }
  const info = new DataView(bytes);
  if (info.getUint32(0) !== 0x4f524231) throw new Error("Invalid orbital geometry");
  const vertexCount = info.getUint32(4, true);
  const indexCount = info.getUint32(8, true);
  const wide = info.getUint32(12, true) === 4;
  const vertices = new Int16Array(bytes, 16, vertexCount * 4);
  const offset = vertices.byteOffset + vertices.byteLength;
  const indices = wide ? new Uint32Array(bytes, offset, indexCount) : new Uint16Array(bytes, offset, indexCount);
  return { vertices, indices, wide };
}

function rotation(degrees) {
  const angle = degrees * Math.PI / 180;
  return [Math.cos(angle), Math.sin(angle)];
}

export async function createOrbitRenderer(stage, onLoss, signal) {
  const canvas = document.createElement("canvas");
  canvas.className = "orbit-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, depth: true, powerPreference: "low-power" });
  if (!gl) throw new Error("WebGL2 unavailable");

  try {
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (maxTexture < 2160) throw new Error("Insufficient WebGL texture capacity");
    const compact = Math.min(stage.clientWidth, stage.clientHeight) < 420 || maxTexture < 3600;
    const size = compact ? 360 : 600;
    const atlas = new Image();
    atlas.src = new URL(`studio-${size}.webp`, import.meta.url).href;
    const cancelImage = () => atlas.removeAttribute("src");
    signal.addEventListener("abort", cancelImage, {once:true});
    let mesh;
    try {
      [mesh] = await Promise.all([loadMesh(new URL("assembly.mesh.gz", import.meta.url), signal), atlas.decode()]);
      if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    } finally {
      signal.removeEventListener("abort", cancelImage);
    }

    const program = createProgram(gl, fragmentSource);
    const depthProgram = createProgram(gl, "#version 300 es\nprecision highp float; void main() {}");
    const uniforms = {};
    for (const name of ["camera","fromView","toView","fromTile","toTile","fraction","captures","fromDepth","toDepth","pointerLight"]) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    const depthCamera = gl.getUniformLocation(depthProgram, "camera");
    gl.useProgram(program);
    gl.uniform1i(uniforms.captures, 0);
    gl.uniform1i(uniforms.fromDepth, 1);
    gl.uniform1i(uniforms.toDepth, 2);
    gl.uniform3f(uniforms.pointerLight, .5, .5, 0);

    const vertices = gl.createBuffer();
    const indices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.SHORT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    const indexCount = mesh.indices.length;
    const indexType = mesh.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

    const captureTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, captureTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Could not upload studio captures");
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const depthSize = compact ? 384 : 640;
    const maps = [1, 2].map(unit => {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT16, depthSize, depthSize);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const buffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Depth buffer unavailable");
      return { index: -1, texture, buffer };
    });
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 0);
    const captures = Array.from({length:36}, (_, index) => ({
      rotation: rotation(index * 10), tile: [index % 6, 5 - Math.floor(index / 6)],
    }));

    function reference(index, otherIndex) {
      let slot = maps.find(item => item.index === index);
      if (slot) return slot;
      slot = maps.find(item => item.index !== otherIndex);
      gl.useProgram(depthProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, slot.buffer);
      gl.viewport(0, 0, depthSize, depthSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniform2fv(depthCamera, captures[index].rotation);
      gl.drawElements(gl.TRIANGLES, indexCount, indexType, 0);
      slot.index = index;
      return slot;
    }

    function resize() {
      const edge = Math.max(1, Math.min(stage.clientWidth, stage.clientHeight));
      const pixels = Math.round(Math.min(edge * (window.devicePixelRatio || 1), compact ? 680 : 960));
      if (canvas.width !== pixels || canvas.height !== pixels) canvas.width = canvas.height = pixels;
    }

    function draw(angle, light) {
      const relative = angle / 10;
      const lower = Math.floor(relative) % 36;
      const upper = (lower + 1) % 36;
      const a = reference(lower, upper);
      const b = reference(upper, lower);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, a.texture);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, b.texture);
      gl.uniform2fv(uniforms.camera, rotation(angle));
      gl.uniform2fv(uniforms.fromView, captures[lower].rotation);
      gl.uniform2fv(uniforms.toView, captures[upper].rotation);
      gl.uniform2fv(uniforms.fromTile, captures[lower].tile);
      gl.uniform2fv(uniforms.toTile, captures[upper].tile);
      gl.uniform1f(uniforms.fraction, relative - Math.floor(relative));
      gl.uniform3fv(uniforms.pointerLight, light);
      gl.drawElements(gl.TRIANGLES, indexCount, indexType, 0);
    }
    function dispose() {
      canvas.removeEventListener("webglcontextlost", onLoss);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    canvas.addEventListener("webglcontextlost", onLoss, {once:true});
    resize();
    stage.append(canvas);
    return { draw, resize, dispose };
  } catch (error) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw error;
  }
}
