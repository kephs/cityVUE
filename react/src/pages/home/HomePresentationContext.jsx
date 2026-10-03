import { createContext, useContext } from "react";
import { safeHomePresentation } from "./safeHomePresentation.js";

const HomePresentationContext = createContext(safeHomePresentation);

// One presentation input for the public header, content and footer. The public
// loader supplies a complete validated value without changing rendering components.
// This is not an Organization or permission source; the default has no contacts.
export function HomePresentationProvider({ value = safeHomePresentation, children }) {
  return <HomePresentationContext.Provider value={value}>{children}</HomePresentationContext.Provider>;
}

export function useHomePresentation() {
  return useContext(HomePresentationContext);
}
