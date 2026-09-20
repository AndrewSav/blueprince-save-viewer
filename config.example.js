// The viewer's optional runtime config. Copy this to config.js beside index.html, or let
// `node make-config.mjs <the Blue Prince install folder>` write config.js for you. config.js is
// git-ignored; a deployment can supply its own.
//
// With no config.js, or this one as it is, the page asks for the game's resources.assets to
// read the save key from, and keeps the key in the browser.
globalThis.BLUEPRINCE_CONFIG = {
  // The password the game encrypts saves with (Easy Save 3). When set, encrypted saves open
  // straight away and the page does not ask for resources.assets.
  es3Password: "",
};
