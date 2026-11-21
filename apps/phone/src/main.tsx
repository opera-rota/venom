import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@desktop/renderer/src/App.tsx";
import { createPhoneBridge } from "./phone-bridge.ts";
import { describeThisPhone, phoneModel } from "./phone-device.ts";
import "./phone.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("The VENOM phone page is missing its root element.");
}

const device = describeThisPhone(navigator.userAgent, await phoneModel());

Object.defineProperty(window, "venom", { value: createPhoneBridge({ origin: window.location.origin, storage: window.localStorage, device }) });

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
