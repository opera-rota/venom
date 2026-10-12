import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./theme.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("The VENOM window is missing its root element.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
