import Foundation

/// Per-window zoom context: the native-pixel origin of the last zoom crop
/// and the resize ratio, so the click tool can map zoom-image pixels
/// back to the resized-image coordinate space automatically.
public struct ZoomContext: Sendable {
    /// Top-left of the crop in original (native) pixels.
    public let originX: Int
    public let originY: Int
    /// Size of the crop in original (native) pixels.
    public let width: Int
    public let height: Int
    /// The resize ratio (original / resized). Divide native pixels by
    /// this to get resized-image pixels.
    public let ratio: Double
}

public struct ImageContextKey: Hashable, Sendable {
    public let pid: Int32
    public let windowId: UInt32?

    public init(pid: Int32, windowId: UInt32?) {
        self.pid = pid
        self.windowId = windowId
    }
}

/// Tracks per-window image resize ratios and last-zoom context so the
/// click tool can map coordinates from any source automatically.
///
/// The nil-window key is retained as a compatibility fallback for callers
/// that omit `window_id`. Window-aware callers get strict `(pid, window_id)`
/// lookup for zoom contexts so a crop from one window cannot drive a click
/// in another window.
public actor ImageResizeRegistry {
    public static let shared = ImageResizeRegistry()
    private var ratios: [ImageContextKey: Double] = [:]
    private var zooms: [ImageContextKey: ZoomContext] = [:]

    /// Record the scale-up ratio for a pid/window pair.
    public func setRatio(_ ratio: Double, forPid pid: Int32, windowId: UInt32? = nil) {
        ratios[ImageContextKey(pid: pid, windowId: windowId)] = ratio
        if windowId != nil {
            ratios[ImageContextKey(pid: pid, windowId: nil)] = ratio
        }
    }

    /// Clear the ratio for a pid/window pair (no resize happened).
    public func clearRatio(forPid pid: Int32, windowId: UInt32? = nil) {
        ratios.removeValue(forKey: ImageContextKey(pid: pid, windowId: windowId))
        if windowId != nil {
            ratios.removeValue(forKey: ImageContextKey(pid: pid, windowId: nil))
        }
    }

    /// Returns the scale-up ratio, or nil if no resize is active.
    public func ratio(forPid pid: Int32, windowId: UInt32? = nil) -> Double? {
        if let windowId,
           let ratio = ratios[ImageContextKey(pid: pid, windowId: windowId)]
        {
            return ratio
        }
        return ratios[ImageContextKey(pid: pid, windowId: nil)]
    }

    /// Record the last zoom crop for a pid/window pair.
    public func setZoom(_ context: ZoomContext, forPid pid: Int32, windowId: UInt32? = nil) {
        zooms[ImageContextKey(pid: pid, windowId: windowId)] = context
        if windowId != nil {
            zooms[ImageContextKey(pid: pid, windowId: nil)] = context
        }
    }

    /// Clear the zoom context for a pid/window pair.
    public func clearZoom(forPid pid: Int32, windowId: UInt32? = nil) {
        zooms.removeValue(forKey: ImageContextKey(pid: pid, windowId: windowId))
        if windowId != nil {
            zooms.removeValue(forKey: ImageContextKey(pid: pid, windowId: nil))
        }
    }

    /// Returns the last zoom context, or nil.
    public func zoom(forPid pid: Int32, windowId: UInt32? = nil) -> ZoomContext? {
        zooms[ImageContextKey(pid: pid, windowId: windowId)]
    }
}
