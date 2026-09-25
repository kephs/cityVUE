// Fixed presentation palette and deterministic identity mapping. Never status or access.
const accents = ["blue", "amber", "cyan", "green", "emerald"];
const legacy = {
  roads: "blue",
  lighting: "amber",
  water: "cyan",
  waste: "green",
  nature: "emerald",
};
export function categoryAccent(id) {
  if (legacy[id]) return legacy[id];
  let hash = 0;
  for (const character of String(id || ""))
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return accents[hash % accents.length];
}
