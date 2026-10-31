/**
 * ULTRON AI — DSH-GOD Third-Party License & Attribution Registry
 *
 * Preserves all copyright notices, license texts, and third-party provenance
 * for components imported and adapted from crackerghost/DSH-GOD.
 */

export const DSH_PROVENANCE = {
  upstreamRepository: "https://github.com/crackerghost/DSH-GOD",
  originalUpstream: "https://github.com/Ebony-Vinyl/dsh-our-free-model",
  pinnedCommit: "c67271f42141dc1afc5d371e313ead7b8e35bfdd",
  version: "2.7.3",
  integrationType: "NATIVE_ULTRON_SUBSYSTEM"
};

export const LICENSE_INVENTORY = [
  {
    component: "DSH-GOD Root Engine & Providers",
    copyright: "Copyright (c) 2026 Ebony-Vinyl, crackerghost",
    license: "MIT",
    terms: "Permits commercial use, modification, distribution, and sublicensing with attribution."
  },
  {
    component: "Channel Pack (Account Adapters)",
    copyright: "Copyright (c) 2026 Jet",
    license: "MIT",
    terms: "Permits reuse with preservation of copyright and permission notices."
  },
  {
    component: "Magpie Local Engine Interface",
    copyright: "Copyright (c) 2026 yetone",
    license: "MIT",
    terms: "Third-party embedded binary excluded from repo per hardware safety review; interface specification preserved under MIT."
  },
  {
    component: "OpenCode Fingerprint Decoy Spec",
    copyright: "Copyright (c) 2026 9router, jasonxu114514",
    license: "MIT",
    terms: "Client fingerprint and session descending timestamp specification."
  }
];

export function getLicenseSummary() {
  return {
    provenance: DSH_PROVENANCE,
    licenses: LICENSE_INVENTORY,
    compliant: true,
    hardwareSafetyExclusions: [
      "vendor/magpie/bin/magpie-win32-x64.exe (68MB binary excluded; AMD Ryzen 5700U pure CPU configuration preserved)"
    ]
  };
}
