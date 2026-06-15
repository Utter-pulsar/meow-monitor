// Map a path that resolved inside app.asar to its on-disk app.asar.unpacked copy.
// External processes (ffmpeg) and native addons (@napi-rs/canvas font loading) can't read
// from inside the asar archive, so anything they open must be asarUnpack'd and read via this.
// In dev (no asar) the path has no "app.asar" segment, so this is a no-op.
module.exports = function unpacked(p) {
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
};
