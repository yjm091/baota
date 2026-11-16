// CloudBase's default handler is index.main. Keep the TypeScript implementation
// in dist/ and expose it through the conventional Node.js cloud-function entry.
exports.main = require('./dist/index.js').main
