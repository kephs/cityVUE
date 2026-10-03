import { createContext, useContext } from "react";
import { homePresentation } from "./homePresentation.js";

const HomePresentationContext = createContext(homePresentation);

// One presentation input for the public header, content and footer. A future
// approved public configuration source can supply this value without changing
// the rendering components. This is not an Organization or permission source.
export function HomePresentationProvider({ value = homePresentation, children }) {
  return <HomePresentationContext.Provider value={value}>{children}</HomePresentationContext.Provider>;
}

export function useHomePresentation() {
  return useContext(HomePresentationContext);
}
