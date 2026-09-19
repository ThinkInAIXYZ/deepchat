export const imageFileToBase64 = (file: File) => {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onloadend = (event: ProgressEvent<FileReader>) => {
      const base64 = event.target?.result
      resolve(base64)
    }
  })
}

const MAX_SIZE = 1200

interface ImageDimensions {
  width: number
  height: number
}

const calculateAspectRatioFit = (
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
  maxHeight: number
): ImageDimensions => {
  const ratio = Math.min(maxWidth / srcWidth, maxHeight / srcHeight)
  return {
    width: Math.round(srcWidth * ratio),
    height: Math.round(srcHeight * ratio)
  }
}

export const getClipboardImageInfo = (
  file: File
): Promise<{
  width: number
  height: number
  fileSize: number
  mimeType: string
  compressedBase64: string
  compressedWidth: number
  compressedHeight: number
}> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      // Calculate compressed dimensions
      const { width: compressedWidth, height: compressedHeight } = calculateAspectRatioFit(
        img.width,
        img.height,
        MAX_SIZE,
        MAX_SIZE
      )

      // Create canvas for compression
      const canvas = document.createElement('canvas')
      canvas.width = compressedWidth
      canvas.height = compressedHeight
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        URL.revokeObjectURL(objectUrl)
        img.remove()
        reject(new Error('Failed to get canvas context'))
        return
      }

      // Draw and compress image
      ctx.drawImage(img, 0, 0, compressedWidth, compressedHeight)
      const compressedBase64 = canvas.toDataURL(file.type, 0.9)

      const imageInfo = {
        width: img.width,
        height: img.height,
        fileSize: file.size,
        mimeType: file.type,
        compressedBase64,
        compressedWidth,
        compressedHeight
      }

      // Cleanup
      URL.revokeObjectURL(objectUrl)
      img.remove()
      canvas.remove()
      resolve(imageInfo)
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      img.remove()
      reject(new Error('Failed to load image'))
    }

    img.src = objectUrl
  })
}

export const calculateImageTokens = (width: number, height: number): number => {
  // 方法1：基于图片尺寸
  const pixelBasedTokens = Math.round(((width ?? 1) * (height ?? 1)) / 750)

  return pixelBasedTokens
}
