import crypto from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16 // 128 bits
const SALT_LENGTH = 64
const ITERATIONS = 10000
const DIGEST = 'sha512'

export class AESHelper {
  /**
   * Generate random salt value
   * @returns Salt value in hexadecimal format
   */
  static generateSalt(): string {
    return crypto.randomBytes(SALT_LENGTH).toString('hex')
  }

  /**
   * Derive key from password
   * @param password Original password
   * @param salt Salt value
   * @returns Derived key Buffer
   */
  static deriveKey(password: string, salt: string): Buffer {
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST)
  }

  /**
   * AES encryption
   * @param plainText Plain text
   * @param key Encryption key (Buffer format)
   * @param iv Initialization vector (optional)
   * @returns Object containing ciphertext and IV
   */
  static encrypt(
    plainText: string,
    key: Buffer,
    iv?: Buffer
  ): {
    cipherText: string
    iv: string
  } {
    try {
      const usedIv = iv || crypto.randomBytes(IV_LENGTH)
      const cipher = crypto.createCipheriv(ALGORITHM, key, usedIv)

      let encrypted = cipher.update(plainText, 'utf8', 'hex')
      encrypted += cipher.final('hex')

      return {
        cipherText: encrypted,
        iv: usedIv.toString('hex')
      }
    } catch (error) {
      throw new Error(
        `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * AES decryption
   * @param cipherText Ciphertext (hexadecimal format)
   * @param key Encryption key (Buffer format)
   * @param iv Initialization vector (hexadecimal format)
   * @returns Decrypted plaintext
   */
  static decrypt(cipherText: string, key: Buffer, iv: string): string {
    try {
      const ivBuffer = Buffer.from(iv, 'hex')
      const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer)

      let decrypted = decipher.update(cipherText, 'hex', 'utf8')
      decrypted += decipher.final('utf8')

      return decrypted
    } catch (error) {
      throw new Error(
        `Decryption failed: ${error instanceof Error ? error.message : 'Ciphertext may be tampered or key is incorrect'}`
      )
    }
  }

  /**
   * Generate random IV
   * @returns IV in hexadecimal format
   */
  static generateIV(): string {
    return crypto.randomBytes(IV_LENGTH).toString('hex')
  }
}
