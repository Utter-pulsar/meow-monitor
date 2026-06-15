// DES-CBC (single DES, PKCS7 padding) via node-forge.
// We can't use Node's built-in crypto: OpenSSL 3 moved single-DES into the
// legacy provider, which is disabled by default on this machine
// (createCipheriv('des-cbc', ...) throws "digital envelope routines::unsupported").
// node-forge is a pure-JS implementation, so it works everywhere and bundles cleanly.
const forge = require('node-forge');

/**
 * DES-CBC encrypt with PKCS7 padding.
 * @param {Buffer} key 8-byte key
 * @param {Buffer} iv  8-byte IV
 * @param {Buffer} plaintext
 * @returns {Buffer} ciphertext (PKCS7-padded, so length is rounded up to the next 8)
 */
function desCbcEncrypt(key, iv, plaintext) {
  const cipher = forge.cipher.createCipher('DES-CBC', forge.util.createBuffer(key.toString('latin1')));
  cipher.start({ iv: forge.util.createBuffer(iv.toString('latin1')) });
  cipher.update(forge.util.createBuffer(plaintext.toString('latin1')));
  cipher.finish(); // applies PKCS7 padding
  return Buffer.from(cipher.output.getBytes(), 'latin1');
}

/**
 * Self-check against the classic FIPS DES test vector so we know forge's DES
 * matches a real implementation before we ever talk to the device.
 * key=133457799BBCDFF1, pt=0123456789ABCDEF, IV=0 -> first block 85E813540F0AB405.
 */
function selfTest() {
  const key = Buffer.from('133457799BBCDFF1', 'hex');
  const iv = Buffer.alloc(8, 0);
  const pt = Buffer.from('0123456789ABCDEF', 'hex');
  const ct = desCbcEncrypt(key, iv, pt);
  const firstBlock = ct.slice(0, 8).toString('hex').toUpperCase();
  const ok = firstBlock === '85E813540F0AB405';
  return { ok, got: firstBlock, expected: '85E813540F0AB405' };
}

module.exports = { desCbcEncrypt, selfTest };
