import crypto from "crypto";

const password = process.argv.slice(2).join(" ");

if (!password) {
  console.error("Uso: node scripts/hash-admin-password.js \"SenhaForteAqui123!\"");
  process.exit(1);
}

const n = Math.max(16_384, Number(process.env.ADMIN_PASSWORD_SCRYPT_N || 16_384));
const r = Math.max(8, Number(process.env.ADMIN_PASSWORD_SCRYPT_R || 8));
const p = Math.max(1, Number(process.env.ADMIN_PASSWORD_SCRYPT_P || 1));
const keylen = 64;
const maxmem = Math.max(64 * 1024 * 1024, Number(process.env.ADMIN_PASSWORD_SCRYPT_MAXMEM || 64 * 1024 * 1024));

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, keylen, { N: n, r, p, maxmem });

console.log(["scrypt", n, r, p, salt.toString("base64url"), hash.toString("base64url")].join("$"));
