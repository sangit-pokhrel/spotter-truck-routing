import { createTheme } from "@mui/material/styles";

// Same tokens as the top of styles.css, so MUI controls and the custom map UI read as one app.
const BRAND = "#0a4a5c";
const INK_2 = "#4b5462";
const LINE = "#e2e5e9";
// phones and tablets: finger-sized targets, and 16px inputs so iOS doesn't zoom on focus
const COARSE = "@media (pointer: coarse)";

export const theme = createTheme({
  palette: {
    primary: { main: BRAND, dark: "#083b49", light: "#e7f0f2", contrastText: "#ffffff" },
    success: { main: "#2e8a50" },
    error: { main: "#b4231b" },
    text: { primary: "#15191f", secondary: INK_2, disabled: "#808998" },
    divider: LINE,
    background: { default: "#f4f5f7", paper: "#ffffff" },
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { [COARSE]: { minHeight: 44 } } },
    },
    MuiIconButton: {
      styleOverrides: { root: { [COARSE]: { padding: 10 } } },
    },
    MuiTextField: {
      defaultProps: { size: "small", fullWidth: true },
    },
    MuiInputBase: {
      styleOverrides: { input: { [COARSE]: { fontSize: 16, paddingTop: 12, paddingBottom: 12 } } },
    },
    MuiOutlinedInput: {
      styleOverrides: { notchedOutline: { borderColor: LINE } },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          padding: "5px 10px",
          fontWeight: 500,
          lineHeight: 1.4,
          color: INK_2,
          borderColor: LINE,
          "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: BRAND, color: "#ffffff" },
          [COARSE]: { padding: "10px 12px" },
        },
        sizeSmall: { padding: "3px 9px", fontSize: 12, [COARSE]: { padding: "8px 12px", fontSize: 13 } },
      },
    },
    MuiChip: {
      styleOverrides: { root: { [COARSE]: { height: 36, fontSize: 14, borderRadius: 18 } } },
    },
    MuiSlider: {
      styleOverrides: { markLabel: { fontSize: 11, color: "#808998" } },
    },
    MuiAlert: {
      styleOverrides: { root: { fontSize: 13, alignItems: "center" }, message: { padding: "6px 0" } },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
    },
  },
});
