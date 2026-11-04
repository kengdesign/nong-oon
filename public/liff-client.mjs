export const DEFAULT_LIFF_ID = '2012203704-cpEHg12o';
// No identity is trusted here: session creation must verify the ID token server-side.
export function liffUrl(id, tab = 'today') {
  if (!/^\d+-[A-Za-z0-9]+$/.test(id)) throw new Error('INVALID_LIFF_ID');
  if (!['today', 'schedules', 'settings', 'help', 'history'].includes(tab)) throw new Error('INVALID_TAB');
  return `https://liff.line.me/${id}/?tab=${tab}`;
}
export async function initializeLiff(id, sdk = globalThis.liff) {
  liffUrl(id);
  if (!sdk) throw new Error('LIFF_SDK_UNAVAILABLE');
  await sdk.init({ liffId: id });
  return { inClient: sdk.isInClient(), loggedIn: sdk.isLoggedIn() };
}

export function navigationFromUrl(url) {
  const requested = new URL(url).searchParams.get('tab');
  const tabs = {schedules: 'meds', settings: 'settings', help: 'help', today: 'today'};
  return requested === 'history' ? {tab: 'today', showHistory: true}
    : {tab: (Object.hasOwn(tabs, requested) ? tabs[requested] : 'today'), showHistory: false};
}
