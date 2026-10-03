import { useEffect } from "react";
import { localAsset } from "./presentationPolicy.js";

export function useHomeMetadata(presentation) {
  useEffect(() => {
    const previousTitle = document.title;
    const existingDescription = document.querySelector('meta[name="description"]');
    const previousDescription = existingDescription?.getAttribute("content");
    const description = existingDescription || document.createElement("meta");
    description.name = "description";
    description.content = presentation.description;
    if (!existingDescription) document.head.append(description);
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/png";
    const favicon = localAsset(presentation.favicon);
    if (favicon) { icon.href = favicon; document.head.append(icon); }
    document.title = presentation.title;
    return () => {
      document.title = previousTitle;
      if (!existingDescription) description.remove();
      else if (previousDescription === null) description.removeAttribute("content");
      else description.content = previousDescription;
      icon.remove();
    };
  }, [presentation]);
}
