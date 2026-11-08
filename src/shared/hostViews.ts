export const HOST_VIEW_KINDS = ['infographic'] as const
export type HostViewKind = (typeof HOST_VIEW_KINDS)[number]

export const INFOGRAPHIC_RENDER_METHOD = 'dc/infographic/render'
export const INFOGRAPHIC_STATUS_METHOD = 'dc/infographic/status'
