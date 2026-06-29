/**
 * Expo config plugin: trust self-signed TLS certs for the WildClaude fleet.
 * Adds network_security_config.xml that allows self-signed certs on the
 * primary's Tailscale IP and local LAN, without disabling cert checks globally.
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <!-- Trust self-signed certs from the WildClaude primary fleet (Tailscale + LAN) -->
  <domain-config cleartextTrafficPermitted="false">
    <!-- Tailscale IP of primary -->
    <domain includeSubdomains="false">100.68.24.30</domain>
    <!-- LAN range — covers 192.168.x.x primaries -->
    <domain includeSubdomains="false">192.168.1.1</domain>
    <domain includeSubdomains="false">192.168.1.100</domain>
    <domain includeSubdomains="false">192.168.1.112</domain>
    <trust-anchors>
      <!-- System CAs -->
      <certificates src="system"/>
      <!-- User-installed CAs (for dev: manually installed primary cert) -->
      <certificates src="user"/>
    </trust-anchors>
  </domain-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`;

function withNetworkSecurityConfig(config) {
  // Step 1: inject the XML file into the Android res/xml directory
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const xmlDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NETWORK_SECURITY_CONFIG);
      return cfg;
    },
  ]);

  // Step 2: add android:networkSecurityConfig to <application> in AndroidManifest
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }
    return cfg;
  });

  return config;
}

module.exports = withNetworkSecurityConfig;
