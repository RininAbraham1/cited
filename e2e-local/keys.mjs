// Throwaway ES256 keypair standing in for the DeepSpace auth worker's signing key.
import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
const dir = process.argv[2]
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
fs.writeFileSync(`${dir}/priv.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }))
fs.writeFileSync(`${dir}/pub.pem`, publicKey.export({ type: 'spki', format: 'pem' }))
