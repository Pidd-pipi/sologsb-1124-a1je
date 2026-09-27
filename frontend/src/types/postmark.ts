/** 邮戳（Postmark）数据模型：编目一枚邮戳所需的最小事实集合。 */

/** 戳型：圆形日戳 / 滚筒戳 / 机盖波纹戳 / 纪念戳 / 风景戳 / 军邮戳 */
export type PostmarkType =
  | '圆形日戳'
  | '滚筒戳'
  | '机盖波纹戳'
  | '纪念戳'
  | '风景戳'
  | '军邮戳'

/** 稀见度 */
export type ScarceLevel = '常见' | '少见' | '罕见' | '孤品'

/** 在用状态：active 在用；merged 因并入他戳而停用（编号保留，可恢复） */
export type PostmarkStatus = 'active' | 'merged'

/** 戳面文字：按上格 / 中格 / 下格分行登记 */
export interface PostmarkLettering {
  top: string
  middle: string
  bottom: string
}

export interface Postmark {
  id?: number
  /** 编目号，如 PM-0001 */
  pmNo: string
  type: PostmarkType
  /** 使用局所 */
  office: string
  province: string
  /** 使用年代起（公元年） */
  yearFrom: number
  /** 使用年代止（公元年） */
  yearTo: number
  /** 戳面日期，ISO 字符串 YYYY-MM-DD，可为空 */
  dateOnStamp: string
  /** 墨色 */
  inkColor: string
  /** 戳径（mm） */
  diameter: number
  lettering: PostmarkLettering
  /** 是否中英双文字 */
  bilingual: boolean
  scarceLevel: ScarceLevel
  /** 在用状态：在用 / 已并入他戳停用 */
  status: PostmarkStatus
  /** 并入去向邮戳 id；仅 status 为 merged 时有值 */
  mergedIntoId: number | null
  /** 停用时间（ISO 字符串），在用时为空串 */
  mergedAt: string
  /** 戳样图（缩略 dataURL；原图存 assets 表） */
  imageDataUrl: string
  note: string
  createdAt: string
  updatedAt: string
}

export const POSTMARK_TYPES: PostmarkType[] = [
  '圆形日戳',
  '滚筒戳',
  '机盖波纹戳',
  '纪念戳',
  '风景戳',
  '军邮戳'
]

export const SCARCE_LEVELS: ScarceLevel[] = ['常见', '少见', '罕见', '孤品']

export const INK_COLORS: string[] = ['黑', '红', '蓝', '绿', '紫', '棕']

export const PROVINCES: string[] = [
  '北京',
  '上海',
  '天津',
  '江苏',
  '浙江',
  '广东',
  '湖北',
  '四川',
  '山东',
  '福建',
  '陕西',
  '云南'
]

/** 生成一条空白邮戳记录，供表单初始化使用。 */
export function createEmptyPostmark(): Postmark {
  return {
    pmNo: '',
    type: '圆形日戳',
    office: '',
    province: '',
    yearFrom: 1949,
    yearTo: 1949,
    dateOnStamp: '',
    inkColor: '黑',
    diameter: 25,
    lettering: { top: '', middle: '', bottom: '' },
    bilingual: false,
    scarceLevel: '常见',
    status: 'active',
    mergedIntoId: null,
    mergedAt: '',
    imageDataUrl: '',
    note: '',
    createdAt: '',
    updatedAt: ''
  }
}
