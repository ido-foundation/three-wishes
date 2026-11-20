// The iPhone app cannot be compiled on every machine, but the places where its files must agree with
// the web app and the server can be checked anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { NIGHT } from '../../public/lib/lever.js';
import { loadConfig } from '../../server/config.mjs';

const read = (p) => readFileSync(p, 'utf8');
const swift = (f) => read(`ios/III/${f}`);
const web = read('public/native.js');
const app = read('public/app.js');
const view = read('public/lever-view.js');

test('the bundle id is the same in the project, the server and the guide', () => {
  const yml = read('ios/project.yml');
  const id = yml.match(/PRODUCT_BUNDLE_IDENTIFIER:\s*(\S+)/)[1];
  assert.equal(loadConfig({}, {}).apns.bundleId, id, 'APNS_BUNDLE_ID defaults to the app\'s bundle id');
  assert.match(read('ios/README.md'), new RegExp(id.replaceAll('.', '\\.')));
  assert.match(yml, /APP_URL:\s*"https:\/\//, 'the app loads over https');
});

test('the page and the shell recognise each other', () => {
  const ua = swift('Config.swift').match(/userAgentName = "([^"]+)"/)[1];
  assert.match(ua, /^III-iOS\//);
  assert.match(web, /\/III-iOS\/\.test\(navigator\.userAgent\)/);
  assert.match(swift('WebView.swift'), /add\(context\.coordinator, name: "native"\)/);
  assert.match(web, /messageHandlers\?\.native/);
});

test('every message the page sends is one the shell handles, and the reverse', () => {
  const sent = new Set([...web.matchAll(/type: '(\w+)'/g)].map((m) => m[1]));
  const handled = new Set([...swift('WebView.swift').matchAll(/case "(\w+)":/g)].map((m) => m[1]));
  assert.deepEqual([...sent].sort(), ['haptic', 'push', 'ready', 'share']);
  assert.deepEqual([...handled].sort(), [...sent].sort());
});

test('every haptic the page asks for exists in Swift', () => {
  const asked = new Set([...(view + app).matchAll(/native\.haptic\('(\w+)'\)/g)].map((m) => m[1]));
  assert.ok(view.includes("k === 'D' ? 'heavy' : 'rigid'"), 'the ring locks use rigid and heavy');
  const have = new Set([...swift('Haptics.swift').matchAll(/case "(\w+)":/g)].map((m) => m[1]));
  for (const s of [...asked, 'heavy', 'rigid', 'success', 'selection']) assert.ok(have.has(s), `Haptics.swift has "${s}"`);
});

test('the push token goes from Swift to the server by the same names', () => {
  assert.match(swift('Bridge.swift'), /window\.nativePush && window\.nativePush\(/);
  assert.match(app, /window\.nativePush = \(token, env\) => api\.device\(token, env\)/);
  assert.match(read('public/api.js'), /device: \(token, env\) => req\('POST', '\/api\/device'/);
  assert.match(read('ios/project.yml'), /APNS_ENV: sandbox[\s\S]*APNS_ENV: production/, 'Xcode runs use the sandbox, releases production');
  assert.match(read('server/push.mjs'), /\['sandbox', 'production'\]/);
});

test('a tapped notification opens the path the server put in the payload', () => {
  assert.match(swift('AppDelegate.swift'), /userInfo\["url"\] as\? String/);
  assert.match(read('server/push.mjs'), /\burl,\n\s*\}\)/, 'the payload carries url at the top level');
  assert.match(read('server/push.mjs'), /const url = `\/\?w=\$\{wishId\}`/);
});

test('the app opens its own invitation links', () => {
  const plist = swift('Info.plist');
  assert.match(plist, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>iii<\/string>/);
  assert.match(swift('RootView.swift'), /onOpenURL/);
});

test('the plist asks for what the code uses, and nothing alarming', () => {
  const plist = swift('Info.plist');
  assert.match(plist, /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>remote-notification<\/string>/);
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(plist, /<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/);
  assert.doesNotMatch(plist, /NSAllowsArbitraryLoads/, 'no blanket exception to https');
  assert.doesNotMatch(plist, /UsageDescription/, 'it never asks for the camera, location or contacts');
  assert.match(swift('III.entitlements'), /aps-environment/);
  assert.equal(read('ios/project.yml').includes('GENERATE_INFOPLIST_FILE: NO'), true);
});

test("the shell's night is the app's night", () => {
  const c = JSON.parse(read('ios/III/Assets.xcassets/Night.colorset/Contents.json')).colors[0].color.components;
  const hex = (x) => Math.round(parseFloat(x) * 255).toString(16).padStart(2, '0');
  assert.equal(`#${hex(c.red)}${hex(c.green)}${hex(c.blue)}`.toUpperCase(), NIGHT.toUpperCase());
  assert.match(swift('WebView.swift'), /UIColor\(named: "Night"\)/);
});

test('the icon is flat 1024, the launch picture exists, and nothing references a missing asset', async () => {
  const icon = await sharp('ios/III/Assets.xcassets/AppIcon.appiconset/icon-1024.png').metadata();
  assert.deepEqual([icon.width, icon.height, icon.hasAlpha], [1024, 1024, false], 'the App Store refuses an icon with an alpha channel');
  assert.ok(existsSync('ios/III/Assets.xcassets/LaunchSeal.imageset/launch-seal.png'));
  for (const name of ['LaunchSeal', 'Night']) {
    const used = (swift('OfflineView.swift') + swift('RootView.swift') + swift('Info.plist')).includes(name);
    assert.ok(used, `${name} is used`);
    assert.ok(existsSync(`ios/III/Assets.xcassets/${name}.${name === 'Night' ? 'colorset' : 'imageset'}`));
  }
});

test('the shell stays on the app\'s address and fetches pictures only from it', () => {
  assert.match(swift('WebView.swift'), /url\.host == Config\.appURL\.host/);
  assert.match(swift('Sharer.swift'), /url\.host == Config\.appURL\.host/);
  assert.match(swift('Bridge.swift'), /url\.host == Config\.appURL\.host/);
  assert.doesNotMatch(swift('WebView.swift'), /evaluateJavaScript\([^)]*(body|message)/, 'nothing from the page is run as script');
});

test('no secret and no Apple key in the repository', () => {
  const all = ['ios/README.md', 'ios/project.yml', ...['AppDelegate', 'Bridge', 'Config', 'Push', 'RootView', 'Sharer', 'WebView'].map((f) => `ios/III/${f}.swift`)].map(read).join('\n');
  assert.doesNotMatch(all, /BEGIN (EC |PRIVATE )?PRIVATE KEY|AuthKey_[A-Z0-9]{10}\.p8\b(?!\s)/);
  assert.equal(existsSync('ios/AuthKey.p8'), false);
});
