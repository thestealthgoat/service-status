// Package Service Status for Intel and Apple Silicon, signed with Developer ID (hardened runtime).
//   node tools/package_app.mjs <out dir> <Developer ID Application fingerprint or name> <electron version>
// Used by tools/build_installer.sh. Electron is downloaded once into the Electron cache.
import { packager } from '@electron/packager';
import { readFileSync } from 'node:fs';

const [out, identity, electronVersion] = process.argv.slice(2);
if (!out || !identity || !electronVersion) { console.error('usage: node tools/package_app.mjs <out> <identity> <electron version>'); process.exit(2); }
const version = JSON.parse(readFileSync('src/package.json', 'utf8')).version;

const paths = await packager({
  dir: 'src', out, overwrite: true, asar: true, prune: true,
  name: 'Service Status', executableName: 'Service Status',
  platform: 'darwin', arch: ['x64', 'arm64'], electronVersion,
  appBundleId: 'app.servicestatus.mac',                 // same as 2.0, so settings and history carry over
  appVersion: version, buildVersion: version, icon: 'src/icon.icns',
  appCategoryType: 'public.app-category.productivity',
  extendInfo: {
    NSLocalNetworkUsageDescription: 'Service Status shows the service status on phones, iPads and TVs on this network, and talks to ProPresenter when it runs on another computer.',
  },
  osxSign: {
    identity,
    optionsForFile: () => ({ hardenedRuntime: true, entitlements: 'installer/entitlements.plist' }),
  },
});
console.log(paths.join('\n'));
