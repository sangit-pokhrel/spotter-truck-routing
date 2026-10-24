import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StyledEngineProvider, ThemeProvider } from "@mui/material/styles";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";
import { theme } from "./theme";

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* injectFirst: MUI styles go in before styles.css, so layout CSS can still adjust them */}
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <App />
      </ThemeProvider>
    </StyledEngineProvider>
  </StrictMode>,
);
