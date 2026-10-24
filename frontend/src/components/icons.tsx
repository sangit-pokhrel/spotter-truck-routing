import { createSvgIcon } from "@mui/material/utils";

// Material icon paths for the few icons used, instead of pulling in all of @mui/icons-material.
export const MyLocationIcon = createSvgIcon(
  <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />,
  "MyLocation",
);

export const SwapVertIcon = createSvgIcon(
  <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3 5 6.99h3V14h2V6.99h3L9 3z" />,
  "SwapVert",
);

export const PlayIcon = createSvgIcon(<path d="M8 5v14l11-7z" />, "PlayArrow");

export const PauseIcon = createSvgIcon(<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />, "Pause");

export const CheckIcon = createSvgIcon(
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />,
  "CheckCircle",
);

export const RefreshIcon = createSvgIcon(
  <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />,
  "Refresh",
);

export const FitIcon = createSvgIcon(
  <path d="m15 3 2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3zm6 12-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6zm12-6-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6z" />,
  "ZoomOutMap",
);

export const PipIcon = createSvgIcon(
  <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z" />,
  "PictureInPicture",
);
