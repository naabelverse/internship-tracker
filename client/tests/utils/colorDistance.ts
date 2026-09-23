import { linearChannel, type Rgb } from './contrast';

/** Who is looking: typical vision, or one of the two common red-green deficiencies. */
export type Vision = 'normal' | 'protan' | 'deutan';

type Matrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/**
 * Machado, Oliveira and Fernandes (2009) at severity 1.0, applied to linear
 * RGB. These are the matrices the status-palette audit in DECISIONS.md used,
 * so a figure quoted there is a figure this reproduces.
 */
const DEFICIENCY: Record<Exclude<Vision, 'normal'>, Matrix> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

type Linear = readonly [number, number, number];

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

function simulate([r, g, b]: Linear, [x, y, z]: Matrix): Linear {
  return [
    clamp(x[0] * r + x[1] * g + x[2] * b),
    clamp(y[0] * r + y[1] * g + y[2] * b),
    clamp(z[0] * r + z[1] * g + z[2] * b),
  ];
}

/** Björn Ottosson's OKLab, from linear sRGB. */
function oklab([r, g, b]: Linear): Linear {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * How far apart two colours look, as OKLab distance x100 — the scale the
 * status-palette entries in DECISIONS.md quote, where 15 is a comfortable
 * categorical gap and 6 the floor under colour-vision deficiency. For `protan`
 * and `deutan` both colours are first passed through the simulation, so the
 * number is the gap that reader actually sees.
 */
export function colorDistance(a: Rgb, b: Rgb, vision: Vision): number {
  const toLab = (rgb: Rgb): Linear => {
    const linear: Linear = [linearChannel(rgb[0]), linearChannel(rgb[1]), linearChannel(rgb[2])];
    return oklab(vision === 'normal' ? linear : simulate(linear, DEFICIENCY[vision]));
  };
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);

  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
