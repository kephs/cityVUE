import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

import { useTheme } from "../../theme/useTheme.js";

export default function DashboardChart({ type, labels, values, label, onDataClick, indexAxis = "x" }) {
    const canvasRef = useRef(null);
    const { theme } = useTheme();
    const serializedLabels = JSON.stringify(labels);
    const serializedValues = JSON.stringify(values);

    useEffect(() => {
        if (!canvasRef.current) return undefined;
        const dark = theme === "dark";
        const textColor = dark ? "#c7d5e9" : "#52627a";
        const gridColor = dark ? "rgba(199,213,233,.11)" : "rgba(16,41,87,.08)";
        const colors = type === "bar"
            ? values.map((_, index) => dark ? ["#69a7ff", "#4d91ef", "#82b7ff"][index % 3] : ["#1672eb", "#3c8df3", "#72adf7"][index % 3])
            : type === "doughnut"
                ? [dark ? "#53a7d8" : "#248bbf", dark ? "#efb84f" : "#d99a22", dark ? "#5ebf89" : "#329765"]
                : [dark ? "#ef7f79" : "#d95d57", dark ? "#efb84f" : "#d99a22", dark ? "#5ebf89" : "#329765"];
        const chart = new Chart(canvasRef.current, {
            type,
            data: { labels, datasets: [{ label, data: values, backgroundColor: colors, borderColor: dark ? "#172235" : "#ffffff", borderWidth: type === "bar" ? 0 : 2 }] },
            options: {
                indexAxis,
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 250 },
                layout: { padding: { top: 4, right: 8, bottom: 2, left: 8 } },
                interaction: { mode: "nearest", intersect: true },
                onClick: onDataClick ? (_event, elements) => {
                    const index = elements?.[0]?.index;
                    if (Number.isInteger(index) && values[index] > 0) onDataClick(index);
                } : undefined,
                onHover: onDataClick ? (event, elements) => {
                    const index = elements?.[0]?.index;
                    event.native.target.style.cursor = Number.isInteger(index) && values[index] > 0 ? "pointer" : "default";
                } : undefined,
                plugins: { legend: { display: type !== "bar", position: "bottom", labels: { color: textColor, usePointStyle: true, pointStyle: "circle", padding: 18, font: { family: "Inter, Segoe UI, sans-serif", size: 12, weight: 600 } } }, tooltip: { padding: 10, cornerRadius: 7, callbacks: { afterLabel: onDataClick ? (context) => `View ${context.label} issues` : undefined } } },
                scales: type === "bar" ? {
                    x: indexAxis === "y"
                        ? { beginAtZero: true, ticks: { color: textColor, precision: 0, padding: 8 }, grid: { color: gridColor }, border: { display: false } }
                        : { ticks: { color: textColor, font: { size: 11, weight: 600 }, maxRotation: 35, minRotation: 0 }, grid: { display: false }, border: { display: false } },
                    y: indexAxis === "y"
                        ? { ticks: { color: textColor, autoSkip: false, font: { size: 11, weight: 600 } }, grid: { display: false }, border: { display: false } }
                        : { beginAtZero: true, ticks: { color: textColor, precision: 0, padding: 8 }, grid: { color: gridColor }, border: { display: false } }
                } : undefined
            }
        });
        return () => chart.destroy();
    }, [type, label, theme, serializedLabels, serializedValues, onDataClick, indexAxis]);

    return <canvas ref={canvasRef} aria-hidden="true" />;
}
