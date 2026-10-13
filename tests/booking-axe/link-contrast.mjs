import assert from "node:assert/strict";
export async function linkContrast(locator) {
  const ratio = await locator.evaluate(element => {
    const rgba = value => { const parts = value.match(/[\d.]+/g)?.map(Number); return parts?.length >= 3 ? [...parts.slice(0, 3), parts[3] ?? 1] : [0, 0, 0, 0]; };
    const blend = (foreground, background, alpha = foreground[3]) => foreground.slice(0, 3).map((v, index) => v * alpha + background[index] * (1 - alpha));
    const nodes = []; for (let node = element; node; node = node.parentElement) nodes.unshift(node);
    let background = [255, 255, 255], opacity = 1;
    for (const node of nodes) { const style = globalThis.getComputedStyle(node); background = blend(rgba(style.backgroundColor), background); opacity *= Number(style.opacity); }
    const color = rgba(globalThis.getComputedStyle(element).color); const foreground = blend(color, background, color[3] * opacity);
    const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  assert.ok(ratio >= 4.5, `action link text contrast ${ratio}`);
  assert.ok(await locator.evaluate(element => { const style = globalThis.getComputedStyle(element); return style.textDecorationLine.includes("underline") || (style.display.includes("flex") && parseFloat(style.minHeight) >= 44); }), "action is visibly styled as a link or button");
}
