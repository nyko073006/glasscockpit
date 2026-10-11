// ERZEUGT mit npm run native-checksums aus node_modules/node-pty (1.1.0), nicht von Hand ändern.
// Pfad relativ zu native/<ziel>/ -> SHA256 jeder Datei, exakt so, wie copyNodePty sie anlegt (scripts/lib/native-copy.ts).
// Fest im Plugin und keine Einstellung: Diese Summen entscheiden, ob ein Download als node-pty gilt (src/core/native-verify.ts).
// Der Wächter-Test test/native-checksums.test.ts wird rot, wenn node-pty oder copyNodePty sich ändern.
export const NATIVE_CHECKSUMS: Readonly<Record<"darwin-arm64" | "darwin-x64", Readonly<Record<string, string>>>> = {
  "darwin-arm64": {
    "lib/conpty_console_list_agent.js": "0d010879bb6680a0253d44363183d53e631f42972594eb6dcb1fb842c8c85e52",
    "lib/eventEmitter2.js": "f1c14613aa90c10def4ca7238329270871997eb26f919f7074dc25533e3e75dd",
    "lib/index.js": "c1b82c92c4c63aaa8e8441fc5a291c4727cd3f3550666d2fec7250e0f6d4b173",
    "lib/interfaces.js": "56e4173f09aad26173f9d4c79800fda0b808c34424f987ef8d671cc931119a0a",
    "lib/shared/conout.js": "6ae3b0532616da11aa2a11b4506bb89b0d40be005a9ea9fb369fb59eefdbda47",
    "lib/terminal.js": "5ed5cd66a766afba4a04093284e999f8516d41936501839055800b10eca5d304",
    "lib/types.js": "408bf8287717b6322cc380ea66caf1b5e366dcf697707ae2f3cc454e08f3b151",
    "lib/unixTerminal.js": "a62e3a60c3bc1b0e7261f58284856df748dcee6761a2bc7a5a5ba98b22660473",
    "lib/utils.js": "f75ad341c13fbf1a9a6605d7ee42dff5bbc5d43b7b381e413fb97eb1b8300beb",
    "lib/windowsConoutConnection.js": "1440f70908fb1f55911ac8e936a1230f68a9c00c03096fcef6788eac6aad9d62",
    "lib/windowsPtyAgent.js": "8636d16b38266112204061a22b135734177c242837982fd3a4055be726efa64a",
    "lib/windowsTerminal.js": "c3a65716f53fed0135a8a633373d5f9c2ab092544d651f27ef0a67096dd3bcd9",
    "lib/worker/conoutSocketWorker.js": "3e4bac095ac3870c3248a7302f5d10217de625f30c32b7000fe48a34788e47ac",
    "package.json": "f8b6a14f7022c14f1cd5d109486f5dacd32bffb63a9a63e38eced37dacb47439",
    "prebuilds/darwin-arm64/pty.node": "e6457d66f45af3facd02920a5b212164e80fe0bb758afe6e6eab1eceeba3fc9a",
    "prebuilds/darwin-arm64/spawn-helper": "21c589109bca43e287df884f3c34ab888033a83927ea7d273949ac5030583f26",
  },
  "darwin-x64": {
    "lib/conpty_console_list_agent.js": "0d010879bb6680a0253d44363183d53e631f42972594eb6dcb1fb842c8c85e52",
    "lib/eventEmitter2.js": "f1c14613aa90c10def4ca7238329270871997eb26f919f7074dc25533e3e75dd",
    "lib/index.js": "c1b82c92c4c63aaa8e8441fc5a291c4727cd3f3550666d2fec7250e0f6d4b173",
    "lib/interfaces.js": "56e4173f09aad26173f9d4c79800fda0b808c34424f987ef8d671cc931119a0a",
    "lib/shared/conout.js": "6ae3b0532616da11aa2a11b4506bb89b0d40be005a9ea9fb369fb59eefdbda47",
    "lib/terminal.js": "5ed5cd66a766afba4a04093284e999f8516d41936501839055800b10eca5d304",
    "lib/types.js": "408bf8287717b6322cc380ea66caf1b5e366dcf697707ae2f3cc454e08f3b151",
    "lib/unixTerminal.js": "a62e3a60c3bc1b0e7261f58284856df748dcee6761a2bc7a5a5ba98b22660473",
    "lib/utils.js": "f75ad341c13fbf1a9a6605d7ee42dff5bbc5d43b7b381e413fb97eb1b8300beb",
    "lib/windowsConoutConnection.js": "1440f70908fb1f55911ac8e936a1230f68a9c00c03096fcef6788eac6aad9d62",
    "lib/windowsPtyAgent.js": "8636d16b38266112204061a22b135734177c242837982fd3a4055be726efa64a",
    "lib/windowsTerminal.js": "c3a65716f53fed0135a8a633373d5f9c2ab092544d651f27ef0a67096dd3bcd9",
    "lib/worker/conoutSocketWorker.js": "3e4bac095ac3870c3248a7302f5d10217de625f30c32b7000fe48a34788e47ac",
    "package.json": "f8b6a14f7022c14f1cd5d109486f5dacd32bffb63a9a63e38eced37dacb47439",
    "prebuilds/darwin-x64/pty.node": "edab585d5c5c7bf35143a7a53b7d72652e90723b5f9635dfd55b2333f7069198",
    "prebuilds/darwin-x64/spawn-helper": "46a4455777c6122d7e71cd706ea4b37b19bedd297684be8b6dabb833ff2a3965",
  },
};
