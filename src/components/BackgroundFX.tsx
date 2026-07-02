"use client";

import { useEffect, useRef } from "react";

// Fondo WebGL: degradado animado con "blobs" suaves estilo estadio nocturno.
// Es puramente decorativo; si WebGL no está disponible no hace nada.
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;

vec3 palette(float t){
  vec3 a = vec3(0.04,0.06,0.12);
  vec3 b = vec3(0.0, 0.88, 0.64);   // verde menta
  vec3 c = vec3(0.36,0.55,1.0);     // azul
  return a + 0.5*b*smoothstep(0.0,1.0,t) + 0.35*c*smoothstep(0.3,1.0,t);
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = uv;
  p.x *= u_res.x / u_res.y;

  float glow = 0.0;
  for(int i=0;i<4;i++){
    float fi = float(i);
    vec2 c = vec2(
      0.5 + 0.42*sin(u_time*0.18 + fi*1.7),
      0.5 + 0.40*cos(u_time*0.15 + fi*2.3)
    );
    c.x *= u_res.x/u_res.y;
    float d = length(p - c);
    glow += 0.045 / (d*d + 0.02);
  }
  float t = clamp(glow*0.18, 0.0, 1.0);
  vec3 col = palette(t);
  // viñeta
  float vig = smoothstep(1.25, 0.2, length(uv-0.5));
  col *= 0.5 + 0.5*vig;
  gl_FragColor = vec4(col, 1.0);
}
`;

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos,0.0,1.0); }
`;

export default function BackgroundFX() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = 0;
    const start = performance.now();
    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      // ~24fps y pausa si la pestaña no está visible (fondo decorativo).
      if (document.hidden || now - last < 42) return;
      last = now;
      const t = (now - start) / 1000;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas id="bg-canvas" ref={ref} aria-hidden="true" />;
}
