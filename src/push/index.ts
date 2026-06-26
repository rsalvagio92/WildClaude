/**
 * Push notifications — public surface.
 *
 * Expo push dispatcher + device registry. The HTTP endpoints
 * (POST /api/push/register, /api/push/prefs) live in dashboard.ts and call
 * into the registry here; notifyUser() (see notify.ts seam) calls pushNotify()
 * to dual-deliver alongside Telegram.
 */

export {
  registerDevice,
  setDevicePrefs,
  getDevice,
  getEligibleTokens,
  listDevices,
  removeDevice,
  isValidExpoToken,
} from './devices.js';
export type { PushDevice, DevicePrefs, CategoryPrefs } from './devices.js';

export { pushNotify, sendExpoMessages } from './expo.js';
export type { PushNotification, PushDispatchResult } from './expo.js';
