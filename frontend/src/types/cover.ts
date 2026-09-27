/** 实寄封（Cover）数据模型：一封实际寄递过的信封的全部编目事实。 */

/** 品相 */
export type ConditionGrade = '上品' | '中品' | '下品'

/** 贴票构成：票种 + 面值 + 枚数 */
export interface FrankingItem {
  stampName: string
  denomination: number
  count: number
}

/**
 * 邮戳合并痕迹：封原关联的重复戳停用后，原编号保留在封详情，
 * 并标出其并入的保留戳（currentPmId，在 cancelPmIds 内）。
 */
export interface CancelTrace {
  /** 被合并停用的重复戳 id */
  fromPmId: number
  /** 原编号，如 PM-0009（冗余留存，停用戳记录日后异常也不丢编号） */
  fromPmNo: string
  /** 合并时改挂的保留戳 id */
  currentPmId: number
  /** 合并前该封是否本就关联保留戳：是则只去重、未新增挂接，恢复时应摘掉 */
  hadKeep: boolean
  mergedAt: string
}

export interface Cover {
  id?: number
  /** 封号，如 CV-0001 */
  coverNo: string
  sentFrom: string
  sentTo: string
  /** 寄出日期 YYYY-MM-DD */
  postDate: string
  /** 到达日期 YYYY-MM-DD */
  arriveDate: string
  franking: FrankingItem[]
  /** 关联邮戳 id 列表 */
  cancelPmIds: number[]
  /** 历史合并痕迹：已停用重复戳的原编号与并入去向 */
  cancelTraces: CancelTrace[]
  /** 所属邮路 id */
  routeId: number | null
  /** 中转地数组 */
  viaPoints: string[]
  /** 是否给据邮件 */
  registered: boolean
  conditionGrade: ConditionGrade
  /** 来源 */
  acquireFrom: string
  /** 购入价（元） */
  price: number
  /** 藏册页位 */
  storageAlbum: string
  /** 封面正面图（缩略 dataURL；原图存 assets 表） */
  frontImage: string
  /** 封面背面图（缩略 dataURL；原图存 assets 表） */
  backImage: string
  note: string
  createdAt: string
  updatedAt: string
}

export const CONDITION_GRADES: ConditionGrade[] = ['上品', '中品', '下品']

/** 生成一条空白实寄封记录，供表单初始化使用。 */
export function createEmptyCover(): Cover {
  return {
    coverNo: '',
    sentFrom: '',
    sentTo: '',
    postDate: '',
    arriveDate: '',
    franking: [],
    cancelPmIds: [],
    cancelTraces: [],
    routeId: null,
    viaPoints: [],
    registered: false,
    conditionGrade: '中品',
    acquireFrom: '',
    price: 0,
    storageAlbum: '',
    frontImage: '',
    backImage: '',
    note: '',
    createdAt: '',
    updatedAt: ''
  }
}
