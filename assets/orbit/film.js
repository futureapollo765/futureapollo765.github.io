// H.264 stores the rendered color and its matching silhouette side by side.
// Recombining them on the GPU preserves the page behind the open metal rings.
export function createOrbitFilm(stage, onFrame, onError) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 672;
  canvas.className = "orbit-film-frame";
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, powerPreference: "low-power" });
  if (!gl) return null;

  const program = gl.createProgram();
  const shaders = [
    [gl.VERTEX_SHADER, `
      attribute vec2 position;
      varying vec2 uv;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        uv = position * vec2(0.5, -0.5) + 0.5;
      }`],
    [gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D film;
      uniform vec3 light;
      varying vec2 uv;
      void main() {
        vec3 metal = texture2D(film, vec2(uv.x * 0.5, uv.y)).rgb;
        float alpha = texture2D(film, vec2(0.5 + uv.x * 0.5, uv.y)).r;
        alpha = smoothstep(0.015, 0.985, alpha);
        float falloff = exp(-15.0 * dot(uv - light.xy, uv - light.xy));
        metal += vec3(0.13 * light.z * falloff * smoothstep(0.03, 0.65, metal.r));
        gl_FragColor = vec4(metal * alpha, alpha);
      }`],
  ];
  for (const [type, source] of shaders) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
    gl.texParameteri(gl.TEXTURE_2D, parameter, gl.LINEAR);
  }
  for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
    gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
  }
  const light = gl.getUniformLocation(program, "light");
  gl.uniform3f(light, 0.5, 0.5, 0);
  const video = document.createElement("video");
  video.className = "orbit-film-source";
  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  video.disablePictureInPicture = true;
  video.setAttribute("aria-hidden", "true");
  canvas.setAttribute("aria-hidden", "true");
  stage.append(video, canvas);

  let running = false;
  let pending = 0;
  function draw(mediaTime) {
    if (video.readyState < 2 || gl.isContextLost()) return;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    onFrame(mediaTime);
  }
  function nextFrame() {
    if (!running || pending) return;
    if (video.requestVideoFrameCallback) {
      pending = video.requestVideoFrameCallback((_, frame) => {
        pending = 0;
        if (!running) return;
        draw(frame.mediaTime);
        nextFrame();
      });
    } else {
      pending = requestAnimationFrame(() => {
        pending = 0;
        if (!running) return;
        draw(video.currentTime);
        nextFrame();
      });
    }
  }

  function pause() {
    running = false;
    video.pause();
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(pending);
    else cancelAnimationFrame(pending);
    pending = 0;
  }

  function play() {
    if (running) return;
    running = true;
    video.play().then(nextFrame).catch(error => {
      if (running && error.name !== "AbortError") onError();
    });
  }

  video.addEventListener("error", onError, { once: true });
  canvas.addEventListener("webglcontextlost", onError, { once: true });
  return {
    video, draw, pause, play,
    light(x, y, intensity) { gl.uniform3f(light, x, y, intensity); },
    dispose() {
      pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      canvas.remove();
      if (!gl.isContextLost()) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(vertices);
        gl.deleteProgram(program);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    },
  };
}
