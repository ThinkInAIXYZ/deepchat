export const HOST_VIEW_KINDS = ['infographic'] as const
export type HostViewKind = (typeof HOST_VIEW_KINDS)[number]

export const INFOGRAPHIC_RENDER_METHOD = 'dc/infographic/render'
export const INFOGRAPHIC_STATUS_METHOD = 'dc/infographic/status'
export const INFOGRAPHIC_EXPORT_METHOD = 'dc/infographic/export'
export const INFOGRAPHIC_EXPORTED_METHOD = 'dc/infographic/exported'
