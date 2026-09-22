import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom lacks native dialog operations. Browser UAT verifies modality/focus trapping.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
  this.querySelector("button")?.focus();
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
