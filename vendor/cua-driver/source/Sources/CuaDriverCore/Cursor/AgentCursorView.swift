import AppKit
import SwiftUI

/// SwiftUI overlay view that drives `AgentCursorRenderer.shared` every
/// display frame and draws the cursor arrow via `Canvas`. Hosted inside
/// `AgentCursorOverlayWindow` via an `NSHostingView`.
///
/// The cursor tip points in the direction of `renderer.heading`. Shape
/// matches the existing gradient-arrow design: a classic pointer with
/// the tip at upper-left, scaled for legibility at any display density.
public struct AgentCursorView: View {
    @Bindable var renderer: AgentCursorRenderer

    public init(renderer: AgentCursorRenderer = .shared) {
        self.renderer = renderer
    }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 120.0)) { ctx in
            Canvas { gctx, size in
                renderer.tick(now: ctx.date.timeIntervalSinceReferenceDate)
                drawFocusRect(in: gctx, canvasSize: size)
                drawCursor(in: gctx)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
        }
    }

    /// Draw a glowing highlight rectangle around the currently targeted AX
    /// element (if `renderer.focusRect` is set). The rect is in screen-point
    /// coordinates; the overlay window's frame is the full screen, so we
    /// convert from screen-point to canvas-local by subtracting the screen's
    /// origin. Uses a cyan-glow border with a faint fill to mark the target.
    private func drawFocusRect(in ctx: GraphicsContext, canvasSize: CGSize) {
        guard let screenRect = renderer.focusRect else { return }
        // The overlay window covers the whole screen, and the canvas's
        // coordinate origin is the top-left of the screen. Screen-point
        // coordinates (CoreGraphics, top-left origin on macOS) map
        // directly to canvas coordinates — no offset needed.
        let r = CGRect(
            x: screenRect.minX,
            y: screenRect.minY,
            width: screenRect.width,
            height: screenRect.height
        )
        let cornerRadius: CGFloat = 4
        let rounded = Path(roundedRect: r, cornerRadius: cornerRadius)

        // Faint fill — shows the full extent of the target.
        ctx.fill(
            rounded,
            with: .color(
                Color(red: 0x5E/255, green: 0xC0/255, blue: 0xE8/255).opacity(0.08)
            )
        )

        // Solid bright border.
        ctx.stroke(
            rounded,
            with: .color(
                Color(red: 0x5E/255, green: 0xC0/255, blue: 0xE8/255).opacity(0.90)
            ),
            lineWidth: 2
        )

        // Wide soft glow stroke for the neon halo effect.
        ctx.stroke(
            rounded,
            with: .color(
                Color(red: 0x5E/255, green: 0xC0/255, blue: 0xE8/255).opacity(0.30)
            ),
            lineWidth: 8
        )
    }

    /// Draw the cursor arrow centered on `renderer.position`, rotated to
    /// `renderer.heading`. The shape is a 4-vertex pointer arrow with
    /// the tip along +x before rotation, which the caller rotates by
    /// `heading + π` (so the visible tip trails opposite the motion
    /// vector — matching macOS cursor convention).
    private func drawCursor(in ctx: GraphicsContext) {
        let p = renderer.position
        guard p.x > -100 else { return }   // skip until first moveTo

        // Arrow path — tip at (14, 0), tail extends to the left.
        var shape = Path()
        shape.move(to: CGPoint(x: 14, y: 0))
        shape.addLine(to: CGPoint(x: -8, y: -9))
        shape.addLine(to: CGPoint(x: -3, y: 0))
        shape.addLine(to: CGPoint(x: -8, y: 9))
        shape.closeSubpath()

        // `renderer.heading` is the visual heading = motion_direction + π.
        // The arrow path has its tip at +x, so we rotate by heading + π
        // to make the tip point in the motion direction (standard cursor
        // convention where the pointer leads rather than trails).
        let transform = CGAffineTransform(translationX: p.x, y: p.y)
            .rotated(by: CGFloat(renderer.heading + .pi))

        let transformed = shape.applying(transform)

        // Ice-blue gradient fill (matches existing agent-cursor palette).
        ctx.fill(
            transformed,
            with: .linearGradient(
                Gradient(colors: [
                    Color(red: 0xDB/255, green: 0xEE/255, blue: 0xFF/255),
                    Color(red: 0x5E/255, green: 0xC0/255, blue: 0xE8/255),
                    Color(red: 0x54/255, green: 0xCD/255, blue: 0xA0/255),
                ]),
                startPoint: CGPoint(x: p.x + 14, y: p.y - 9),
                endPoint: CGPoint(x: p.x - 8, y: p.y + 9)
            )
        )
        // White outline for legibility on any background.
        ctx.stroke(transformed, with: .color(.white), lineWidth: 1.5)

        // Cyan bloom halo — radial glow that reads as agent presence.
        let bloomR: CGFloat = 22
        let bloomRect = CGRect(x: p.x - bloomR, y: p.y - bloomR,
                               width: bloomR * 2, height: bloomR * 2)
        ctx.fill(
            Path(ellipseIn: bloomRect),
            with: .radialGradient(
                Gradient(colors: [
                    Color(red: 0x5E/255, green: 0xC0/255, blue: 0xE8/255).opacity(0.45),
                    Color(red: 0x5E/255, green: 0xC0/255, blue: 0xE8/255).opacity(0.10),
                    Color(red: 0x5E/255, green: 0xC0/255, blue: 0xE8/255).opacity(0.0),
                ]),
                center: p,
                startRadius: 0,
                endRadius: bloomR
            )
        )
    }
}
