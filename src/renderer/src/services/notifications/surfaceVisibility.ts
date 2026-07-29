export interface SurfaceVisibilitySource {
  isVisible(): boolean
  subscribe(listener: () => void): () => void
}

export class DocumentSurfaceVisibility implements SurfaceVisibilitySource {
  isVisible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden'
  }

  subscribe(listener: () => void): () => void {
    if (typeof document === 'undefined') return () => undefined

    document.addEventListener('visibilitychange', listener)
    return () => {
      document.removeEventListener('visibilitychange', listener)
    }
  }
}
