"use client";

import { useEffect, useRef, useCallback } from "react";

/* ── Simplex noise implementation ─────────────────────────────────────────── */
class SimplexNoise {
  private perm: number[];
  private grad3: number[][];

  constructor(seed = Math.random()) {
    this.grad3 = [
      [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
      [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
      [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
    ];
    this.perm = this.buildPermutationTable(seed);
  }

  private buildPermutationTable(seed: number): number[] {
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle with seed
    let n = 256;
    while (n > 1) {
      seed = (seed * 16807) % 2147483647;
      const k = (seed % n);
      n--;
      [p[n], p[k]] = [p[k], p[n]];
    }
    return [...p, ...p];
  }

  noise2D(x: number, y: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;

    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;

    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    const dot = (g: number[], x: number, y: number) => g[0] * x + g[1] * y;
    const gi0 = this.perm[ii + this.perm[jj]] % 12;
    const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
    const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;

    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * dot(this.grad3[gi0], x0, y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * dot(this.grad3[gi1], x1, y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * dot(this.grad3[gi2], x2, y2);
    }

    return 70 * (n0 + n1 + n2);
  }

  // Fractal Brownian Motion for more organic shapes
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }
}

/* ── Ink particle ─────────────────────────────────────────────────────────── */
interface InkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  hue: number;
}

/* ── Ink blob ─────────────────────────────────────────────────────────────── */
interface InkBlob {
  x: number;
  y: number;
  baseRadius: number;
  targetRadius: number;
  currentRadius: number;
  noiseOffset: number;
  hue: number;
  saturation: number;
  // Lifecycle: pop in → expand → fade out
  phase: 'emerging' | 'expanding' | 'fading';
  emergeProgress: number; // 0-1 quick pop-in
  expandProgress: number; // 0-1 slow growth to max
  fadeProgress: number; // 0-1 fade out
  expandDuration: number; // How long to expand (ms)
  fadeDuration: number; // How long to fade (ms)
  startDelay: number; // Initial delay before emerging (ms)
}

export function InkBlot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const noiseRef = useRef<SimplexNoise | null>(null);
  const noiseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const blobsRef = useRef<InkBlob[]>([]);
  const particlesRef = useRef<InkParticle[]>([]);
  const timeRef = useRef(0);
  const lastTimeRef = useRef(0);
  const spawnTimerRef = useRef(0);

  const createBlob = useCallback((canvas: HTMLCanvasElement, startDelay = 0): InkBlob => {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    // Organic positioning: polar coordinates with noise offset to avoid grid patterns
    const angle = Math.random() * Math.PI * 2;
    const distFromCenter = Math.sqrt(Math.random()) * Math.max(width, height) * 0.6;
    const centerX = width * (0.3 + Math.random() * 0.4);
    const centerY = height * (0.3 + Math.random() * 0.4);
    const x = centerX + Math.cos(angle) * distFromCenter + (Math.random() - 0.5) * width * 0.3;
    const y = centerY + Math.sin(angle) * distFromCenter + (Math.random() - 0.5) * height * 0.3;

    // Power law sizing (Gutenberg-Richter): many small, few large
    // P(size > s) ~ s^(-alpha), sampled via inverse CDF
    const alpha = 1.4; // Lower = flatter distribution (more large blobs)
    const minSize = 30;
    const maxSize = 250;
    const u = Math.random();
    const powerLawSize = minSize * Math.pow(1 - u * (1 - Math.pow(minSize / maxSize, alpha)), -1 / alpha);
    const baseRadius = Math.min(powerLawSize, maxSize);
    // Expansion multiplier with slight variation
    const targetRadius = baseRadius * (2.2 + Math.random() * 1.5);

    return {
      x,
      y,
      baseRadius,
      targetRadius,
      currentRadius: 0,
      noiseOffset: Math.random() * 1000,
      hue: 170 + Math.random() * 50, // Cyan-teal range
      saturation: 15 + Math.random() * 35,
      phase: 'emerging',
      emergeProgress: 0,
      expandProgress: 0,
      fadeProgress: 0,
      expandDuration: 6000 + Math.random() * 10000, // 6-16 seconds to fully expand
      fadeDuration: 3000 + Math.random() * 4000, // 3-7 seconds to fade
      startDelay,
    };
  }, []);

  const createParticle = useCallback((blob: InkBlob): InkParticle => {
    const angle = Math.random() * Math.PI * 2;
    const dist = blob.currentRadius * (0.5 + Math.random() * 0.5);
    return {
      x: blob.x + Math.cos(angle) * dist,
      y: blob.y + Math.sin(angle) * dist,
      vx: (Math.random() - 0.5) * 0.3,
      vy: Math.random() * 0.5 + 0.1,
      size: 1 + Math.random() * 3,
      alpha: 0.3 + Math.random() * 0.4,
      life: 0,
      maxLife: 3000 + Math.random() * 4000,
      hue: blob.hue + (Math.random() - 0.5) * 20,
    };
  }, []);

  const drawBlob = useCallback((
    ctx: CanvasRenderingContext2D,
    blob: InkBlob,
    noise: SimplexNoise,
    time: number
  ) => {
    if (blob.currentRadius < 2) return;

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.translate(blob.x, blob.y);

    // Create organic blob shape using noise
    const points: [number, number][] = [];
    const segments = 64;

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const noiseVal = noise.fbm(
        Math.cos(angle) * 2 + blob.noiseOffset,
        Math.sin(angle) * 2 + blob.noiseOffset + time * 0.0001,
        4,
        2,
        0.5
      );
      // Smoother variation for softer organic look
      const radius = blob.currentRadius * (0.7 + noiseVal * 0.35);
      points.push([
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ]);
    }

    // Draw the blob with gradient
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);

    for (let i = 1; i <= points.length; i++) {
      const p1 = points[i % points.length];
      const p2 = points[(i + 1) % points.length];

      const cx2 = (p1[0] + p2[0]) / 2;
      const cy2 = (p1[1] + p2[1]) / 2;

      ctx.quadraticCurveTo(p1[0], p1[1], cx2, cy2);
    }
    ctx.closePath();

    // Calculate alpha based on lifecycle
    // Quick pop-in, full visibility during expand, gradual fade
    const maxAlpha = 0.6;
    let alpha: number;
    if (blob.phase === 'emerging') {
      // Quick elastic pop-in
      const t = blob.emergeProgress;
      alpha = Math.min(maxAlpha, t * 1.2);
    } else if (blob.phase === 'expanding') {
      alpha = maxAlpha;
    } else {
      // Smooth fade out
      alpha = maxAlpha * (1 - blob.fadeProgress);
    }

    // Radial gradient with extended soft falloff for dreamy edges
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, blob.currentRadius * 1.3);
    gradient.addColorStop(0, `hsla(${blob.hue}, ${blob.saturation}%, 4%, ${alpha * 0.8})`);
    gradient.addColorStop(0.15, `hsla(${blob.hue}, ${blob.saturation}%, 3.5%, ${alpha * 0.7})`);
    gradient.addColorStop(0.3, `hsla(${blob.hue}, ${blob.saturation}%, 3%, ${alpha * 0.55})`);
    gradient.addColorStop(0.5, `hsla(${blob.hue}, ${blob.saturation - 3}%, 2.5%, ${alpha * 0.35})`);
    gradient.addColorStop(0.7, `hsla(${blob.hue}, ${blob.saturation - 6}%, 2%, ${alpha * 0.15})`);
    gradient.addColorStop(0.85, `hsla(${blob.hue}, ${blob.saturation - 8}%, 1.5%, ${alpha * 0.05})`);
    gradient.addColorStop(1, `hsla(${blob.hue}, ${blob.saturation - 10}%, 1%, 0)`);

    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw mirrored version for Rorschach effect
    ctx.scale(-1, 1);
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);

    for (let i = 1; i <= points.length; i++) {
      const p1 = points[i % points.length];
      const p2 = points[(i + 1) % points.length];

      const cx2 = (p1[0] + p2[0]) / 2;
      const cy2 = (p1[1] + p2[1]) / 2;

      ctx.quadraticCurveTo(p1[0], p1[1], cx2, cy2);
    }
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Add inner detail blobs during expansion
    if (blob.phase !== 'emerging' && blob.expandProgress > 0.2) {
      const detailCount = 2 + Math.floor(blob.expandProgress * 3);
      for (let d = 0; d < detailCount; d++) {
        const detailNoise = noise.fbm(d * 100 + blob.noiseOffset, time * 0.00005, 2);
        const detailAngle = (d / detailCount) * Math.PI + detailNoise;
        const detailDist = blob.currentRadius * (0.2 + detailNoise * 0.4);
        const detailRadius = blob.currentRadius * (0.1 + Math.abs(detailNoise) * 0.15);

        ctx.save();
        ctx.translate(
          blob.x + Math.cos(detailAngle) * detailDist,
          blob.y + Math.sin(detailAngle) * detailDist
        );

        ctx.beginPath();
        const detailSegments = 24;
        for (let i = 0; i < detailSegments; i++) {
          const angle = (i / detailSegments) * Math.PI * 2;
          const r = detailRadius * (0.7 + noise.noise2D(
            Math.cos(angle) + d + time * 0.0001,
            Math.sin(angle) + d
          ) * 0.4);
          const px = Math.cos(angle) * r;
          const py = Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();

        const detailGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, detailRadius);
        const detailAlpha = alpha * 0.5;
        detailGrad.addColorStop(0, `hsla(${blob.hue + 10}, ${blob.saturation + 5}%, 6%, ${detailAlpha})`);
        detailGrad.addColorStop(1, `hsla(${blob.hue}, ${blob.saturation}%, 3%, 0)`);
        ctx.fillStyle = detailGrad;
        ctx.fill();

        ctx.restore();
      }
    }
  }, []);

  const drawParticle = useCallback((
    ctx: CanvasRenderingContext2D,
    particle: InkParticle
  ) => {
    const lifeRatio = particle.life / particle.maxLife;
    const fadeIn = Math.min(1, lifeRatio * 5);
    const fadeOut = Math.max(0, 1 - (lifeRatio - 0.7) / 0.3);
    const alpha = particle.alpha * fadeIn * (lifeRatio > 0.7 ? fadeOut : 1);

    if (alpha < 0.01) return;

    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${particle.hue}, 20%, 5%, ${alpha})`;
    ctx.fill();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    noiseRef.current = new SimplexNoise(42);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resize();
    window.addEventListener("resize", resize);

    // Generate cached noise texture for base layer
    const generateNoiseTexture = () => {
      const noiseCanvas = document.createElement('canvas');
      const noiseCtx = noiseCanvas.getContext('2d');
      if (!noiseCtx || !noiseRef.current) return;

      const rect = canvas.getBoundingClientRect();
      noiseCanvas.width = Math.ceil(rect.width / 8);
      noiseCanvas.height = Math.ceil(rect.height / 8);

      const noise = noiseRef.current;
      const noiseScale = 0.015;

      for (let x = 0; x < noiseCanvas.width; x++) {
        for (let y = 0; y < noiseCanvas.height; y++) {
          const n = noise.fbm(x * noiseScale, y * noiseScale, 3, 2, 0.5);
          const alpha = Math.max(0, (n + 0.4) * 0.15);
          if (alpha > 0.01) {
            noiseCtx.fillStyle = `hsla(190, 25%, 4%, ${alpha})`;
            noiseCtx.fillRect(x, y, 1, 1);
          }
        }
      }

      noiseCanvasRef.current = noiseCanvas;
    };

    generateNoiseTexture();

    // Initialize with staggered blobs
    blobsRef.current = [];
    const initialCount = 45;
    for (let i = 0; i < initialCount; i++) {
      // Stagger start times so blobs emerge sequentially
      const delay = i * 400 + Math.random() * 200;
      blobsRef.current.push(createBlob(canvas, delay));
    }

    const animate = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const delta = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;
      timeRef.current += delta;

      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      const noise = noiseRef.current!;

      // Draw cached noise texture base layer
      if (noiseCanvasRef.current) {
        ctx.drawImage(noiseCanvasRef.current, 0, 0, rect.width, rect.height);
      }

      // Spawn new blobs periodically
      spawnTimerRef.current += delta;
      if (spawnTimerRef.current > 1000 + Math.random() * 2000) {
        spawnTimerRef.current = 0;
        if (blobsRef.current.length < 70) {
          blobsRef.current.push(createBlob(canvas, 0));
        }
      }

      // Update and draw blobs with lifecycle
      blobsRef.current = blobsRef.current.filter((blob) => {
        // Handle start delay
        if (blob.startDelay > 0) {
          blob.startDelay -= delta;
          return true;
        }

        // Handle lifecycle phases
        if (blob.phase === 'emerging') {
          // Quick pop-in (~500ms)
          blob.emergeProgress += delta * 0.002;
          if (blob.emergeProgress >= 1) {
            blob.emergeProgress = 1;
            blob.phase = 'expanding';
          }
          // During emergence, grow from 0 to base radius
          const easeOut = 1 - Math.pow(1 - blob.emergeProgress, 3);
          blob.currentRadius = blob.baseRadius * easeOut;
        } else if (blob.phase === 'expanding') {
          // Slow expansion to target radius
          blob.expandProgress += delta / blob.expandDuration;
          if (blob.expandProgress >= 1) {
            blob.expandProgress = 1;
            blob.phase = 'fading';
          }
          // Ease-out expansion from base to target
          const easeOut = 1 - Math.pow(1 - blob.expandProgress, 2);
          blob.currentRadius = blob.baseRadius + (blob.targetRadius - blob.baseRadius) * easeOut;
        } else if (blob.phase === 'fading') {
          // Fade out while maintaining size
          blob.fadeProgress += delta / blob.fadeDuration;
          if (blob.fadeProgress >= 1) {
            // Remove this blob, it has completed its lifecycle
            return false;
          }
        }

        // Draw the blob
        drawBlob(ctx, blob, noise, timeRef.current);

        // Spawn particles during expansion
        if (blob.phase === 'expanding' && Math.random() < 0.01) {
          particlesRef.current.push(createParticle(blob));
        }

        return true;
      });

      // Ensure we always have some blobs
      while (blobsRef.current.length < 30) {
        blobsRef.current.push(createBlob(canvas, Math.random() * 1000));
      }

      // Update and draw particles
      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.life += delta;
        if (particle.life > particle.maxLife) return false;

        // Add some noise to movement
        const noiseX = noise.noise2D(particle.x * 0.01, timeRef.current * 0.0001);
        const noiseY = noise.noise2D(particle.y * 0.01, timeRef.current * 0.0001 + 100);

        particle.vx += noiseX * 0.01;
        particle.vy += noiseY * 0.01 + 0.002;
        particle.x += particle.vx * delta * 0.05;
        particle.y += particle.vy * delta * 0.05;

        drawParticle(ctx, particle);
        return true;
      });

      // Limit particles
      if (particlesRef.current.length > 100) {
        particlesRef.current = particlesRef.current.slice(-100);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [createBlob, createParticle, drawBlob, drawParticle]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 1 }}
    />
  );
}
