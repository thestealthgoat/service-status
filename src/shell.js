// Plain helpers for the app shell (main.js). No Electron here, so they can be unit-tested.
const RAW = 'https://raw.githubusercontent.com/thestealthgoat/service-status/main/update/';

// Update feeds: Stable for everyone, Beta (the booth Mac) gets new versions first. Beta falls back to Stable
// while there's no beta.json yet.
const feedUrl = channel => RAW + (channel === 'beta' ? 'beta.json' : 'latest.json');
const feedFallback = channel => (channel === 'beta' ? feedUrl('stable') : null);

// A downloaded update installs itself only between 3:00 and 5:00 AM local time, and never when a service starts
// within the next 2 hours (Planning Center service times).
function quietToApply(now, serviceStarts) {
  const h = now.getHours();
  if (h < 3 || h >= 5) return false;
  return !(serviceStarts || []).some(s => { const d = s.getTime() - now.getTime(); return d >= 0 && d < 2 * 3600 * 1000; });
}

module.exports = { feedUrl, feedFallback, quietToApply };
