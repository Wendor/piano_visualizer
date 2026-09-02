import type { Palette } from "./types";

export const PALETTES: readonly Palette[] = [
    {
        id: "ion",
        title: "Ion",
        hueLow: 262,
        hueHigh: 188,
        saturation: 92,
        background: "#04050a",
        backgroundGlow: "rgba(20, 28, 52, 0.55)"
    },
    {
        id: "ember",
        title: "Ember",
        hueLow: 376,
        hueHigh: 342,
        saturation: 94,
        background: "#080406",
        backgroundGlow: "rgba(58, 16, 30, 0.5)"
    },
    {
        id: "emerald",
        title: "Emerald",
        hueLow: 168,
        hueHigh: 132,
        saturation: 88,
        background: "#030806",
        backgroundGlow: "rgba(14, 44, 34, 0.5)"
    }
];
