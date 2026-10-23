/** System notifications for live-mode risk alerts (no push server needed). */

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsGranted(): boolean {
  return notificationsSupported() && Notification.permission === "granted";
}

/** Must be called from a user gesture (e.g. flipping the alerts switch). */
export async function requestNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export async function notify(title: string, body: string): Promise<void> {
  if (!notificationsGranted()) return;
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-32.png",
    tag: "route-risk", // replace the previous alert instead of stacking them
    renotify: true,
    vibrate: [200, 100, 200],
  };
  try {
    // Mobile browsers only allow notifications through the service worker.
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    // Notification blocked by the platform; the in-app banner still shows the change.
  }
}
